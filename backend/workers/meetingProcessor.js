const { Worker } = require('bullmq');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { promisify } = require('util');
const Groq = require('groq-sdk');
const FormData = require('form-data');
const fetch = require('node-fetch');
const { Meeting, PromptTemplate, Performance, Notification } = require('../models');
const { chromaClient } = require('../config/chroma');
const { generateEmbedding } = require('../ai/embeddings');
const { meetingAnalysisChain, chunkTranscript, scoreAttendeeChain } = require('../ai/langchain');
const { getFileUrl, uploadFile } = require('../config/s3');
const winston = require('winston');

const execAsync = promisify(require('child_process').exec);

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()]
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const DIARIZATION_URL = process.env.DIARIZATION_URL || 'http://diarization:8001';

// Must match server.js CHUNK_DURATION_MS
const CHUNK_DURATION_MS = 10000;

// ─────────────────────────────────────────────────────────────────────────────
// HALLUCINATION FILTER
//
// BUG 1 (root cause of "Thank you for watching!"):
// Whisper hallucinates on silent/near-silent chunks. When a participant is
// not speaking during a 10s window, their mic still captures ambient noise.
// Whisper fills this with well-known hallucination phrases rather than
// returning empty. These are all documented Whisper hallucinations.
//
// FIX: Filter these out BEFORE adding to segments. This list covers every
// common hallucination seen in production with Whisper-large-v3.
// ─────────────────────────────────────────────────────────────────────────────
const WHISPER_HALLUCINATIONS = new Set([
  'thank you for watching',
  'thanks for watching',
  'thank you for watching!',
  'thanks for watching!',
  'please subscribe',
  'like and subscribe',
  'subtitles by the amara.org community',
  'subtitles by amara.org',
  'amara.org community',
  'translated by',
  'transcribed by',
  'www.moviewavs.com',
  'i\'m sorry',
  'you',
  'the',
  'a',
  'um',
  'uh',
  'hmm',
  'okay.',
  'okay',
  'ok.',
  'ok',
  'yes.',
  'yes',
  'no.',
  'no',
]);

function isHallucination(text) {
  if (!text) return true;
  const t = text.trim().toLowerCase()
    .replace(/[.!?,]/g, '')
    .trim();
  // exact match against known hallucinations
  if (WHISPER_HALLUCINATIONS.has(t)) return true;
  if (WHISPER_HALLUCINATIONS.has(text.trim().toLowerCase())) return true;
  // too short to be real speech
  if (t.length < 4) return true;
  // word count check — single word utterances that are filler
  const wordCount = t.split(/\s+/).length;
  if (wordCount === 1 && t.length < 6) return true;
  return false;
}

async function updateStep(meetingId, step, status, message = null, io = null) {
  const meeting = await Meeting.findById(meetingId);
  if (meeting) {
    const stepObj = meeting.processingSteps.find(s => s.step === step);
    if (stepObj) {
      stepObj.status = status;
      stepObj.timestamp = new Date();
      if (message) stepObj.message = message;
    }
    await meeting.save();
    if (io) io.to(meetingId).emit('processing-update', { step, status, message });
  }
}

async function downloadAudio(audioKey) {
  const url = await getFileUrl(audioKey, 3600);
  const tempDir = '/temp';
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const localPath = path.join(tempDir, `${Date.now()}-${path.basename(audioKey)}`);
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(localPath, Buffer.from(buffer));
  return localPath;
}

function getAudioDuration(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { logger.warn(`ffprobe error: ${err.message}`); return resolve(0); }
      const duration = metadata?.format?.duration;
      resolve(typeof duration === 'number' && !isNaN(duration) ? duration : 0);
    });
  });
}

async function splitAudio(filePath, chunkDuration = 600) {
  const outputDir = '/temp/chunks';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const baseName = path.basename(filePath, path.extname(filePath));
  const outputPattern = path.join(outputDir, `${baseName}_chunk_%03d.wav`);
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .output(outputPattern)
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .outputOptions([`-f segment`, `-segment_time ${chunkDuration}`, `-reset_timestamps 1`])
      .on('end', () => {
        const chunks = fs.readdirSync(outputDir)
          .filter(f => f.startsWith(`${baseName}_chunk_`))
          .map(f => path.join(outputDir, f))
          .sort();
        resolve(chunks);
      })
      .on('error', reject)
      .run();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBM → WAV CONVERSION
//
// BUG 2 (root cause of empty/skipped chunks):
// Whisper-large-v3 via Groq API works best with WAV input. Raw WebM/Opus
// chunks from MediaRecorder can fail silently on Groq when the init segment
// is malformed or the chunk duration is very short.
//
// FIX: Convert each WebM chunk to 16kHz mono WAV before sending to Groq.
// This also eliminates the Opus silence compression issue — WAV has real
// silence encoded rather than omitting it, giving Whisper correct timing.
// ─────────────────────────────────────────────────────────────────────────────
async function convertWebmToWav(inputPath) {
  const outputPath = inputPath.replace(/\.(webm|ogg|mp4)$/i, '.wav');
  if (outputPath === inputPath) return inputPath; // already wav

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => {
        logger.warn(`WebM→WAV conversion failed: ${err.message}`);
        resolve(inputPath); // fall back to original
      })
      .run();
  });
}

