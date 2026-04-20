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
// Whisper hallucinates on silent/near-silent audio. Filter known phrases
// and fragments before they enter the transcript.
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
  "i'm sorry",
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
  'welcome',
  'welcome.',
  'welcome!',
  'thank you.',
  'thank you',
  'thanks.',
  'thanks',
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
// Groq Whisper works best with 16kHz mono WAV. Convert all WebM input.
// ─────────────────────────────────────────────────────────────────────────────
async function convertWebmToWav(inputPath) {
  const outputPath = inputPath.replace(/\.(webm|ogg|mp4)$/i, '.wav');
  if (outputPath === inputPath) return inputPath;

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => {
        logger.warn(`WebM→WAV conversion failed: ${err.message}`);
        resolve(inputPath);
      })
      .run();
  });
}

async function transcribeWithGroq(audioPath) {
  try {
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
    });

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
// SPEAKER ASSIGNMENT FROM PER-DEVICE CHUNK TIMELINE
//
// HYBRID APPROACH — separates two concerns that were incorrectly merged:
//
//   TRANSCRIPTION QUALITY  → use the mixed audio recording (one continuous
//                             Whisper call, full sentence context, no chunk
//                             gaps, no 10s boundary hallucinations)
//
//   SPEAKER IDENTITY       → use per-device chunk timestamps (each device's
//                             chunk covers a known wall-clock window, so we
//                             know who was recording at each second)
//
// How it works:
//   Each per-device chunk covers [timestamp - CHUNK_DURATION_MS, timestamp].
//   We convert these to seconds relative to meetingEpoch to get a coverage
//   window per participant per chunk.
//
//   For each Whisper segment from the mixed audio, we find its midpoint in
//   the meeting timeline, then look for which participant's chunk window
//   covers that midpoint. That participant is assigned as the speaker.
//
//   If multiple participants' windows overlap at the same moment (both mics
//   were active), we pick the one whose window start is closest to the
//   segment midpoint — i.e. the most recently started chunk, which is the
//   most likely active speaker at that instant.
//
//   If no window covers the segment (gap between chunks), we fall back to
//   the participant whose most recent window end is closest to the midpoint.
// ─────────────────────────────────────────────────────────────────────────────
async function assignSpeakersFromDeviceTimeline(segments, perDeviceAudio) {
  if (!segments.length || !perDeviceAudio.length) return segments;

  // Compute meeting epoch — earliest recordingStartTime across all devices
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

  // Build coverage windows: { userName, userId, windowStart (s), windowEnd (s) }
  const windows = [];

  for (const device of perDeviceAudio) {
    if (!Array.isArray(device.chunks) || device.chunks.length === 0) continue;

    for (const chunk of device.chunks) {
      const chunkEndMs   = chunk.timestamp;
      const chunkStartMs = chunkEndMs - CHUNK_DURATION_MS;
      const windowStart  = Math.max(0, (chunkStartMs - meetingEpoch) / 1000);
      const windowEnd    = Math.max(0, (chunkEndMs   - meetingEpoch) / 1000);

      windows.push({
        userName:       device.userName,
        userId:         device.userId,
        windowStart,
        windowEnd,
      });
    }
  }

  logger.info(`Built ${windows.length} device windows for ${perDeviceAudio.length} participants`);

  // Assign each segment to the best-matching participant
  return segments.map(seg => {
    const midpoint = ((seg.startTime || seg.start || 0) + (seg.endTime || seg.end || 0)) / 2;

    // All windows covering this midpoint
    const covering = windows.filter(w => w.windowStart <= midpoint && w.windowEnd >= midpoint);

    let assignedName;

    if (covering.length === 1) {
      // Unambiguous — only one participant was recording at this moment
      assignedName = covering[0].userName;
    } else if (covering.length > 1) {
      // Multiple participants' chunks overlap — pick the one whose window
      // started most recently (closest windowStart to midpoint from the left)
      const best = covering.reduce((a, b) =>
        Math.abs(a.windowStart - midpoint) < Math.abs(b.windowStart - midpoint) ? a : b
      );
      assignedName = best.userName;
    } else {
      // No chunk covers this moment — find nearest window end (gap between chunks)
      if (windows.length === 0) {
        assignedName = perDeviceAudio[0]?.userName || 'Unknown';
      } else {
        const nearest = windows.reduce((a, b) =>
          Math.abs(a.windowEnd - midpoint) < Math.abs(b.windowEnd - midpoint) ? a : b
        );
        assignedName = nearest.userName;
      }
    }

    return {
      ...seg,
      speaker:   assignedName,
      startTime: seg.startTime || seg.start || 0,
      endTime:   seg.endTime   || seg.end   || 0,
    };
  });
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

    // ── HYBRID PIPELINE ───────────────────────────────────────────────────
    //
    // Always transcribe the MIXED audio for best quality.
    // If per-device chunks are available, use their timestamps for speaker
    // assignment instead of pyannote/LLM — this is more accurate and free.
    //
    // Why not transcribe per-device chunks directly?
    //   • 10s WebM chunks are too short for Whisper — sentence context is
    //     lost at chunk boundaries causing hallucinations and fragmentation
    //   • Silent chunks (participant not speaking) produce hallucinated filler
    //   • The mixed recording has full sentence context and no gap artifacts
    //
    // ─────────────────────────────────────────────────────────────────────

    if (!audioKey) {
      throw new Error('No mixed audio recording available — cannot transcribe');
    }

    logger.info('Transcribing mixed audio (hybrid pipeline)');

    const localAudioPath = await downloadAudio(audioKey);
    const rawDuration = await getAudioDuration(localAudioPath);
    meeting.actualDuration = (rawDuration && !isNaN(rawDuration)) ? Math.round(rawDuration / 60) : 0;

    logger.info(`Audio duration: ${rawDuration}s`);

    // Transcribe
    let groqResult = null;
    const fileSizeMB = fs.statSync(localAudioPath).size / (1024 * 1024);

    if (fileSizeMB > 24 || rawDuration > 600) {
      logger.info('Large file — splitting into 10-minute WAV chunks');
      const audioChunks = await splitAudio(localAudioPath);
      let timeOffset = 0;
      const allSegs = [];
      let fullText = '';

      for (const chunk of audioChunks) {
        const r = await transcribeWithGroq(chunk);
        fullText += (r?.text || '') + '\n';
        (r?.segments || []).forEach(seg => {
          if (!isHallucination(seg.text)) {
            allSegs.push({
              ...seg,
              start: (seg.start || 0) + timeOffset,
              end:   (seg.end   || 0) + timeOffset,
            });
          }
        });
        timeOffset += 600;
        try { fs.unlinkSync(chunk); } catch (_) {}
      }
      groqResult = { text: fullText, segments: allSegs };
    } else {
      groqResult = await transcribeWithGroq(localAudioPath);
    }

    transcript = groqResult?.text || '';
    meeting.transcriptRaw = transcript;

    logger.info(`Transcription done: ${transcript.length} chars, ${groqResult?.segments?.length || 0} segments`);
    await updateStep(meetingId, 'transcription', 'done', 'Transcription complete', io);

    // Filter hallucinations from raw segments
    const rawSegments = (groqResult?.segments || [])
      .map(seg => ({
        text:      seg.text?.trim() || '',
        startTime: seg.start || 0,
        endTime:   seg.end   || 0,
        start:     seg.start || 0,
        end:       seg.end   || 0,
      }))
      .filter(seg => seg.text.length > 0 && !isHallucination(seg.text));

    logger.info(`Segments after hallucination filter: ${rawSegments.length}`);

    // ── SPEAKER ASSIGNMENT ────────────────────────────────────────────────
    await updateStep(meetingId, 'diarization', 'running', 'Assigning speakers', io);

    let labeledSegments;

    if (perDeviceAudio && perDeviceAudio.length > 0) {
      // PATH A: Per-device chunk timeline — most accurate, no API cost
      logger.info('Assigning speakers from per-device chunk timeline');
      labeledSegments = await assignSpeakersFromDeviceTimeline(rawSegments, perDeviceAudio);
      meeting.speakerDiarizationMethod = 'per-device-timeline';
    } else {
      // PATH B: No per-device data — fall back to pyannote or LLM
      logger.info('No per-device audio — falling back to diarization');

      const joinedAttendees = meeting.attendees.filter(
        a => a.attended === true || a.joinedAt !== null
      );
      const activeAttendees = joinedAttendees.length > 0 ? joinedAttendees : meeting.attendees;
      const attendeeNames = activeAttendees
        .map(a => `${(a.user?.firstName || '').trim()} ${(a.user?.lastName || '').trim()}`.trim())
        .filter(name => name.length > 0);

      logger.info(`Attendees for diarization: ${attendeeNames.join(', ')}`);

      const diarSegments = await diarizeWithPyannote(localAudioPath, attendeeNames.length);

      if (diarSegments && diarSegments.length > 0) {
        logger.info(`Using pyannote diarization (${diarSegments.length} segments)`);
        labeledSegments = mergeTranscriptWithDiarization(rawSegments, diarSegments, attendeeNames);
        meeting.speakerDiarizationMethod = 'pyannote';
      } else {
        logger.info('Pyannote unavailable — using LLM speaker inference');
        const segmentsToLabel = rawDuration < 600 ? rawSegments : mergeShortSegments(rawSegments);
        labeledSegments = await inferSpeakersWithLLM(segmentsToLabel, attendeeNames);
        meeting.speakerDiarizationMethod = 'llm';
      }
    }

    // Deduplication — same speaker only, tight 3s window, 0.92 threshold
    const dedupedSegments = [];
    for (const seg of labeledSegments) {
      const isDup = dedupedSegments.some(ex => {
        if (ex.speaker !== seg.speaker) return false;
        const timeDiff = Math.abs((seg.startTime || seg.start || 0) - (ex.startTime || ex.start || 0));
        if (timeDiff > 3) return false;
        const a = ex.text.trim().toLowerCase();
        const b = seg.text.trim().toLowerCase();
        const longer = Math.max(a.length, b.length);
        const shorter = Math.min(a.length, b.length);
        return longer > 0 && shorter / longer > 0.92;
      });
      if (!isDup) dedupedSegments.push(seg);
    }

    transcriptSegments = dedupedSegments.map(seg => ({
      speaker:   seg.speaker   || 'Unknown Speaker',
      startTime: seg.startTime || seg.start || 0,
      endTime:   seg.endTime   || seg.end   || 0,
      text:      seg.text      || '',
    }));

    try { fs.unlinkSync(localAudioPath); } catch (_) {}

    await updateStep(meetingId, 'diarization', 'done',
      perDeviceAudio?.length > 0
        ? `Speakers assigned via per-device timeline (${perDeviceAudio.length} participants)`
        : 'Speaker identification complete',
      io
    );

    logger.info(`Final segments: ${transcriptSegments.length}, method: ${meeting.speakerDiarizationMethod}`);

    meeting.transcriptRaw = transcript || transcriptSegments.map(s => `${s.speaker}: ${s.text}`).join('\n');
    meeting.transcriptSegments = transcriptSegments;
    meeting.speakerDiarizationEditable = true;

    // ── ANALYSIS ──────────────────────────────────────────────────────────
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

    meeting.summary        = analysis.summary;
    meeting.conclusions    = analysis.conclusions    || [];
    meeting.decisions      = analysis.decisions      || [];
    meeting.followUpTopics = analysis.followUpTopics || [];

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
        attendee.keyPoints         = contribution.keyPoints || [];

        meeting.attendeeContributions.push({
          user:        attendee.user._id,
          name,
          score,
          keyPoints:   contribution.keyPoints || [],
          speakingTime: 0
        });
      } catch (e) {
        logger.warn(`Score failed for ${name}: ${e.message}`);
        meeting.attendeeContributions.push({
          user: attendee.user._id, name, score: 5, keyPoints: [], speakingTime: 0
        });
      }
    }

    await updateStep(meetingId, 'analysis', 'done', 'Analysis complete', io);

    // ── EMBEDDINGS ────────────────────────────────────────────────────────
    await updateStep(meetingId, 'embedding', 'running', 'Storing embeddings', io);
    try {
      const speakerChunks = [];
      let currentChunk = '';
      let currentWordCount = 0;
      const CHUNK_WORD_LIMIT = 300;

      for (const seg of meeting.transcriptSegments) {
        const line      = `${seg.speaker}: ${seg.text}`;
        const wordCount = line.split(' ').length;
        if (currentWordCount + wordCount > CHUNK_WORD_LIMIT && currentChunk.length > 0) {
          speakerChunks.push(currentChunk.trim());
          currentChunk = '';
          currentWordCount = 0;
        }
        currentChunk     += line + '\n';
        currentWordCount += wordCount;
      }
      if (currentChunk.trim().length > 0) speakerChunks.push(currentChunk.trim());

      const chunks       = speakerChunks.length > 0 ? speakerChunks : chunkTranscript(meeting.transcriptRaw, 300);
      const attendeeNames = meeting.attendees
        .map(a => `${a.user?.firstName || ''} ${a.user?.lastName || ''}`.trim())
        .filter(Boolean);

      const collection = await chromaClient.getCollection({ name: 'meeting_transcripts' });
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await generateEmbedding(chunks[i]);
        await collection.add({
          ids:        [`${meetingId}_chunk_${i}`],
          embeddings: [embedding],
          documents:  [chunks[i]],
          metadatas:  [{
            meetingId:  meetingId.toString(),
            domain:     meeting.domain,
            date:       meeting.scheduledDate.toISOString(),
            attendees:  attendeeNames.join(', '),
            chunkIndex: i
          }]
        });
      }
    } catch (e) {
      logger.warn(`Embedding failed: ${e.message}`);
    }
    await updateStep(meetingId, 'embedding', 'done', 'Embeddings stored', io);

    // ── PERFORMANCE STATS ─────────────────────────────────────────────────
    for (const attendee of meeting.attendees) {
      try {
        const performance = await Performance.findOne({ user: attendee.user._id });
        if (performance) {
          performance.meetingStats = performance.meetingStats || { totalMeetings: 0, avgContributionScore: 0 };
          performance.meetingStats.totalMeetings += 1;
          const prevAvg   = performance.meetingStats.avgContributionScore || 0;
          const prevCount = performance.meetingStats.totalMeetings - 1;
          const newScore  = attendee.contributionScore || 5;
          const newAvg    = (prevAvg * prevCount + newScore) / performance.meetingStats.totalMeetings;
          performance.meetingStats.avgContributionScore = isNaN(newAvg) ? 5 : newAvg;
          await performance.save();
        }
      } catch (e) {
        logger.warn(`Performance update failed: ${e.message}`);
      }
    }

    await Meeting.findByIdAndUpdate(meetingId, {
      status:                    'ready',
      transcriptRaw:             meeting.transcriptRaw,
      transcriptSegments:        meeting.transcriptSegments,
      speakerDiarizationMethod:  meeting.speakerDiarizationMethod,
      speakerDiarizationEditable: meeting.speakerDiarizationEditable,
      actualDuration:            meeting.actualDuration,
      summary:                   meeting.summary,
      conclusions:               (meeting.conclusions    || []).filter(Boolean),
      decisions:                 (meeting.decisions      || []).filter(Boolean),
      followUpTopics:            (meeting.followUpTopics || []).filter(Boolean),
      actionItems:               (meeting.actionItems    || []).filter(item => item && item.task),
      attendeeContributions:     (meeting.attendeeContributions || []).filter(Boolean),
      attendees:                  meeting.attendees,
    }, { new: true });

    await updateStep(meetingId, 'ready', 'done', 'Meeting processing complete', io);

    await Notification.create({
      user:       meeting.host,
      type:       'meeting_ready',
      title:      'Meeting analysis ready',
      message:    `"${meeting.name}" has been processed and is ready for review`,
      link:       `/meetings/${meeting._id}`,
      entityType: 'meeting',
      entityId:   meeting._id
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
worker.on('failed',    (job, err) => logger.error(`Job ${job.id} failed: ${err.message}`));

const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000;

async function pingDiarizationService() {
  try {
    const res  = await fetch(`${DIARIZATION_URL}/health`, { timeout: 8000 });
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
const keepAliveTimer    = setInterval(pingDiarizationService, KEEP_ALIVE_INTERVAL);
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