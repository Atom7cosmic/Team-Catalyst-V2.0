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
const { getFileUrl, uploadFile, listFiles } = require('../config/s3');
const winston = require('winston');

const execAsync = promisify(require('child_process').exec);

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()]
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const DIARIZATION_URL = process.env.DIARIZATION_URL || 'http://diarization:8001';
const CHUNK_DURATION_MS = 10000;

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1: runWithTimeout — wraps any async step in a Promise.race so a hung
// LLM/Whisper/pyannote call cannot stall the worker indefinitely.
// ─────────────────────────────────────────────────────────────────────────────
function runWithTimeout(promise, ms, label) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
  );
  return Promise.race([promise, timeout]);
}

// ─────────────────────────────────────────────────────────────────────────────
// HALLUCINATION FILTER
// ─────────────────────────────────────────────────────────────────────────────
const WHISPER_HALLUCINATIONS = new Set([
  'thank you for watching', 'thanks for watching',
  'thank you for watching!', 'thanks for watching!',
  'please subscribe', 'like and subscribe',
  'subtitles by the amara.org community', 'subtitles by amara.org',
  'amara.org community', 'translated by', 'transcribed by',
  'www.moviewavs.com', "i'm sorry",
  'you', 'the', 'a', 'um', 'uh', 'hmm',
  'okay.', 'okay', 'ok.', 'ok',
  'yes.', 'yes', 'no.', 'no',
  'welcome', 'welcome.', 'welcome!',
  'thank you.', 'thank you', 'thanks.', 'thanks',
]);

function isHallucination(text) {
  if (!text) return true;
  const t = text.trim().toLowerCase().replace(/[.!?,]/g, '').trim();
  if (WHISPER_HALLUCINATIONS.has(t)) return true;
  if (WHISPER_HALLUCINATIONS.has(text.trim().toLowerCase())) return true;
  if (t.length < 4) return true;
  const wordCount = t.split(/\s+/).length;
  if (wordCount === 1 && t.length < 6) return true;
  return false;
}

async function updateStep(meetingId, step, status, message = null, io = null) {
  const meeting = await Meeting.findById(meetingId);
  if (meeting) {
    const stepObj = meeting.processingSteps.find(s => s.step === step);
    if (stepObj) { stepObj.status = status; stepObj.timestamp = new Date(); if (message) stepObj.message = message; }
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

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2: getAudioDuration now falls back to probing the converted WAV when
// ffprobe returns 0 on the WebM. WebM files from MediaRecorder often have
// missing/corrupt duration metadata that ffprobe can't read, but the WAV
// converted by ffmpeg always has accurate duration headers.
// ─────────────────────────────────────────────────────────────────────────────
function probeFileDuration(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { logger.warn(`ffprobe error on ${filePath}: ${err.message}`); return resolve(0); }
      const duration = metadata?.format?.duration;
      resolve(typeof duration === 'number' && !isNaN(duration) ? duration : 0);
    });
  });
}

async function getAudioDuration(filePath) {
  const duration = await probeFileDuration(filePath);
  if (duration > 0) return { duration, wavPath: null };

  const fileSizeMB = fs.statSync(filePath).size / (1024 * 1024);
  logger.warn(`ffprobe returned 0s duration for ${path.basename(filePath)} (${fileSizeMB.toFixed(1)}MB) — converting to WAV to get accurate duration`);

  let wavPath = null;
  try {
    wavPath = await convertWebmToWav(filePath);
    if (wavPath && wavPath !== filePath) {
      const wavDuration = await probeFileDuration(wavPath);
      logger.info(`WAV fallback duration: ${wavDuration}s`);
      // Return wavPath — caller reuses it for transcription, must delete it when done.
      return { duration: wavDuration, wavPath };
    }
  } catch (e) {
    logger.warn(`WAV fallback duration probe failed: ${e.message}`);
    if (wavPath && wavPath !== filePath) { try { fs.unlinkSync(wavPath); } catch (_) {} }
  }
  return { duration: 0, wavPath: null };
}

async function splitAudio(filePath, chunkDuration = 600) {
  const outputDir = '/temp/chunks';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const baseName = path.basename(filePath, path.extname(filePath));
  const outputPattern = path.join(outputDir, `${baseName}_chunk_%03d.wav`);
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .output(outputPattern)
      .audioCodec('pcm_s16le').audioFrequency(16000).audioChannels(1)
      .outputOptions([`-f segment`, `-segment_time ${chunkDuration}`, `-reset_timestamps 1`])
      .on('end', () => {
        const chunks = fs.readdirSync(outputDir)
          .filter(f => f.startsWith(`${baseName}_chunk_`))
          .map(f => path.join(outputDir, f)).sort();
        resolve(chunks);
      })
      .on('error', reject).run();
  });
}

async function convertWebmToWav(inputPath) {
  const outputPath = inputPath.replace(/\.(webm|ogg|mp4)$/i, '.wav');
  if (outputPath === inputPath) return inputPath;
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('pcm_s16le').audioFrequency(16000).audioChannels(1)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => { logger.warn(`WebM→WAV conversion failed: ${err.message}`); resolve(inputPath); })
      .run();
  });
}