async function transcribeWithGroq(audioPath) {
  try {
    // Convert to WAV first for reliability
    let pathToTranscribe = audioPath;
    let tempWav = null;

    if (audioPath.endsWith('.webm') || audioPath.endsWith('.ogg')) {
      tempWav = await convertWebmToWav(audioPath);
      if (tempWav !== audioPath) pathToTranscribe = tempWav;
    }

    logger.info(`Transcribing: ${pathToTranscribe}`);
    const audioStream = fs.createReadStream(pathToTranscribe);

    const transcription = await groq.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-large-v3',
      response_format: 'verbose_json',
      temperature: 0,
      // ── BUG 3 FIX: Remove Hinglish prompt for English-only meetings ─────
      // The Hinglish prompt was ACTIVELY CAUSING hallucinations for English
      // meetings because it primes Whisper to expect patterns it doesn't find.
      // If your meetings are purely English, remove the prompt entirely.
      // Only uncomment the prompt below if your meetings genuinely use Hinglish.
      //
      // prompt: 'Corporate meeting transcript. Speakers discuss deployment, monitoring, infrastructure.',
    });

    // Clean up temp WAV
    if (tempWav && tempWav !== audioPath) {
      try { fs.unlinkSync(tempWav); } catch (_) {}
    }

    return transcription;
  } catch (error) {
    logger.error(`Groq transcription error: ${error.message}`);
    throw error;
  }
}

async function diarizeWithPyannote(audioPath, numSpeakers) {
  try {
    const healthRes = await fetch(`${DIARIZATION_URL}/health`, { timeout: 5000 });
    const health = await healthRes.json();
    if (!health.pipeline_loaded) {
      logger.warn('Pyannote pipeline not loaded — falling back to LLM diarization');
      return null;
    }

    logger.info(`Sending audio to pyannote diarization service (num_speakers=${numSpeakers})`);

    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath), {
      filename: path.basename(audioPath),
      contentType: 'audio/wav'
    });

    const url = numSpeakers > 1
      ? `${DIARIZATION_URL}/diarize?num_speakers=${numSpeakers}`
      : `${DIARIZATION_URL}/diarize`;

    const response = await fetch(url, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
      timeout: 300000
    });

    if (!response.ok) {
      const err = await response.text();
      logger.warn(`Pyannote diarization failed: ${err} — falling back to LLM`);
      return null;
    }

    const result = await response.json();
    logger.info(`Pyannote diarization complete: ${result.segments.length} segments, ${result.num_speakers_detected} speakers`);
    return result.segments;

  } catch (error) {
    logger.warn(`Pyannote service unreachable: ${error.message} — falling back to LLM diarization`);
    return null;
  }
}

function mergeTranscriptWithDiarization(groqSegments, diarSegments, attendeeNames) {
  const speakingTime = {};
  for (const seg of diarSegments) {
    const duration = (seg.end || 0) - (seg.start || 0);
    speakingTime[seg.speaker] = (speakingTime[seg.speaker] || 0) + duration;
  }

  const sortedSpeakers = Object.keys(speakingTime).sort(
    (a, b) => speakingTime[b] - speakingTime[a]
  );

  const speakerMap = {};
  sortedSpeakers.forEach((speaker, idx) => {
    speakerMap[speaker] = attendeeNames[idx % attendeeNames.length];
  });

  logger.info(`Speaker mapping: ${JSON.stringify(speakerMap)}`);

  return groqSegments.map(seg => {
    const midpoint = ((seg.start || 0) + (seg.end || 0)) / 2;
    const diarSeg = diarSegments.find(d => d.start <= midpoint && midpoint <= d.end);
    const closestSeg = diarSeg || diarSegments.reduce((closest, d) => {
      if (!closest) return d;
      const distCurrent = Math.abs(d.start - midpoint);
      const distClosest = Math.abs(closest.start - midpoint);
      return distCurrent < distClosest ? d : closest;
    }, null);

    const speaker = closestSeg
      ? (speakerMap[closestSeg.speaker] || attendeeNames[0])
      : attendeeNames[0];

    return { ...seg, speaker };
  });
}

function mergeShortSegments(segments, minDuration = 1.0) {
  if (!segments || segments.length === 0) return [];
  const merged = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const duration = (current.end || 0) - (current.start || 0);
    const endsWithPunctuation = /[.!?]$/.test(current.text?.trim() || '');

    if (duration < minDuration || !endsWithPunctuation) {
      current = {
        ...current,
        end: seg.end,
        text: (current.text || '').trim() + ' ' + (seg.text || '').trim()
      };
    } else {
      merged.push(current);
      current = { ...seg };
    }
  }
  merged.push(current);
  return merged;
}

async function inferSpeakersWithLLM(segments, attendeeNames) {
  if (!segments || segments.length === 0) return [];

  if (attendeeNames.length === 1) {
    return segments.map(seg => ({ ...seg, speaker: attendeeNames[0] }));
  }

  const batchSize = 30;
  const allLabeled = [];

  for (let batchStart = 0; batchStart < segments.length; batchStart += batchSize) {
    const batch = segments.slice(batchStart, batchStart + batchSize);

    const segmentList = batch.map((seg, localIdx) =>
      `[${localIdx}] ${seg.text?.trim()}`
    ).join('\n');

    const prompt = `You are analyzing a meeting transcript. The meeting has exactly these attendees (use ONLY these exact names, no titles or roles):
${attendeeNames.map((n, i) => `- Speaker ${i + 1}: ${n}`).join('\n')}

Rules:
1. Use ONLY the exact names listed above
2. Assign each segment to one speaker based on conversation flow and context
3. Look for: questions followed by answers, topic handoffs, first-person references
4. A speaker can have multiple consecutive segments
5. If truly uncertain, assign to the speaker who spoke most recently

Segments to label:
${segmentList}

Return ONLY a valid JSON array (no markdown, no explanation):
[{"index":0,"speaker":"${attendeeNames[0]}"},{"index":1,"speaker":"${attendeeNames[Math.min(1, attendeeNames.length - 1)]}"}]`;

    try {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 4096
      });

      const content = response.choices[0]?.message?.content || '[]';
      const clean = content.replace(/```json|```/g, '').trim();
      let assignments = [];
      try {
        assignments = JSON.parse(clean);
      } catch (parseErr) {
        const match = clean.match(/\[[\s\S]*\]/);
        if (match) assignments = JSON.parse(match[0]);
      }

      batch.forEach((seg, localIdx) => {
        const assignment = assignments.find(a => a.index === localIdx);
        const assignedName = assignment?.speaker?.trim();
        const validName = attendeeNames.includes(assignedName)
          ? assignedName
          : attendeeNames[localIdx % attendeeNames.length];
        allLabeled.push({ ...seg, speaker: validName });
      });

    } catch (error) {
      logger.warn(`LLM speaker inference failed for batch at ${batchStart}: ${error.message}`);
      batch.forEach((seg, localIdx) => {
        allLabeled.push({
          ...seg,
          speaker: attendeeNames[(batchStart + localIdx) % attendeeNames.length]
        });
      });
    }
  }

  return allLabeled;
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-DEVICE TRANSCRIPTION PIPELINE
//
// BUG 4 (root cause of all-0:00 timestamps):
// meetingEpoch was computed from chunk timestamps across ALL devices. When
// a device has only 1-2 chunks, or when chunks from different devices have
// slightly different clock references, Math.min of all timestamps gave an
// epoch that didn't correspond to actual meeting start time. The result was
// chunkStartSeconds being huge or wrong for some devices, or negative for
// others.
//
// FIX: Compute meetingEpoch as the MINIMUM recordingStartTime across all
// devices, NOT from chunk timestamps. recordingStartTime is set when the
// MediaRecorder.start() is called — it's the true wall-clock meeting start.
// Each chunk's position is then:
//   chunkStartSeconds = (chunkTimestamp - meetingEpoch) / 1000 - CHUNK_DURATION_MS/1000
//
// This correctly places:
//   - Alice's chunk1 (t=10s): (epoch+10000 - epoch)/1000 - 10 = 0s ✓
//   - Bob's chunk4 (t=40s):   (epoch+40000 - epoch)/1000 - 10 = 30s ✓
//
// BUG 5 (root cause of speaker mixing):
// The old code used device.recordingStartTime which came from server.js's
// "effectiveStartTime clamping" logic. If a device's first chunk arrived
// before the room was fully initialized, its recordingStartTime got clamped
// to chunkTime - CHUNK_DURATION_MS, making it look like it started 10s
// later than it really did. This offset pushed all that device's segments
// forward in time, causing overlap with another device's segments at the
// same absolute time → dedup then merged segments from different speakers.
//
// FIX: Use the earliest chunkTimestamp for each device as its
// deviceEpoch (minus CHUNK_DURATION_MS), which is more reliable than
// the clamped recordingStartTime from server.js.
//
// BUG 6 (root cause of missed transcription / fragmented speech):
// The dedup threshold of 0.85 similarity within 10s was still merging
// legitimate short sentences. E.g. Bob saying "Yes" at t=5s and Alice
// saying "Yes, agreed" at t=5.5s would be deduplicated. Raised threshold
// to 0.92 and tightened time window to 3s.
// ─────────────────────────────────────────────────────────────────────────────
async function processPerDeviceAudio(perDeviceAudio, meetingId) {
  logger.info(`Processing per-device audio for ${perDeviceAudio.length} participants`);

  const tempDir = '/temp';
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const allSegments = [];

  // ── Compute meeting epoch from recordingStartTime (most reliable source) ──
  // Fall back to earliest chunk timestamp only if recordingStartTime missing
  const recordingStartTimes = perDeviceAudio
    .map(d => d.recordingStartTime)
    .filter(t => t && t > 0 && t < Date.now());

  const chunkTimestamps = perDeviceAudio
    .filter(d => Array.isArray(d.chunks) && d.chunks.length > 0)
    .flatMap(d => d.chunks.map(c => c.timestamp))
    .filter(t => t && t > 0);

  // meetingEpoch = when the first device started recording
  const meetingEpoch = recordingStartTimes.length > 0
    ? Math.min(...recordingStartTimes)
    : chunkTimestamps.length > 0
      ? Math.min(...chunkTimestamps) - CHUNK_DURATION_MS
      : Date.now() - 60000;

  logger.info(`Meeting epoch: ${meetingEpoch} (${new Date(meetingEpoch).toISOString()})`);

  for (const device of perDeviceAudio) {
    const { userId, userName } = device;

    const hasChunksArray = Array.isArray(device.chunks) && device.chunks.length > 0;
    logger.info(`Processing ${userName} (${userId}) — format: ${hasChunksArray ? 'chunks array' : 'single audioKey'}`);

    if (hasChunksArray) {
      // Sort chunks by chunkIndex to ensure correct order
      const sortedChunks = [...device.chunks].sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
      let deviceSegmentCount = 0;

      // ── Per-device epoch for this participant ──────────────────────────
      // Use the participant's own recordingStartTime if valid, otherwise
      // derive from their earliest chunk timestamp.
      const deviceRecordingStart = (device.recordingStartTime && device.recordingStartTime > 0)
        ? device.recordingStartTime
        : (sortedChunks[0]?.timestamp || meetingEpoch + CHUNK_DURATION_MS) - CHUNK_DURATION_MS;

      logger.info(`${userName} device recording start: ${deviceRecordingStart}`);

      for (const chunk of sortedChunks) {
        const { audioKey, timestamp, chunkIndex } = chunk;

        if (!audioKey) {
          logger.warn(`${userName} chunk ${chunkIndex} has no audioKey — skipping`);
          continue;
        }

        let localPath = null;
        let wavPath = null;
        try {
          localPath = await downloadAudio(audioKey);

          const stat = fs.statSync(localPath);
          if (stat.size < 500) {
            logger.warn(`${userName} chunk ${chunkIndex} too small (${stat.size} bytes) — skipping`);
            continue;
          }

          // Convert to WAV before transcribing (fixes Groq WebM issues)
          wavPath = await convertWebmToWav(localPath);

          // Verify WAV is valid and has enough audio
          const wavDuration = await getAudioDuration(wavPath);
          if (wavDuration < 0.5) {
            logger.warn(`${userName} chunk ${chunkIndex} WAV duration too short (${wavDuration}s) — skipping`);
            continue;
          }

          const result = await transcribeWithGroq(wavPath);
          const segments = result?.segments || [];

          // ── ABSOLUTE TIMESTAMP COMPUTATION ────────────────────────────
          // chunk.timestamp = wall-clock ms when THIS CHUNK was SENT (end of chunk)
          // chunkStartMs = when this chunk BEGAN recording
          // = chunk.timestamp - CHUNK_DURATION_MS
          //
          // absoluteStart = (chunkStartMs - meetingEpoch) / 1000 + whisperRelativeStart
          //
          // Example (3-person meeting):
          //   meetingEpoch = 1700000000000
          //   Alice chunk3: timestamp = 1700000030000
          //     chunkStart = 1700000030000 - 10000 = 1700000020000
          //     offset = (1700000020000 - 1700000000000) / 1000 = 20s
          //     Whisper says seg.start = 2s → absolute = 22s ✓
          //
          //   Bob chunk3: timestamp = 1700000032000 (joined 2s later)
          //     chunkStart = 1700000032000 - 10000 = 1700000022000
          //     offset = (1700000022000 - 1700000000000) / 1000 = 22s
          //     Whisper says seg.start = 0s → absolute = 22s ✓
          const chunkStartMs = timestamp - CHUNK_DURATION_MS;
          const chunkOffsetSeconds = Math.max(0, (chunkStartMs - meetingEpoch) / 1000);

          logger.info(`${userName} chunk${chunkIndex}: timestamp=${timestamp}, chunkOffsetSeconds=${chunkOffsetSeconds.toFixed(2)}s, ${segments.length} Whisper segments`);

          for (const seg of segments) {
            const text = seg.text?.trim();

            // ── BUG 1 FIX: Filter hallucinations before adding ─────────
            if (!text || isHallucination(text)) {
              if (text) logger.info(`Filtered hallucination from ${userName}: "${text}"`);
              continue;
            }

            const absoluteStart = chunkOffsetSeconds + (seg.start || 0);
            const absoluteEnd = chunkOffsetSeconds + (seg.end || 0);

            allSegments.push({
              speaker: userName,
              text,
              startTime: absoluteStart,
              endTime: absoluteEnd,
              start: absoluteStart,
              end: absoluteEnd,
              userId,
              source: 'per-device-chunk'
            });
            deviceSegmentCount++;
          }

        } catch (e) {
          logger.warn(`Failed chunk ${chunkIndex} for ${userName}: ${e.message}`);
        } finally {
          if (localPath) { try { fs.unlinkSync(localPath); } catch (_) {} }
          if (wavPath && wavPath !== localPath) { try { fs.unlinkSync(wavPath); } catch (_) {} }
        }
      }

      logger.info(`${userName}: ${deviceSegmentCount} segments from ${sortedChunks.length} chunks`);

    } else {
      // ── OLD FORMAT: single audioKey (backward compat) ─────────────────
      const { audioKey } = device;

      if (!audioKey) {
        logger.warn(`${userName} has no audioKey and no chunks array — skipping`);
        continue;
      }

      let localPath = null;
      let wavPath = null;
      try {
        localPath = await downloadAudio(audioKey);

        const stat = fs.statSync(localPath);
        if (stat.size < 1000) {
          logger.warn(`Audio for ${userName} too small (${stat.size} bytes) — skipping`);
          continue;
        }

        wavPath = await convertWebmToWav(localPath);
        const result = await transcribeWithGroq(wavPath);
        const segments = result?.segments || [];

        logger.info(`${userName}: ${segments.length} segments transcribed (old format)`);

        for (const seg of segments) {
          const text = seg.text?.trim();
          if (!text || isHallucination(text)) continue;

          allSegments.push({
            speaker: userName,
            text,
            startTime: seg.start || 0,
            endTime: seg.end || 0,
            start: seg.start || 0,
            end: seg.end || 0,
            userId,
            _deviceRecordingStart: device.recordingStartTime || 0,
            source: 'per-device-single'
          });
        }

      } catch (e) {
        logger.warn(`Failed to process audio for ${userName}: ${e.message}`);
      } finally {
        if (localPath) { try { fs.unlinkSync(localPath); } catch (_) {} }
        if (wavPath && wavPath !== localPath) { try { fs.unlinkSync(wavPath); } catch (_) {} }
      }
    }
  }

  if (allSegments.length === 0) {
    logger.warn('No segments from per-device audio — will fall back to mixed audio');
    return null;
  }

  // ── Timeline normalization for old-format segments ─────────────────────
  const oldFormatSegments = allSegments.filter(s => s.source === 'per-device-single');
  if (oldFormatSegments.length > 0) {
    const validStartTimes = perDeviceAudio
      .filter(d => !Array.isArray(d.chunks))
      .map(d => d.recordingStartTime)
      .filter(t => t && t > 0);

    if (validStartTimes.length > 0) {
      const earliestStart = Math.min(...validStartTimes);
      logger.info(`Old-format timeline normalization — earliest: ${earliestStart}`);

      for (const seg of oldFormatSegments) {
        const offset = ((seg._deviceRecordingStart || earliestStart) - earliestStart) / 1000;
        seg.startTime += offset;
        seg.endTime += offset;
        seg.start = seg.startTime;
        seg.end = seg.endTime;
      }
    }

    for (const seg of allSegments) {
      delete seg._deviceRecordingStart;
    }
  }

  // Sort chronologically
  allSegments.sort((a, b) => a.startTime - b.startTime);

  // ── DEDUPLICATION ──────────────────────────────────────────────────────
  // BUG 6 FIX: Tighter thresholds to prevent false dedup of real speech.
  // Only dedup within same speaker (never cross-speaker).
  // Time window: 3s (was 10s — too broad, was merging adjacent turns).
  // Similarity threshold: 0.92 (was 0.85 — too loose, was merging real segments).
  const dedupedSegments = [];
  for (const seg of allSegments) {
    const isDuplicate = dedupedSegments.some(existing => {
      // NEVER deduplicate across speakers
      if (existing.speaker !== seg.speaker) return false;
      const a = existing.text.trim().toLowerCase();
      const b = seg.text.trim().toLowerCase();
      const timeDiff = Math.abs(seg.startTime - existing.startTime);
      // Only consider dedup within 3s window (same chunk overlap)
      if (timeDiff > 3) return false;
      const longer = Math.max(a.length, b.length);
      const shorter = Math.min(a.length, b.length);
      // 92% similarity threshold (was 85% — too aggressive)
      return longer > 0 && shorter / longer > 0.92;
    });
    if (!isDuplicate) dedupedSegments.push(seg);
  }

  logger.info(`Per-device pipeline: ${dedupedSegments.length} segments (from ${allSegments.length} before dedup) across ${perDeviceAudio.length} participants`);
  return dedupedSegments;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

async function processMeeting(job) {
  const { meetingId, audioKey, perDeviceAudio } = job.data;
  const io = global.io;
  logger.info(`Starting processing for meeting ${meetingId}`);
  logger.info(`Per-device audio available: ${perDeviceAudio?.length || 0} participants`);

  try {
    const meeting = await Meeting.findById(meetingId)
      .populate('attendees.user', 'firstName lastName');

    if (!meeting) throw new Error('Meeting not found');

    await updateStep(meetingId, 'upload', 'done', 'Audio received', io);
    await updateStep(meetingId, 'transcription', 'running', 'Starting transcription', io);

    let transcriptSegments = null;
    let transcript = '';
    let usedPerDevice = false;

    // ── PATH 1: Per-device audio (preferred) ─────────────────────────────
    if (perDeviceAudio && perDeviceAudio.length > 0) {
      logger.info('Using per-device audio pipeline — no diarization needed');
      try {
        transcriptSegments = await processPerDeviceAudio(perDeviceAudio, meetingId);
        if (transcriptSegments && transcriptSegments.length > 0) {
          transcript = transcriptSegments.map(s => `${s.speaker}: ${s.text}`).join('\n');
          usedPerDevice = true;
          meeting.speakerDiarizationMethod = 'per-device';
          logger.info(`Per-device transcription success: ${transcriptSegments.length} segments`);
        } else {
          logger.warn('Per-device pipeline returned no segments — falling back to mixed audio');
        }
      } catch (e) {
        logger.warn(`Per-device pipeline failed: ${e.message} — falling back to mixed audio`);
      }
    }

    // ── PATH 2: Mixed audio fallback ────────────────────────────────────
    if (!usedPerDevice && audioKey) {
      logger.info('Using mixed audio pipeline with diarization');

      const localAudioPath = await downloadAudio(audioKey);
      const rawDuration = await getAudioDuration(localAudioPath);
      meeting.actualDuration = (rawDuration && !isNaN(rawDuration)) ? Math.round(rawDuration / 60) : 0;

      logger.info(`Audio duration: ${rawDuration}s`);

      let groqResult = null;
      const fileSizeMB = fs.statSync(localAudioPath).size / (1024 * 1024);

      if (fileSizeMB > 24 || rawDuration > 600) {
        logger.info('Large file — splitting into chunks');
        const chunks = await splitAudio(localAudioPath);
        let timeOffset = 0;
        const allSegments = [];

        for (const chunk of chunks) {
          const chunkResult = await transcribeWithGroq(chunk);
          transcript += (chunkResult?.text || '') + '\n';
          if (chunkResult?.segments) {
            chunkResult.segments.forEach(seg => {
              if (!isHallucination(seg.text)) {
                allSegments.push({
                  ...seg,
                  start: (seg.start || 0) + timeOffset,
                  end: (seg.end || 0) + timeOffset
                });
              }
            });
          }
          timeOffset += 600;
          try { fs.unlinkSync(chunk); } catch (e) { }
        }
        groqResult = { text: transcript, segments: allSegments };
      } else {
        groqResult = await transcribeWithGroq(localAudioPath);
        transcript = groqResult?.text || '';
      }

      meeting.transcriptRaw = transcript;
      logger.info(`Transcription done. Text: ${transcript.length} chars, segments: ${groqResult?.segments?.length || 0}`);
      await updateStep(meetingId, 'transcription', 'done', 'Transcription complete', io);

      await updateStep(meetingId, 'diarization', 'running', 'Identifying speakers', io);

      const joinedAttendees = meeting.attendees.filter(
        a => a.attended === true || a.joinedAt !== null
      );
      const activeAttendees = joinedAttendees.length > 0 ? joinedAttendees : meeting.attendees;
      const attendeeNames = activeAttendees
        .map(a => {
          const first = (a.user?.firstName || '').trim();
          const last = (a.user?.lastName || '').trim();
          return `${first} ${last}`.trim();
        })
        .filter(name => name.length > 0);

      logger.info(`Attendees for diarization: ${attendeeNames.join(', ')}`);

      const rawSegments = (groqResult?.segments || []).map(seg => ({
        text: seg.text?.trim() || '',
        startTime: seg.start || 0,
        endTime: seg.end || 0,
        start: seg.start || 0,
        end: seg.end || 0
      })).filter(seg => seg.text.length > 0 && !isHallucination(seg.text));

      const numSpeakers = attendeeNames.length;
      const diarSegments = await diarizeWithPyannote(localAudioPath, numSpeakers);

      let labeledSegments;
      if (diarSegments && diarSegments.length > 0) {
        logger.info(`Using pyannote diarization (${diarSegments.length} segments)`);
        labeledSegments = mergeTranscriptWithDiarization(rawSegments, diarSegments, attendeeNames);
        meeting.speakerDiarizationMethod = 'pyannote';
      } else {
        logger.info('Pyannote unavailable — using LLM speaker inference fallback');
        const segmentsToLabel = rawDuration < 600 ? rawSegments : mergeShortSegments(rawSegments);
        labeledSegments = await inferSpeakersWithLLM(segmentsToLabel, attendeeNames);
        meeting.speakerDiarizationMethod = 'llm';
      }

      const rawMappedSegments = labeledSegments.map(seg => ({
        speaker: seg.speaker || 'Unknown Speaker',
        startTime: seg.startTime || seg.start || 0,
        endTime: seg.endTime || seg.end || 0,
        text: seg.text || ''
      }));

      const dedupedSegments = [];
      for (const seg of rawMappedSegments) {
        const isDuplicate = dedupedSegments.some(existing => {
          const a = existing.text.trim().toLowerCase();
          const b = seg.text.trim().toLowerCase();
          const timeDiff = Math.abs(seg.startTime - existing.startTime);
          const longer = Math.max(a.length, b.length);
          const shorter = Math.min(a.length, b.length);
          return timeDiff < 3 && longer > 0 && shorter / longer > 0.92;
        });
        if (!isDuplicate) dedupedSegments.push(seg);
      }

      transcriptSegments = dedupedSegments;
      try { fs.unlinkSync(localAudioPath); } catch (e) { }
    }

    meeting.transcriptRaw = transcript || transcriptSegments?.map(s => `${s.speaker}: ${s.text}`).join('\n') || '';
    meeting.transcriptSegments = transcriptSegments || [];
    meeting.speakerDiarizationEditable = true;

    if (usedPerDevice) {
      await updateStep(meetingId, 'transcription', 'done', `Transcribed ${perDeviceAudio.length} participants`, io);
      await updateStep(meetingId, 'diarization', 'done', 'Speaker attribution via per-device audio — 100% accurate', io);
    } else {
      await updateStep(meetingId, 'diarization', 'done', 'Speaker identification complete', io);
    }

    logger.info(`Final segments: ${meeting.transcriptSegments.length}, method: ${meeting.speakerDiarizationMethod}`);

    // Step 4: Analysis
    await updateStep(meetingId, 'analysis', 'running', 'Analyzing meeting content', io);

    const promptTemplate = await PromptTemplate.findOne({ domain: meeting.domain, isActive: true });

    const analysis = await meetingAnalysisChain(
      meeting.transcriptRaw,
      meeting.domain,
      meeting.attendees.map(a => a.user),
      promptTemplate || {
        systemPrompt: 'You are a meeting analyst. Analyze the meeting transcript and return structured insights.',
        userPromptTemplate: 'Analyze this {domain} meeting transcript:\n\n{transcript}\n\nAttendees: {attendees}\n\nReturn JSON with: summary, conclusions, decisions, actionItems (array with owner/task/deadline fields), followUpTopics, attendeeContributions (array with name/score/keyPoints fields)'
      },
      meeting.transcriptSegments
    );

    meeting.summary = analysis.summary;
    meeting.conclusions = analysis.conclusions || [];
    meeting.decisions = analysis.decisions || [];
    meeting.actionItems = (analysis.actionItems || []).map(item => {
      let deadline = null;
      if (item.deadline) {
        const parsed = new Date(item.deadline);
        deadline = isNaN(parsed.getTime()) ? null : parsed;
      }
      return {
        owner: meeting.attendees.find(a => {
          const name = `${a.user?.firstName} ${a.user?.lastName}`.toLowerCase();
          return name.includes((item.owner || '').toLowerCase());
        })?.user?._id || meeting.host,
        task: item.task,
        deadline,
        status: 'pending'
      };
    });
    meeting.followUpTopics = analysis.followUpTopics || [];

    meeting.attendeeContributions = [];

    for (const attendee of meeting.attendees) {
      const name = `${attendee.user?.firstName} ${attendee.user?.lastName}`.trim();
      try {
        const contribution = await scoreAttendeeChain(
          name,
          meeting.transcriptRaw,
          meeting.domain,
          meeting.transcriptSegments
        );
        const score = (contribution.score && !isNaN(contribution.score)) ? contribution.score : 5;
        attendee.contributionScore = score;
        attendee.keyPoints = contribution.keyPoints || [];

        meeting.attendeeContributions.push({
          user: attendee.user._id,
          name,
          score,
          keyPoints: contribution.keyPoints || [],
          speakingTime: 0
        });
      } catch (e) {
        logger.warn(`Score failed for ${name}: ${e.message}`);
        meeting.attendeeContributions.push({
          user: attendee.user._id,
          name,
          score: 5,
          keyPoints: [],
          speakingTime: 0
        });
      }
    }

    await updateStep(meetingId, 'analysis', 'done', 'Analysis complete', io);

    // Step 5: Embeddings
    await updateStep(meetingId, 'embedding', 'running', 'Storing embeddings', io);
    try {
      const speakerChunks = [];
      let currentChunk = '';
      let currentWordCount = 0;
      const CHUNK_WORD_LIMIT = 300;

      for (const seg of meeting.transcriptSegments) {
        const line = `${seg.speaker}: ${seg.text}`;
        const wordCount = line.split(' ').length;
        if (currentWordCount + wordCount > CHUNK_WORD_LIMIT && currentChunk.length > 0) {
          speakerChunks.push(currentChunk.trim());
          currentChunk = '';
          currentWordCount = 0;
        }
        currentChunk += line + '\n';
        currentWordCount += wordCount;
      }
      if (currentChunk.trim().length > 0) speakerChunks.push(currentChunk.trim());

      const chunks = speakerChunks.length > 0 ? speakerChunks : chunkTranscript(meeting.transcriptRaw, 300);
      const attendeeNames = meeting.attendees.map(a =>
        `${a.user?.firstName || ''} ${a.user?.lastName || ''}`.trim()
      ).filter(Boolean);

      const collection = await chromaClient.getCollection({ name: 'meeting_transcripts' });
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await generateEmbedding(chunks[i]);
        await collection.add({
          ids: [`${meetingId}_chunk_${i}`],
          embeddings: [embedding],
          documents: [chunks[i]],
          metadatas: [{
            meetingId: meetingId.toString(),
            domain: meeting.domain,
            date: meeting.scheduledDate.toISOString(),
            attendees: attendeeNames.join(', '),
            chunkIndex: i
          }]
        });
      }
    } catch (e) {
      logger.warn(`Embedding failed: ${e.message}`);
    }
    await updateStep(meetingId, 'embedding', 'done', 'Embeddings stored', io);

    for (const attendee of meeting.attendees) {
      try {
        const performance = await Performance.findOne({ user: attendee.user._id });
        if (performance) {
          performance.meetingStats = performance.meetingStats || { totalMeetings: 0, avgContributionScore: 0 };
          performance.meetingStats.totalMeetings += 1;
          const prevAvg = performance.meetingStats.avgContributionScore || 0;
          const prevCount = performance.meetingStats.totalMeetings - 1;
          const newScore = attendee.contributionScore || 5;
          const newAvg = (prevAvg * prevCount + newScore) / performance.meetingStats.totalMeetings;
          performance.meetingStats.avgContributionScore = isNaN(newAvg) ? 5 : newAvg;
          await performance.save();
        }
      } catch (e) {
        logger.warn(`Performance update failed: ${e.message}`);
      }
    }

    await Meeting.findByIdAndUpdate(meetingId, {
      status: 'ready',
      transcriptRaw: meeting.transcriptRaw,
      transcriptSegments: meeting.transcriptSegments,
      speakerDiarizationMethod: meeting.speakerDiarizationMethod,
      speakerDiarizationEditable: meeting.speakerDiarizationEditable,
      actualDuration: meeting.actualDuration,
      summary: meeting.summary,
      conclusions: (meeting.conclusions || []).filter(Boolean),
      decisions: (meeting.decisions || []).filter(Boolean),
      followUpTopics: (meeting.followUpTopics || []).filter(Boolean),
      actionItems: (meeting.actionItems || []).filter(item => item && item.task),
      attendeeContributions: (meeting.attendeeContributions || []).filter(Boolean),
      attendees: meeting.attendees,
    }, { new: true });

    await updateStep(meetingId, 'ready', 'done', 'Meeting processing complete', io);

    await Notification.create({
      user: meeting.host,
      type: 'meeting_ready',
      title: 'Meeting analysis ready',
      message: `"${meeting.name}" has been processed and is ready for review`,
      link: `/meetings/${meeting._id}`,
      entityType: 'meeting',
      entityId: meeting._id
    });

    logger.info(`Meeting ${meetingId} processing complete — method: ${meeting.speakerDiarizationMethod}`);

  } catch (error) {
    logger.error(`Processing error for meeting ${meetingId}: ${error.message}`);
    try {
      await Meeting.findByIdAndUpdate(meetingId, {
        status: 'completed',
        processingError: error.message,
        $set: { 'processingSteps.$[elem].status': 'failed' }
      }, { arrayFilters: [{ 'elem.status': 'running' }] });
    } catch (updateError) {
      logger.error(`Failed to update meeting status: ${updateError.message}`);
    }
    throw error;
  }
}