// alreadyWavPath: if the caller already has a WAV (from duration probing),
// pass it here to skip the redundant second WebM→WAV conversion.
async function transcribeWithGroq(audioPath, alreadyWavPath = null) {
  try {
    let pathToTranscribe = audioPath;
    let tempWav = null;

    if (alreadyWavPath) {
      pathToTranscribe = alreadyWavPath;
      logger.info(`Transcribing (reusing duration-probe WAV): ${pathToTranscribe}`);
    } else if (audioPath.endsWith('.webm') || audioPath.endsWith('.ogg')) {
      tempWav = await convertWebmToWav(audioPath);
      if (tempWav !== audioPath) pathToTranscribe = tempWav;
      logger.info(`Transcribing (freshly converted WAV): ${pathToTranscribe}`);
    } else {
      logger.info(`Transcribing: ${pathToTranscribe}`);
    }

    const transcription = await runWithTimeout(
      groq.audio.transcriptions.create({
        file: fs.createReadStream(pathToTranscribe),
        model: 'whisper-large-v3',
        response_format: 'verbose_json',
        temperature: 0,
        prompt: "नमस्कार, यह मीटिंग हिंदी और English में है। Please use Devanagari script for Hindi.",
      }),
      300000,
      'Whisper transcription'
    );
    // Only delete tempWav if WE created it (not the caller's alreadyWavPath)
    if (tempWav && tempWav !== audioPath) { try { fs.unlinkSync(tempWav); } catch (_) {} }
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
    if (!health.pipeline_loaded) { logger.warn('Pyannote pipeline not loaded — falling back to LLM'); return null; }

    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath), { filename: path.basename(audioPath), contentType: 'audio/wav' });
    const url = numSpeakers > 1 ? `${DIARIZATION_URL}/diarize?num_speakers=${numSpeakers}` : `${DIARIZATION_URL}/diarize`;
    // FIX 1: Pyannote diarization wrapped in timeout
    const response = await runWithTimeout(
      fetch(url, { method: 'POST', body: form, headers: form.getHeaders() }),
      900000, // 15 minutes (HF Free Tier CPU can be very slow)
      'Pyannote diarization'
    );
    if (!response.ok) { logger.warn(`Pyannote failed: ${await response.text()}`); return null; }
    const result = await response.json();
    logger.info(`Pyannote complete: ${result.segments.length} segments, ${result.num_speakers_detected} speakers`);
    return result.segments;
  } catch (error) {
    logger.warn(`Pyannote unreachable: ${error.message} — falling back to LLM`);
    return null;
  }
}

function mergeTranscriptWithDiarization(groqSegments, diarSegments, attendeeNames) {
  const speakingTime = {};
  for (const seg of diarSegments) {
    const duration = (seg.end || 0) - (seg.start || 0);
    speakingTime[seg.speaker] = (speakingTime[seg.speaker] || 0) + duration;
  }
  const sortedSpeakers = Object.keys(speakingTime).sort((a, b) => speakingTime[b] - speakingTime[a]);
  const speakerMap = {};
  sortedSpeakers.forEach((speaker, idx) => { speakerMap[speaker] = attendeeNames[idx % attendeeNames.length]; });
  logger.info(`Speaker mapping: ${JSON.stringify(speakerMap)}`);

  return groqSegments.map(seg => {
    const midpoint = ((seg.start || 0) + (seg.end || 0)) / 2;
    const diarSeg = diarSegments.find(d => d.start <= midpoint && midpoint <= d.end);
    const closestSeg = diarSeg || diarSegments.reduce((closest, d) => {
      if (!closest) return d;
      return Math.abs(d.start - midpoint) < Math.abs(closest.start - midpoint) ? d : closest;
    }, null);
    const speaker = closestSeg ? (speakerMap[closestSeg.speaker] || attendeeNames[0]) : attendeeNames[0];
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
      current = { ...current, end: seg.end, text: (current.text || '').trim() + ' ' + (seg.text || '').trim() };
    } else { merged.push(current); current = { ...seg }; }
  }
  merged.push(current);
  return merged;
}

async function inferSpeakersWithLLM(segments, attendeeNames) {
  if (!segments || segments.length === 0) return [];
  if (attendeeNames.length === 1) return segments.map(seg => ({ ...seg, speaker: attendeeNames[0] }));

  const batchSize = 30;
  const allLabeled = [];

  for (let batchStart = 0; batchStart < segments.length; batchStart += batchSize) {
    const batch = segments.slice(batchStart, batchStart + batchSize);
    const segmentList = batch.map((seg, localIdx) => `[${localIdx}] ${seg.text?.trim()}`).join('\n');
    const prompt = `You are analyzing a meeting transcript. The meeting has exactly these attendees (use ONLY these exact names):
${attendeeNames.map((n, i) => `- Speaker ${i + 1}: ${n}`).join('\n')}

Rules:
1. Use ONLY the exact names listed above
2. Assign each segment to one speaker based on conversation flow and context
3. Look for: questions followed by answers, topic handoffs, first-person references
4. A speaker can have multiple consecutive segments
5. If truly uncertain, assign to the speaker who spoke most recently

Segments:
${segmentList}

Return ONLY a valid JSON array (no markdown, no explanation):
[{"index":0,"speaker":"${attendeeNames[0]}"},{"index":1,"speaker":"${attendeeNames[Math.min(1, attendeeNames.length - 1)]}"}]`;

    try {
      // FIX 1: LLM speaker inference wrapped in timeout
      const response = await runWithTimeout(
        groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1, max_tokens: 4096
        }),
        120000, // 2 minutes per batch
        `LLM speaker inference batch ${batchStart}`
      );
      const content = response.choices[0]?.message?.content || '[]';
      const clean = content.replace(/```json|```/g, '').trim();
      let assignments = [];
      try { assignments = JSON.parse(clean); } catch (_) { const m = clean.match(/\[[\s\S]*\]/); if (m) assignments = JSON.parse(m[0]); }
      batch.forEach((seg, localIdx) => {
        const assignment = assignments.find(a => a.index === localIdx);
        const assignedName = assignment?.speaker?.trim();
        const validName = attendeeNames.includes(assignedName) ? assignedName : attendeeNames[localIdx % attendeeNames.length];
        allLabeled.push({ ...seg, speaker: validName });
      });
    } catch (error) {
      logger.warn(`LLM speaker inference failed at batch ${batchStart}: ${error.message}`);
      batch.forEach((seg, localIdx) => { allLabeled.push({ ...seg, speaker: attendeeNames[(batchStart + localIdx) % attendeeNames.length] }); });
    }
  }
  return allLabeled;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3: scanPerDeviceAudio