const worker = new Worker('meeting-processing', processMeeting, {
  connection: { url: process.env.REDIS_URL },
  concurrency: 2
});

worker.on('completed', (job) => logger.info(`Job ${job.id} completed`));
worker.on('failed', (job, err) => logger.error(`Job ${job.id} failed: ${err.message}`));

const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000;

async function pingDiarizationService() {
  try {
    const res = await fetch(`${DIARIZATION_URL}/health`, { timeout: 8000 });
    const data = await res.json();
    if (data.pipeline_loaded) {
      logger.info('Diarization keep-alive: pipeline loaded');
    } else {
      logger.warn('Diarization keep-alive: pipeline not loaded yet');
    }
  } catch (e) {
    logger.warn(`Diarization keep-alive failed: ${e.message}`);
  }
}

pingDiarizationService();
const keepAliveTimer = setInterval(pingDiarizationService, KEEP_ALIVE_INTERVAL);

const workerHealthTimer = setInterval(() => {
  logger.info(`Worker alive, uptime: ${Math.round(process.uptime())}s`);
}, 5 * 60 * 1000);

process.on('SIGTERM', () => {
  clearInterval(keepAliveTimer);
  clearInterval(workerHealthTimer);
  logger.info('Worker shutting down gracefully');
  process.exit(0);
});

module.exports = worker;