//
// Instead of trusting job.data.perDeviceAudio (which was collected at
// upload-recording time and is often empty because non-host flush-my-chunks
// calls were still in-flight), we scan S3 directly for all device-* files
// under the meeting prefix at job execution time.
//
// By the time the worker runs (job has a 30s delay set in meetingController),
// all participants' S3 uploads are guaranteed complete.
//
// Returns an array in the same shape as the old perDeviceAudio:
// [{ userId, userName, recordingStartTime, chunks: [{ audioKey, timestamp, chunkIndex, voiceRatio }] }]
// ─────────────────────────────────────────────────────────────────────────────
async function scanPerDeviceAudio(meetingId) {
  try {
    const prefix = `meetings/${meetingId}/device-`;
    const keys = await listFiles(prefix);

    if (!keys || keys.length === 0) {
      logger.info(`scanPerDeviceAudio: no device files found for meeting ${meetingId}`);
      return [];
    }

    logger.info(`scanPerDeviceAudio: found ${keys.length} device files for meeting ${meetingId}`);

    // Parse key format: device-{userId}-chunk{index}-{timestamp}.webm
    const byUser = {};
    for (const key of keys) {
      const basename = path.basename(key);
      // Skip VAD sidecar files (device-{userId}-vad.json) — handled separately below
      if (basename.endsWith('-vad.json')) continue;
      // e.g. device-69d24b6fe3d5b5709b11c5fe-chunk4-1777011360394.webm
      // Anchor from the right so userId can contain hyphens (UUIDs, etc.)
      const match = basename.match(/^device-(.+)-chunk(\d+)-(\d+)\.webm$/);
      if (!match) {
        logger.warn(`scanPerDeviceAudio: unrecognised key format: ${basename}`);
        continue;
      }
      const userId = match[1];
      const chunkIndex = parseInt(match[2], 10);
      const timestamp = parseInt(match[3], 10);

      if (!byUser[userId]) {
        byUser[userId] = {
          userId,
          userName: userId, // will be resolved from meeting attendees below
          recordingStartTime: timestamp,
          chunks: [],
        };
      }
      if (timestamp < byUser[userId].recordingStartTime) {
        byUser[userId].recordingStartTime = timestamp;
      }
      byUser[userId].chunks.push({ audioKey: key, timestamp, chunkIndex, voiceRatio: 0.5 });
    }

    // Sort chunks within each user by chunkIndex
    for (const entry of Object.values(byUser)) {
      entry.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    }

    // Load VAD sidecar files written by server.js flush-my-chunks handler.
    // Each sidecar: meetings/{meetingId}/device-{userId}-vad.json
    // Contains real Silero voiceRatio values scored in the background.
    for (const [userId, entry] of Object.entries(byUser)) {
      try {
        const vadKey = `meetings/${meetingId}/device-${userId}-vad.json`;
        const vadUrl = await getFileUrl(vadKey, 60);
        const res = await fetch(vadUrl, { timeout: 8000 });
        if (res.ok) {
          const vadData = await res.json();
          const scoreMap = {};
          for (const vc of vadData.chunks || []) scoreMap[vc.chunkIndex] = vc;
          for (const chunk of entry.chunks) {
            if (scoreMap[chunk.chunkIndex] !== undefined) {
              chunk.voiceRatio = scoreMap[chunk.chunkIndex].voiceRatio;
              chunk.hasVoice  = scoreMap[chunk.chunkIndex].hasVoice;
            }
          }
          logger.info(`VAD sidecar loaded for ${userId}: [${entry.chunks.map(c => c.voiceRatio.toFixed(2)).join(', ')}]`);
        }
      } catch (e) {
        logger.warn(`VAD sidecar unavailable for ${userId}: ${e.message} — keeping neutral 0.5`);
      }
    }

    return Object.values(byUser);
  } catch (e) {
    logger.warn(`scanPerDeviceAudio failed: ${e.message} — falling back to no per-device audio`);
    return [];
  }
}

// Resolve usernames from meeting attendees for the scanned device entries
function resolveUserNames(deviceEntries, meeting) {
  const userMap = {};
  for (const attendee of meeting.attendees) {
    const uid = attendee.user?._id?.toString() || attendee.user?.toString();
    const name = `${attendee.user?.firstName || ''} ${attendee.user?.lastName || ''}`.trim().replace(/\s+/g, ' ');
    if (uid && name) userMap[uid] = name;
  }
  return deviceEntries.map(entry => ({
    ...entry,
    userName: userMap[entry.userId] || entry.userName || 'Participant',
  }));
}

async function assignSpeakersFromDeviceTimeline(segments, perDeviceAudio) {
  if (!segments.length || !perDeviceAudio.length) return segments;

  const recordingStartTimes = perDeviceAudio
    .map(d => d.recordingStartTime)
    .filter(t => t && t > 0 && t < Date.now());

  const allChunkTimestamps = perDeviceAudio
    .filter(d => Array.isArray(d.chunks) && d.chunks.length > 0)
    .flatMap(d => d.chunks.map(c => c.timestamp))
    .filter(t => t && t > 0);

  const meetingEpoch = recordingStartTimes.length > 0
    ? Math.min(...recordingStartTimes)
    : allChunkTimestamps.length > 0
      ? Math.min(...allChunkTimestamps) - CHUNK_DURATION_MS
      : Date.now() - 300000;

  logger.info(`assignSpeakersFromDeviceTimeline: meetingEpoch=${new Date(meetingEpoch).toISOString()}`);

  const allScores = perDeviceAudio
    .flatMap(d => (d.chunks || []).map(c => c.voiceRatio))
    .filter(v => typeof v === 'number');
  const vadAvailable = allScores.length > 0 && allScores.some(v => v !== 0.5);
  logger.info(`VAD available: ${vadAvailable} (${allScores.length} scores, sample: ${allScores.slice(0, 6).map(v => v.toFixed(2)).join(', ')})`);

  const windows = [];
  for (const device of perDeviceAudio) {
    if (!Array.isArray(device.chunks) || device.chunks.length === 0) continue;
    for (const chunk of device.chunks) {
      const chunkEndMs = chunk.timestamp;
      const chunkStartMs = chunkEndMs - CHUNK_DURATION_MS;
      const windowStart = Math.max(0, (chunkStartMs - meetingEpoch) / 1000);
      const windowEnd = Math.max(0, (chunkEndMs - meetingEpoch) / 1000);
      windows.push({
        userName: device.userName,
        userId: device.userId,
        windowStart,
        windowEnd,
        voiceRatio: typeof chunk.voiceRatio === 'number' ? chunk.voiceRatio : 0.5,
      });
    }
  }

  logger.info(`Built ${windows.length} device windows for ${perDeviceAudio.length} participants`);

  return segments.map(seg => {
    const midpoint = ((seg.startTime || seg.start || 0) + (seg.endTime || seg.end || 0)) / 2;
    const covering = windows.filter(w => w.windowStart <= midpoint && w.windowEnd >= midpoint);

    let assignedName;

    if (covering.length === 0) {
      if (windows.length === 0) {
        assignedName = perDeviceAudio[0]?.userName || 'Unknown';
      } else {
        // Use window center for nearest-match to avoid bias toward early/late windows
        const nearest = windows.reduce((a, b) =>
          Math.abs((a.windowStart + a.windowEnd) / 2 - midpoint) < Math.abs((b.windowStart + b.windowEnd) / 2 - midpoint) ? a : b
        );
        assignedName = nearest.userName;
      }
    } else if (covering.length === 1) {
      assignedName = covering[0].userName;
    } else if (vadAvailable) {
      const best = covering.reduce((a, b) => a.voiceRatio > b.voiceRatio ? a : b);
      assignedName = best.userName;
      logger.debug(`VAD resolved overlap at ${midpoint.toFixed(1)}s: ${covering.map(c => `${c.userName}=${c.voiceRatio.toFixed(2)}`).join(', ')} → ${assignedName}`);
    } else {
      const best = covering.reduce((a, b) => Math.abs(a.windowStart - midpoint) < Math.abs(b.windowStart - midpoint) ? a : b);
      assignedName = best.userName;
    }

    return {
      ...seg,
      speaker: assignedName,
      startTime: seg.startTime || seg.start || 0,
      endTime: seg.endTime || seg.end || 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HYBRID: mapPyannoteToVadIdentities
//
// Uses Pyannote diarization for millisecond-accurate speaker BOUNDARIES and
// per-device VAD sidecars to map anonymous labels (SPEAKER_00) to real names.
//
// This gives the best of both worlds:
//   • Pyannote: detects the exact second a speaker switches (handles rapid dialogue)
//   • VAD sidecar: knows which device (person) was active in each time window
//
// Algorithm:
//   For each Pyannote anonymous segment, accumulate VAD-weighted overlap scores
//   for every participant. The participant with the highest score wins that label.
// ─────────────────────────────────────────────────────────────────────────────
function mapPyannoteToVadIdentities(groqSegments, pyannoteSegments, perDeviceAudio) {
  const CHUNK_MS = 10000;
  const recordingStartTimes = perDeviceAudio
    .map(d => d.recordingStartTime).filter(t => t && t > 0 && t < Date.now());
  const allChunkTs = perDeviceAudio
    .flatMap(d => (d.chunks || []).map(c => c.timestamp)).filter(t => t && t > 0);
  const meetingEpoch = recordingStartTimes.length > 0
    ? Math.min(...recordingStartTimes)
    : allChunkTs.length > 0 ? Math.min(...allChunkTs) - CHUNK_MS : Date.now() - 300000;

  // Build per-participant time windows (seconds since meetingEpoch)
  const windows = [];
  for (const device of perDeviceAudio) {
    for (const chunk of device.chunks || []) {
      const windowEnd   = (chunk.timestamp - meetingEpoch) / 1000;
      const windowStart = windowEnd - CHUNK_MS / 1000;
      windows.push({ userName: device.userName, windowStart, windowEnd, voiceRatio: chunk.voiceRatio ?? 0.5 });
    }
  }

  // Accumulate VAD-weighted overlap between each Pyannote anonymous speaker and each participant
  const speakerScores = {}; // { 'SPEAKER_00': { 'Alice CEO': 12.4, 'Bob CTO': 3.1 }, ... }
  for (const pSeg of pyannoteSegments) {
    if (!speakerScores[pSeg.speaker]) speakerScores[pSeg.speaker] = {};
    for (const w of windows) {
      const overlapStart = Math.max(pSeg.start, w.windowStart);
      const overlapEnd   = Math.min(pSeg.end,   w.windowEnd);
      if (overlapEnd <= overlapStart) continue;
      const overlapSecs = overlapEnd - overlapStart;
      speakerScores[pSeg.speaker][w.userName] =
        (speakerScores[pSeg.speaker][w.userName] || 0) + w.voiceRatio * overlapSecs;
    }
  }

  // Greedily assign each anonymous speaker to the highest-scoring participant
  const assigned = new Set();
  const speakerMap = {};
  // Sort anonymous speakers by confidence (highest total score first)
  // Use reduce instead of spread to avoid call-stack overflow with large arrays
  const sortedPSpeakers = Object.entries(speakerScores).sort((a, b) => {
    const aMax = Object.values(a[1]).reduce((m, v) => Math.max(m, v), 0);
    const bMax = Object.values(b[1]).reduce((m, v) => Math.max(m, v), 0);
    return bMax - aMax;
  });
  for (const [pSpeaker, userScores] of sortedPSpeakers) {
    const sorted = Object.entries(userScores).sort((a, b) => b[1] - a[1]);
    const best = sorted.find(([name]) => !assigned.has(name));
    if (best) { speakerMap[pSpeaker] = best[0]; assigned.add(best[0]); }
    else speakerMap[pSpeaker] = perDeviceAudio[0]?.userName || 'Unknown';
  }

  logger.info(`Pyannote→VAD identity map: ${JSON.stringify(speakerMap)}`);

  // Assign each Whisper segment using Pyannote boundary → mapped identity
  return groqSegments.map(seg => {
    const mid = ((seg.start || 0) + (seg.end || 0)) / 2;
    const pSeg = pyannoteSegments.find(p => p.start <= mid && mid <= p.end)
      || pyannoteSegments.reduce((a, b) =>
          Math.abs((a.start + a.end) / 2 - mid) < Math.abs((b.start + b.end) / 2 - mid) ? a : b, pyannoteSegments[0]);
    return { ...seg, speaker: speakerMap[pSeg?.speaker] || perDeviceAudio[0]?.userName || 'Unknown' };
  });
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE PROCESSING FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
async function processMeeting(job) {
  const { meetingId, audioKey } = job.data;
  const io = global.io;
  logger.info(`Starting processing for meeting ${meetingId}`);
  logger.info(`Audio key: ${audioKey}`);

  let localAudioPath = null;
  let splitChunks = [];
  // Track the WAV produced during duration probing so we can reuse it for
  // transcription and clean it up in finally.
  let durationProbeWavPath = null;

  try {
    const meeting = await Meeting.findById(meetingId).populate('attendees.user', 'firstName lastName');
    if (!meeting) throw new Error('Meeting not found');

    // ── FIX 3: Scan S3 for per-device audio instead of reading job.data ──────
    // job.data.perDeviceAudio was set at upload-recording time (before non-host
    // flush-my-chunks calls completed). Scanning S3 now guarantees we see every
    // participant's files since the job has a 30s startup delay.
    let perDeviceAudio = await scanPerDeviceAudio(meetingId);
    perDeviceAudio = resolveUserNames(perDeviceAudio, meeting);
    logger.info(`Per-device audio from S3 scan: ${perDeviceAudio.length} participants`);
    if (perDeviceAudio.length > 0) {
      logger.info(`Participants found: ${perDeviceAudio.map(d => `${d.userName} (${d.chunks.length} chunks)`).join(', ')}`);
    }

    // Reset processing steps
    meeting.processingSteps = [
      { step: 'upload', status: 'done', timestamp: new Date() },
      { step: 'transcription', status: 'pending' },
      { step: 'diarization', status: 'pending' },
      { step: 'analysis', status: 'pending' },
      { step: 'embedding', status: 'pending' },
      { step: 'ready', status: 'pending' },
    ];
    await meeting.save();

    await updateStep(meetingId, 'upload', 'done', 'Audio received', io);
    await updateStep(meetingId, 'transcription', 'running', 'Starting transcription', io);

    if (!audioKey) throw new Error('No mixed audio recording available — cannot transcribe');

    // ── TRANSCRIPTION ─────────────────────────────────────────────────────
    logger.info('Transcribing mixed audio');
    localAudioPath = await downloadAudio(audioKey);

    // getAudioDuration returns { duration, wavPath }.
    // When wavPath is non-null it is the WAV we converted for probing —
    // we reuse it in transcribeWithGroq to avoid a second conversion.
    const { duration: rawDuration, wavPath: probeWav } = await getAudioDuration(localAudioPath);
    durationProbeWavPath = probeWav; // tracked for cleanup in finally

    meeting.actualDuration = (rawDuration && !isNaN(rawDuration)) ? Math.round(rawDuration / 60) : 0;
    const fileSizeMB = fs.statSync(localAudioPath).size / (1024 * 1024);
    logger.info(`Audio duration: ${rawDuration}s (ffprobe), file size: ${fileSizeMB.toFixed(1)}MB`);

    if (rawDuration === 0 && fileSizeMB > 0.1) {
      logger.warn(`Duration is 0s but file is ${fileSizeMB.toFixed(1)}MB — file may have corrupt headers. Attempting to continue.`);
    }

    let groqResult = null;

    if (fileSizeMB > 24 || rawDuration > 600) {
      logger.info('Large file — splitting into 10-minute WAV chunks');
      // Duration-probe WAV no longer useful for split path — clean up now
      if (durationProbeWavPath) {
        try { fs.unlinkSync(durationProbeWavPath); } catch (_) {}
        durationProbeWavPath = null;
      }
      const audioChunks = await splitAudio(localAudioPath);
      splitChunks = audioChunks;
      let timeOffset = 0;
      const allSegs = [];
      let fullText = '';
      for (const chunk of audioChunks) {
        const r = await runWithTimeout(
          transcribeWithGroq(chunk),
          360000, // 6 minutes per chunk
          `Whisper chunk ${chunk}`
        );
        fullText += (r?.text || '') + '\n';
        (r?.segments || []).forEach(seg => {
          if (!isHallucination(seg.text)) {
            allSegs.push({ ...seg, start: (seg.start || 0) + timeOffset, end: (seg.end || 0) + timeOffset });
          }
        });
        timeOffset += 600;
        try { fs.unlinkSync(chunk); } catch (_) {}
      }
      groqResult = { text: fullText, segments: allSegs };
    } else {
      // Pass durationProbeWavPath (may be null) to avoid a second conversion.
      groqResult = await runWithTimeout(
        transcribeWithGroq(localAudioPath, durationProbeWavPath),
        300000, // 5 minutes
        'Whisper transcription (single file)'
      );
      // transcribeWithGroq does NOT delete alreadyWavPath — cleaned up in finally.
    }

    const transcript = groqResult?.text || '';
    meeting.transcriptRaw = transcript;
    logger.info(`Transcription done: ${transcript.length} chars, ${groqResult?.segments?.length || 0} segments`);

    await updateStep(meetingId, 'transcription', 'done', 'Transcription complete', io);

    const rawSegments = (groqResult?.segments || [])
      .map(seg => ({ text: seg.text?.trim() || '', startTime: seg.start || 0, endTime: seg.end || 0, start: seg.start || 0, end: seg.end || 0 }))
      .filter(seg => seg.text.length > 0 && !isHallucination(seg.text));

    logger.info(`Segments after hallucination filter: ${rawSegments.length}`);

    // Guard: no speech detected (silent audio or 100% hallucination wipeout)
    if (rawSegments.length === 0) {
      logger.warn(`Meeting ${meetingId}: zero transcript segments — no speech detected`);
      await Meeting.findByIdAndUpdate(meetingId, {
        status: 'completed',
        processingError: 'No speech detected in the recording. Please check microphone permissions and try again.',
        transcriptRaw: '',
        transcriptSegments: [],
      });
      if (io) io.to(meetingId).emit('processing-update', { step: 'failed', status: 'failed', message: 'No speech detected in recording.' });
      return; // clean exit — do not throw (job counts as succeeded)
    }

    // ── SPEAKER ASSIGNMENT ─────────────────────────────────────────────────
    // Strategy (best accuracy for any meeting type):
    //
    //   TIER 1 — Pyannote + VAD (per-device audio available)
    //     Pyannote → millisecond-accurate anonymous boundaries
    //     VAD sidecar → maps SPEAKER_XX to real person identity
    //     Best for: rapid dialogue AND long monologue meetings
    //
    //   TIER 2 — VAD timeline only (Pyannote unavailable)
    //     10s window heuristic, accurate for long turns
    //
    //   TIER 3 — Pyannote only (no per-device audio)
    //     Accurate boundaries, identity matched by speaking-time rank
    //
    //   TIER 4 — LLM inference (nothing available)
    // ──────────────────────────────────────────────────────────────────────
    await updateStep(meetingId, 'diarization', 'running', 'Assigning speakers', io);

    let labeledSegments;

    const joinedAttendees = meeting.attendees.filter(a => a.attended === true || a.joinedAt !== null);
    const activeAttendees = joinedAttendees.length > 0 ? joinedAttendees : meeting.attendees;
    const attendeeNames = activeAttendees
      .map(a => `${(a.user?.firstName || '').trim()} ${(a.user?.lastName || '').trim()}`.trim())
      .filter(name => name.length > 0);

    // Always attempt Pyannote — it gives the most accurate segment boundaries
    logger.info(`Attempting Pyannote diarization (${perDeviceAudio.length > 0 ? 'will map via VAD' : 'identity by speaking time'})`);
    const diarSegments = await runWithTimeout(
      diarizeWithPyannote(localAudioPath, attendeeNames.length || perDeviceAudio.length),
      930000, // 15.5 mins (wraps the inner 15 min timeout)
      'Pyannote diarization'
    ).catch(e => { logger.warn(`Pyannote timed out or failed: ${e.message}`); return null; });

    if (diarSegments && diarSegments.length > 0 && perDeviceAudio.length > 0) {
      // TIER 1: Pyannote boundaries + VAD identity mapping (best accuracy)
      logger.info(`TIER 1: Pyannote (${diarSegments.length} segments) + VAD identity mapping`);
      labeledSegments = mapPyannoteToVadIdentities(rawSegments, diarSegments, perDeviceAudio);
      meeting.speakerDiarizationMethod = 'pyannote+vad';

    } else if (perDeviceAudio.length > 0) {
      // TIER 2: Pyannote unavailable — fall back to VAD timeline
      logger.info('TIER 2: Pyannote unavailable — VAD timeline heuristic');
      labeledSegments = await assignSpeakersFromDeviceTimeline(rawSegments, perDeviceAudio);
      meeting.speakerDiarizationMethod = 'per-device-vad';

    } else if (diarSegments && diarSegments.length > 0) {
      // TIER 3: No per-device audio — Pyannote with speaking-time identity mapping
      logger.info(`TIER 3: Pyannote only (${diarSegments.length} segments), identity by speaking time`);
      labeledSegments = mergeTranscriptWithDiarization(rawSegments, diarSegments, attendeeNames);
      meeting.speakerDiarizationMethod = 'pyannote';

    } else {
      // TIER 4: Nothing available — LLM inference
      logger.info('TIER 4: No diarization available — LLM speaker inference');
      logger.info(`Attendees for LLM inference: ${attendeeNames.join(', ')}`);
      const segmentsToLabel = rawDuration < 600 ? rawSegments : mergeShortSegments(rawSegments);
      labeledSegments = await runWithTimeout(
        inferSpeakersWithLLM(segmentsToLabel, attendeeNames),
        600000,
        'LLM speaker inference (full)'
      );
      meeting.speakerDiarizationMethod = 'llm';
    }

    // Deduplication
    const dedupedSegments = [];
    for (const seg of labeledSegments) {
      const isDup = dedupedSegments.some(ex => {
        if (ex.speaker !== seg.speaker) return false;
        const timeDiff = Math.abs((seg.startTime || seg.start || 0) - (ex.startTime || ex.start || 0));
        if (timeDiff > 3) return false;
        const a = ex.text.trim().toLowerCase(), b = seg.text.trim().toLowerCase();
        const longer = Math.max(a.length, b.length), shorter = Math.min(a.length, b.length);
        return longer > 0 && shorter / longer > 0.92;
      });
      if (!isDup) dedupedSegments.push(seg);
    }

    const transcriptSegments = dedupedSegments.map(seg => ({
      speaker: seg.speaker || 'Unknown Speaker',
      startTime: seg.startTime || seg.start || 0,
      endTime: seg.endTime || seg.end || 0,
      text: seg.text || '',
    }));

    await updateStep(meetingId, 'diarization', 'done',
      perDeviceAudio?.length > 0
        ? `Speakers assigned via per-device VAD (${perDeviceAudio.length} participants)`
        : 'Speaker identification complete',
      io
    );

    logger.info(`Final segments: ${transcriptSegments.length}, method: ${meeting.speakerDiarizationMethod}`);

    meeting.transcriptRaw = transcript || transcriptSegments.map(s => `${s.speaker}: ${s.text}`).join('\n');
    meeting.transcriptSegments = transcriptSegments;
    meeting.speakerDiarizationEditable = true;

    // ── AI ANALYSIS ───────────────────────────────────────────────────────
    await updateStep(meetingId, 'analysis', 'running', 'Analyzing meeting content', io);

    const promptTemplate = await PromptTemplate.findOne({ domain: meeting.domain, isActive: true });

    // FIX 1: meetingAnalysisChain wrapped in timeout
    const analysis = await runWithTimeout(
      meetingAnalysisChain(
        meeting.transcriptRaw,
        meeting.domain,
        meeting.attendees.map(a => a.user),
        promptTemplate || {
          systemPrompt: 'You are a meeting analyst. Analyze the meeting transcript and return structured insights.',
          userPromptTemplate: 'Analyze this {domain} meeting transcript:\n\n{transcript}\n\nAttendees: {attendees}\n\nReturn JSON with: summary, conclusions, decisions, actionItems (array with owner/task/deadline fields), followUpTopics, attendeeContributions (array with name/score/keyPoints fields)'
        },
        meeting.transcriptSegments
      ),
      180000, // 3 minutes
      'Meeting analysis LLM chain'
    );

    meeting.summary = analysis.summary;
    meeting.conclusions = analysis.conclusions || [];
    meeting.decisions = analysis.decisions || [];
    meeting.followUpTopics = analysis.followUpTopics || [];

    meeting.actionItems = (analysis.actionItems || []).map(item => {
      let deadline = null;
      if (item.deadline) { const parsed = new Date(item.deadline); deadline = isNaN(parsed.getTime()) ? null : parsed; }
      return {
        owner: meeting.attendees.find(a => {
          const name = `${a.user?.firstName} ${a.user?.lastName}`.toLowerCase();
          return name.includes((item.owner || '').toLowerCase());
        })?.user?._id || meeting.host,
        task: item.task, deadline, status: 'pending'
      };
    });

    // P1 FIX (sequential scoring): The old serial for-loop scored attendees one
    // at a time — 10 attendees × 2-min timeout = 20 min max in Step 4 alone.
    // We now run scoring in parallel batches of 3, capping total time at
    // ceil(N/3) × 120s = ~4 min for 10 attendees.
    const SCORE_CONCURRENCY = 3;
    meeting.attendeeContributions = [];

    const scoreOneAttendee = async (attendee) => {
      const name = `${attendee.user?.firstName || ''} ${attendee.user?.lastName || ''}`.trim().replace(/\s+/g, ' ');
      try {
        const contribution = await runWithTimeout(
          scoreAttendeeChain(name, meeting.transcriptRaw, meeting.domain, meeting.transcriptSegments),
          120000,
          `Score attendee ${name}`
        );
        const score = (contribution.score && !isNaN(contribution.score)) ? contribution.score : 5;
        attendee.contributionScore = score;
        attendee.keyPoints = contribution.keyPoints || [];
        meeting.attendeeContributions.push({ user: attendee.user._id, name, score, keyPoints: contribution.keyPoints || [], speakingTime: 0 });
      } catch (e) {
        logger.warn(`Score failed for ${name}: ${e.message}`);
        meeting.attendeeContributions.push({ user: attendee.user._id, name, score: 5, keyPoints: [], speakingTime: 0 });
      }
    };

    for (let i = 0; i < meeting.attendees.length; i += SCORE_CONCURRENCY) {
      await Promise.all(meeting.attendees.slice(i, i + SCORE_CONCURRENCY).map(scoreOneAttendee));
    }

    await updateStep(meetingId, 'analysis', 'done', 'Analysis complete', io);

    // ── EMBEDDINGS ────────────────────────────────────────────────────────
    await updateStep(meetingId, 'embedding', 'running', 'Storing embeddings', io);
    try {
      const speakerChunks = [];
      let currentChunk = '', currentWordCount = 0;
      const CHUNK_WORD_LIMIT = 300;
      for (const seg of meeting.transcriptSegments) {
        const line = `${seg.speaker}: ${seg.text}`;
        const wordCount = line.split(' ').length;
        if (currentWordCount + wordCount > CHUNK_WORD_LIMIT && currentChunk.length > 0) {
          speakerChunks.push(currentChunk.trim()); currentChunk = ''; currentWordCount = 0;
        }
        currentChunk += line + '\n'; currentWordCount += wordCount;
      }
      if (currentChunk.trim().length > 0) speakerChunks.push(currentChunk.trim());

      const chunks = speakerChunks.length > 0 ? speakerChunks : chunkTranscript(meeting.transcriptRaw, 300);
      const attendeeNames = meeting.attendees.map(a => `${a.user?.firstName || ''} ${a.user?.lastName || ''}`.trim()).filter(Boolean);
      const collection = await chromaClient.getCollection({ name: 'meeting_transcripts' });

      for (let i = 0; i < chunks.length; i++) {
        const embedding = await generateEmbedding(chunks[i]);
        await collection.add({
          ids: [`${meetingId}_chunk_${i}`],
          embeddings: [embedding],
          documents: [chunks[i]],
          metadatas: [{ meetingId: meetingId.toString(), domain: meeting.domain, date: meeting.scheduledDate.toISOString(), attendees: attendeeNames.join(', '), chunkIndex: i }]
        });
      }
    } catch (e) { logger.warn(`Embedding failed: ${e.message}`); }
    await updateStep(meetingId, 'embedding', 'done', 'Embeddings stored', io);

    // ── PERFORMANCE STATS ─────────────────────────────────────────────────
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
      } catch (e) { logger.warn(`Performance update failed: ${e.message}`); }
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

    logger.info(`Meeting ${meetingId} complete — method: ${meeting.speakerDiarizationMethod}`);

  } catch (error) {
    logger.error(`Processing error for meeting ${meetingId}: ${error.message}`);

    // FIX 1: Broadcast failure to the client so the UI shows 'failed'
    // instead of staying stuck on 'processing' indefinitely.
    if (io) {
      io.to(meetingId).emit('processing-update', {
        step: 'failed',
        status: 'failed',
        message: error.message,
      });
    }

    try {
      await Meeting.findByIdAndUpdate(meetingId, {
        status: 'completed',
        processingError: error.message,
        $set: { 'processingSteps.$[elem].status': 'failed' }
      }, { arrayFilters: [{ 'elem.status': 'running' }] });
    } catch (updateError) { logger.error(`Failed to update meeting status: ${updateError.message}`); }
    throw error;
  } finally {
    if (localAudioPath) { try { fs.unlinkSync(localAudioPath); } catch (_) {} }
    // Clean up the duration-probe WAV if it wasn't already consumed above
    if (durationProbeWavPath) { try { fs.unlinkSync(durationProbeWavPath); } catch (_) {} }
    for (const chunk of splitChunks) { try { fs.unlinkSync(chunk); } catch (_) {} }
  }
}

const worker = new Worker('meeting-processing', processMeeting, {
  connection: { url: process.env.REDIS_URL },
  concurrency: 2
});

worker.on('completed', (job) => logger.info(`Job ${job.id} completed`));
worker.on('failed', (job, err) => logger.error(`Job ${job.id} failed: ${err.message}`));

// 4 min — HuggingFace free-tier Spaces sleep after ~5 min idle, so we must
// ping more frequently than that to keep the pipeline warm.
const KEEP_ALIVE_INTERVAL = 4 * 60 * 1000;

async function pingDiarizationService() {
  try {
    const res = await fetch(`${DIARIZATION_URL}/health`, { timeout: 8000 });
    const data = await res.json();
    logger.info(`Diarization keep-alive: pipeline=${data.pipeline_loaded}, vad=${data.vad_loaded}`);
  } catch (e) { logger.warn(`Diarization keep-alive failed: ${e.message}`); }
}

pingDiarizationService();
const keepAliveTimer = setInterval(pingDiarizationService, KEEP_ALIVE_INTERVAL);
const workerHealthTimer = setInterval(() => { logger.info(`Worker alive, uptime: ${Math.round(process.uptime())}s`); }, 5 * 60 * 1000);

process.on('SIGTERM', () => {
  clearInterval(keepAliveTimer);
  clearInterval(workerHealthTimer);
  logger.info('Worker shutting down gracefully');
  process.exit(0);
});

module.exports = worker;