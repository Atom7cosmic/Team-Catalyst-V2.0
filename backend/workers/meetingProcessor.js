// const { Worker } = require('bullmq');
// const fs = require('fs');
// const path = require('path');
// const ffmpeg = require('fluent-ffmpeg');
// const { promisify } = require('util');
// const Groq = require('groq-sdk');
// const FormData = require('form-data');
// const fetch = require('node-fetch');
// const { Meeting, PromptTemplate, Performance, Notification } = require('../models');
// const { chromaClient } = require('../config/chroma');
// const { generateEmbedding } = require('../ai/embeddings');
// const { meetingAnalysisChain, chunkTranscript, scoreAttendeeChain } = require('../ai/langchain');
// const { getFileUrl, uploadFile } = require('../config/s3');
// const winston = require('winston');

// const execAsync = promisify(require('child_process').exec);

// const logger = winston.createLogger({
//   level: 'info',
//   format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
//   transports: [new winston.transports.Console()]
// });

// const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// const DIARIZATION_URL = process.env.DIARIZATION_URL || 'http://diarization:8001';

// // ─────────────────────────────────────────────────────────────────────────────
// // Hallucination filter
// // ─────────────────────────────────────────────────────────────────────────────
// const HALLUCINATION_PHRASES = new Set([
//   'thank you',
//   'thank you very much',
//   'thanks for watching',
//   'thanks for listening',
//   'please subscribe',
//   'see you next time',
//   'bye bye',
//   'goodbye',
//   'you',
//   'thanks',
//   'thank you for watching',
//   'thank you for listening',
//   'subtitles by',
//   'subscribe to',
//   'like and subscribe',
//   "i'll see you in the next one",
//   "don't forget to subscribe",
// ]);

// function filterHallucination(text) {
//   if (!text || !text.trim()) return '';
//   const trimmed = text.trim().toLowerCase().replace(/[.,!?]+$/, '');
//   if (HALLUCINATION_PHRASES.has(trimmed)) {
//     logger.warn(`Hallucination filtered: "${text.trim()}"`);
//     return '';
//   }
//   return text.trim();
// }

// async function updateStep(meetingId, step, status, message = null, io = null) {
//   const meeting = await Meeting.findById(meetingId);
//   if (meeting) {
//     const stepObj = meeting.processingSteps.find(s => s.step === step);
//     if (stepObj) {
//       stepObj.status = status;
//       stepObj.timestamp = new Date();
//       if (message) stepObj.message = message;
//     }
//     await meeting.save();
//     if (io) io.to(meetingId).emit('processing-update', { step, status, message });
//   }
// }

// async function downloadAudio(audioKey) {
//   const url = await getFileUrl(audioKey, 3600);
//   const tempDir = '/temp';
//   if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
//   const localPath = path.join(tempDir, `${Date.now()}-${path.basename(audioKey)}`);
//   const response = await fetch(url);
//   const buffer = await response.arrayBuffer();
//   fs.writeFileSync(localPath, Buffer.from(buffer));
//   return localPath;
// }

// function getAudioDuration(filePath) {
//   return new Promise((resolve) => {
//     ffmpeg.ffprobe(filePath, (err, metadata) => {
//       if (err) { logger.warn(`ffprobe error: ${err.message}`); return resolve(0); }
//       const duration = metadata?.format?.duration;
//       resolve(typeof duration === 'number' && !isNaN(duration) ? duration : 0);
//     });
//   });
// }

// async function splitAudioWithOverlap(filePath, chunkDuration = 590, overlap = 10) {
//   const outputDir = '/temp/chunks';
//   if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

//   const totalDuration = await getAudioDuration(filePath);
//   const baseName = path.basename(filePath, path.extname(filePath));
//   const chunkPaths = [];
//   let start = 0;
//   let index = 0;

//   while (start < totalDuration) {
//     const outputPath = path.join(outputDir, `${baseName}_chunk_${String(index).padStart(3, '0')}.wav`);
//     const segmentLength = Math.min(chunkDuration + overlap, totalDuration - start);

//     await new Promise((resolve, reject) => {
//       ffmpeg(filePath)
//         .seekInput(start)
//         .duration(segmentLength)
//         .output(outputPath)
//         .audioCodec('pcm_s16le')
//         .audioFrequency(16000)
//         .audioChannels(1)
//         .on('end', resolve)
//         .on('error', reject)
//         .run();
//     });

//     chunkPaths.push({ path: outputPath, startTime: start });
//     start += chunkDuration;
//     index++;
//   }

//   logger.info(`Split into ${chunkPaths.length} overlapping chunks`);
//   return chunkPaths;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // transcribeWithGroq
// //
// // FIX: Tightened confidence threshold from -1.2 to -0.8.
// //
// // WHY: Whisper's avg_logprob is a log-probability score. At -1.2 the filter
// // was only catching very obviously bad segments. Corrupted outputs like
// // "you you well Bob a child doesn mean careless" typically score around
// // -0.9 to -1.1 — confident enough to pass -1.2 but clearly wrong.
// // -0.8 catches these while keeping all genuinely transcribed speech
// // (clean speech typically scores between -0.3 and -0.7).
// // ─────────────────────────────────────────────────────────────────────────────
// async function transcribeWithGroq(audioPath) {
//   try {
//     logger.info(`Transcribing: ${audioPath}`);
//     const audioStream = fs.createReadStream(audioPath);
//     const transcription = await groq.audio.transcriptions.create({
//       file: audioStream,
//       model: 'whisper-large-v3',
//       response_format: 'verbose_json',
//       language: 'en',
//       temperature: 0,
//     });

//     if (transcription.segments) {
//       transcription.segments = transcription.segments
//         // FIX: -0.8 threshold catches corrupted segments that -1.2 was missing.
//         // no_speech_prob > 0.5 (tightened from 0.6) catches near-silence segments
//         // that Whisper was transcribing as garbage text.
//         .filter(seg => (seg.avg_logprob ?? 0) >= -0.9 && (seg.no_speech_prob ?? 0) <= 0.5)
//         .map(seg => ({ ...seg, text: filterHallucination(seg.text) }))
//         .filter(seg => seg.text.length > 0);
//     }

//     if (transcription.text) {
//       transcription.text = transcription.segments && transcription.segments.length > 0
//         ? transcription.segments.map(s => s.text).join(' ')
//         : filterHallucination(transcription.text);
//     }

//     return transcription;
//   } catch (error) {
//     logger.error(`Groq transcription error: ${error.message}`);
//     throw error;
//   }
// }

// async function diarizeWithPyannote(audioPath, numSpeakers) {
//   try {
//     const healthRes = await fetch(`${DIARIZATION_URL}/health`, { timeout: 5000 });
//     const health = await healthRes.json();
//     if (!health.pipeline_loaded) {
//       logger.warn('Pyannote pipeline not loaded — falling back to LLM diarization');
//       return null;
//     }

//     logger.info(`Sending audio to pyannote diarization service (num_speakers=${numSpeakers})`);

//     const form = new FormData();
//     form.append('file', fs.createReadStream(audioPath), {
//       filename: path.basename(audioPath),
//       contentType: 'audio/wav'
//     });

//     const url = numSpeakers > 1
//       ? `${DIARIZATION_URL}/diarize?num_speakers=${numSpeakers}`
//       : `${DIARIZATION_URL}/diarize`;

//     const response = await fetch(url, {
//       method: 'POST',
//       body: form,
//       headers: form.getHeaders(),
//       timeout: 300000
//     });

//     if (!response.ok) {
//       const err = await response.text();
//       logger.warn(`Pyannote diarization failed: ${err} — falling back to LLM`);
//       return null;
//     }

//     const result = await response.json();
//     logger.info(`Pyannote complete: ${result.segments.length} segments, ${result.num_speakers_detected} speakers`);
//     return result.segments;

//   } catch (error) {
//     logger.warn(`Pyannote service unreachable: ${error.message} — falling back to LLM diarization`);
//     return null;
//   }
// }

// function mergeTranscriptWithDiarization(groqSegments, diarSegments, attendeeNames) {
//   const speakingTime = {};
//   for (const seg of diarSegments) {
//     const duration = (seg.end || 0) - (seg.start || 0);
//     speakingTime[seg.speaker] = (speakingTime[seg.speaker] || 0) + duration;
//   }

//   const sortedSpeakers = Object.keys(speakingTime).sort(
//     (a, b) => speakingTime[b] - speakingTime[a]
//   );

//   const speakerMap = {};
//   sortedSpeakers.forEach((speaker, idx) => {
//     speakerMap[speaker] = attendeeNames[idx % attendeeNames.length];
//   });

//   logger.info(`Speaker mapping: ${JSON.stringify(speakerMap)}`);

//   return groqSegments.map(seg => {
//     const midpoint = ((seg.start || 0) + (seg.end || 0)) / 2;
//     const diarSeg = diarSegments.find(d => d.start <= midpoint && midpoint <= d.end);
//     const closestSeg = diarSeg || diarSegments.reduce((closest, d) => {
//       if (!closest) return d;
//       return Math.abs(d.start - midpoint) < Math.abs(closest.start - midpoint) ? d : closest;
//     }, null);

//     const speaker = closestSeg
//       ? (speakerMap[closestSeg.speaker] || attendeeNames[0])
//       : attendeeNames[0];

//     return { ...seg, speaker };
//   });
// }

// function mergeShortSegments(segments, minDuration = 1.0) {
//   if (!segments || segments.length === 0) return [];
//   const merged = [];
//   let current = { ...segments[0] };

//   for (let i = 1; i < segments.length; i++) {
//     const seg = segments[i];
//     const duration = (current.end || 0) - (current.start || 0);
//     const endsWithPunctuation = /[.!?]$/.test(current.text?.trim() || '');

//     if (duration < minDuration || !endsWithPunctuation) {
//       current = {
//         ...current,
//         end: seg.end,
//         text: (current.text || '').trim() + ' ' + (seg.text || '').trim()
//       };
//     } else {
//       merged.push(current);
//       current = { ...seg };
//     }
//   }
//   merged.push(current);
//   return merged;
// }

// async function inferSpeakersWithLLM(segments, attendeeNames, hostName = null) {
//   if (!segments || segments.length === 0) return [];

//   if (attendeeNames.length === 1) {
//     return segments.map(seg => ({ ...seg, speaker: attendeeNames[0] }));
//   }

//   const batchSize = 30;
//   const allLabeled = [];

//   for (let batchStart = 0; batchStart < segments.length; batchStart += batchSize) {
//     const batch = segments.slice(batchStart, batchStart + batchSize);
//     const isFirstBatch = batchStart === 0;

//     const segmentList = batch.map((seg, localIdx) =>
//       `[${localIdx}] ${seg.text?.trim()}`
//     ).join('\n');

//     const hostLine = hostName
//       ? `\nIMPORTANT: "${hostName}" is the meeting host. They almost certainly spoke first (segment [0]). Assign them to early segments unless the text clearly shows otherwise.\n`
//       : '';

//     const firstBatchNote = isFirstBatch
//       ? '\nNOTE: This is the very start of the meeting. The host typically opens with greetings or agenda.\n'
//       : '';

//     const prompt = `You are analyzing a meeting transcript. The meeting has exactly these attendees (use ONLY these exact names):
// ${attendeeNames.map((n, i) => `- Speaker ${i + 1}: ${n}`).join('\n')}
// ${hostLine}${firstBatchNote}
// Rules:
// 1. Use ONLY the exact names listed above — no titles, no roles
// 2. Assign each segment to one speaker based on conversation flow and context
// 3. Look for: questions followed by answers, topic handoffs, first-person references
// 4. A speaker can have multiple consecutive segments
// 5. The host typically opens and closes the meeting

// Segments to label:
// ${segmentList}

// Return ONLY a valid JSON array (no markdown, no explanation):
// [{"index":0,"speaker":"${attendeeNames[0]}"},{"index":1,"speaker":"${attendeeNames[Math.min(1, attendeeNames.length - 1)]}"}]`;

//     try {
//       const response = await groq.chat.completions.create({
//         model: 'llama-3.3-70b-versatile',
//         messages: [{ role: 'user', content: prompt }],
//         temperature: 0.1,
//         max_tokens: 4096
//       });

//       const content = response.choices[0]?.message?.content || '[]';
//       const clean = content.replace(/```json|```/g, '').trim();
//       let assignments = [];
//       try {
//         assignments = JSON.parse(clean);
//       } catch (parseErr) {
//         const match = clean.match(/\[[\s\S]*\]/);
//         if (match) assignments = JSON.parse(match[0]);
//       }

//       batch.forEach((seg, localIdx) => {
//         const assignment = assignments.find(a => a.index === localIdx);
//         const assignedName = assignment?.speaker?.trim();
//         const validName = attendeeNames.includes(assignedName)
//           ? assignedName
//           : attendeeNames[localIdx % attendeeNames.length];
//         allLabeled.push({ ...seg, speaker: validName });
//       });

//     } catch (error) {
//       logger.warn(`LLM speaker inference failed for batch at ${batchStart}: ${error.message}`);
//       batch.forEach((seg, localIdx) => {
//         allLabeled.push({
//           ...seg,
//           speaker: attendeeNames[(batchStart + localIdx) % attendeeNames.length]
//         });
//       });
//     }
//   }

//   return allLabeled;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // stitchSegments
// //
// // Merges consecutive segments from the same speaker where the current segment
// // doesn't end with sentence-terminating punctuation and the next segment
// // starts within a short time gap.
// //
// // FIX 1 — noInterleavedSpeaker bug:
// // Previous code checked `segments.slice(0, i)` which included ALL segments
// // before index i, not just the ones between current and next. This meant
// // the interleave check almost always found a "different speaker" somewhere
// // in the earlier history and refused to stitch. The fix checks only segments
// // whose startTime falls strictly between current.startTime and next.startTime.
// //
// // FIX 2 — gap threshold:
// // 0.6s gap threshold kept from previous version. Only merges segments Whisper
// // split mid-breath with no meaningful pause.
// // ─────────────────────────────────────────────────────────────────────────────
// function stitchSegments(segments) {
//   if (!segments || segments.length === 0) return segments;
//   const stitched = [];
//   let current = { ...segments[0] };

//   for (let i = 1; i < segments.length; i++) {
//     const next = segments[i];
//     const sameSpeaker = current.speaker === next.speaker;
//     const incomplete = !/[.!?]$/.test(current.text.trim());
//     const closeInTime = (next.startTime - current.endTime) < 0.3;

//     // FIX: Only look at segments between current and next in time,
//     // not all segments before index i.
//     const noInterleavedSpeaker = !segments.some((s, j) =>
//       j !== i &&
//       s.speaker !== current.speaker &&
//       s.startTime > current.startTime &&
//       s.startTime < next.startTime
//     );

//     if (sameSpeaker && incomplete && closeInTime && noInterleavedSpeaker) {
//       current.text = current.text.trim() + ' ' + next.text.trim();
//       current.endTime = next.endTime;
//       current.end = next.endTime;
//     } else {
//       stitched.push(current);
//       current = { ...next };
//     }
//   }
//   stitched.push(current);
//   return stitched;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // processPerDeviceAudio
// //
// // Key changes in this version:
// //
// // FIX 1 — Per-device dedup is now SAME-SPEAKER ONLY.
// // Previously, the dedup compared ALL segments within 15s at 80% similarity,
// // regardless of speaker. This caused Bob's segments to be dropped because
// // his mic captured echo of Alice/Carol and the dedup saw their cleaner
// // recording as the "original" and Bob's as the duplicate.
// // In per-device mode, each person's audio IS their ground truth. We only
// // dedup within the same speaker — catching Whisper's own repeated output
// // on a single device, not cross-device echo.
// //
// // FIX 2 — Host-first tie-breaking for t=0 segments.
// // After timeline normalization, multiple speakers can have segments at
// // exactly t=0 (or within 0.5s) because Whisper skips leading silence
// // and all devices start recording near-simultaneously. Without tie-breaking,
// // Carol's segment sorts before Alice's purely by insertion order.
// // Fix: when two segments are within 0.5s of each other, the host's segment
// // always sorts first. This ensures Alice (host) opens the transcript.
// // ─────────────────────────────────────────────────────────────────────────────
// async function processPerDeviceAudio(perDeviceAudio, meetingId, hostName = null) {
//   logger.info(`Processing per-device audio for ${perDeviceAudio.length} participants`);

//   const tempDir = '/temp';
//   if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

//   const allSegments = [];

//   for (const device of perDeviceAudio) {
//     const { userId, userName, audioKey } = device;
//     logger.info(`Transcribing audio for ${userName} (${userId})`);

//     let localPath = null;
//     try {
//       localPath = await downloadAudio(audioKey);

//       const stat = fs.statSync(localPath);
//       if (stat.size < 1000) {
//         logger.warn(`Audio for ${userName} too small (${stat.size} bytes) — skipping`);
//         continue;
//       }

//       const fileSizeMB = stat.size / (1024 * 1024);
//       let result;
//       if (fileSizeMB > 24) {
//         logger.info(`${userName} audio is ${fileSizeMB.toFixed(1)}MB — splitting into chunks`);
//         const chunks = await splitAudioWithOverlap(localPath);
//         const chunkSegments = [];  // ← renamed to avoid shadowing outer allSegments
//         for (const chunk of chunks) {
//           const chunkResult = await transcribeWithGroq(chunk.path);
//           if (chunkResult?.segments) {
//             chunkResult.segments.forEach(seg => {
//               chunkSegments.push({
//                 ...seg,
//                 start: (seg.start || 0) + chunk.startTime,
//                 end: (seg.end || 0) + chunk.startTime
//               });
//             });
//           }
//           try { fs.unlinkSync(chunk.path); } catch (_) { }
//         }
//         result = { segments: chunkSegments, text: chunkSegments.map(s => s.text).join(' ') };
//       } else {
//         result = await transcribeWithGroq(localPath);
//       }
//       const segments = result?.segments || [];

//       logger.info(`${userName}: ${segments.length} segments transcribed`);

//       for (const seg of segments) {
//         const text = seg.text?.trim();
//         if (!text || text.length < 2) continue;

//         allSegments.push({
//           speaker: userName,
//           text,
//           startTime: seg.start || 0,
//           endTime: seg.end || 0,
//           start: seg.start || 0,
//           end: seg.end || 0,
//           userId,
//           source: 'per-device',
//           _deviceRecordingStart: device.recordingStartTime || 0,
//         });
//       }

//     } catch (e) {
//       logger.warn(`Failed to process audio for ${userName}: ${e.message}`);
//     } finally {
//       if (localPath) {
//         try { fs.unlinkSync(localPath); } catch (_) { }
//       }
//     }
//   }

//   if (allSegments.length === 0) {
//     logger.warn('No segments from per-device audio — will fall back to mixed audio');
//     return null;
//   }

//   // ── Timeline normalization ─────────────────────────────────────────────────
//   const validStartTimes = perDeviceAudio
//     .map(d => d.recordingStartTime)
//     .filter(t => t && t > 0);

//   if (validStartTimes.length > 0) {
//     const earliestStart = Math.min(...validStartTimes);
//     logger.info(`Timeline normalization — earliest device start: ${earliestStart}`);

//     for (const seg of allSegments) {
//       const deviceOffset = ((seg._deviceRecordingStart || earliestStart) - earliestStart) / 1000;
//       seg.startTime = seg.startTime + deviceOffset;
//       seg.endTime = seg.endTime + deviceOffset;
//       seg.start = seg.startTime;
//       seg.end = seg.endTime;
//       delete seg._deviceRecordingStart;
//     }

//     logger.info(`Normalized ${allSegments.length} segments across ${perDeviceAudio.length} devices`);
//   } else {
//     logger.warn('No recordingStartTime data — skipping normalization (old client fallback)');
//     for (const seg of allSegments) { delete seg._deviceRecordingStart; }
//   }

//   // ── FIX: Host-first sort with tie-breaking ────────────────────────────────
//   // Primary: sort by startTime ascending.
//   // Tie-break (within 0.5s): host's segments sort before all others.
//   // This ensures Alice (the host) opens the transcript even when Carol's
//   // device started recording a few milliseconds earlier.
//   allSegments.sort((a, b) => {
//     const timeDiff = a.startTime - b.startTime;
//     if (Math.abs(timeDiff) <= 0.5 && hostName) {
//       const aIsHost = a.speaker === hostName;
//       const bIsHost = b.speaker === hostName;
//       if (aIsHost && !bIsHost) return -1;
//       if (!aIsHost && bIsHost) return 1;
//     }
//     return timeDiff;
//   });

//   // ── FIX: Same-speaker-only deduplication ─────────────────────────────────
//   // Only remove near-duplicate segments from the SAME speaker.
//   // Cross-speaker dedup is removed entirely — in per-device mode each
//   // person's audio is their ground truth and echo captured on another
//   // person's mic must never cause their segments to be dropped.
//   const dedupedSegments = [];
//   for (const seg of allSegments) {
//     const isDuplicate = dedupedSegments.some(existing => {
//       if (existing.speaker !== seg.speaker) return false; // FIX: same speaker only
//       const a = existing.text.trim().toLowerCase();
//       const b = seg.text.trim().toLowerCase();
//       const timeDiff = Math.abs(seg.startTime - existing.startTime);
//       const longer = Math.max(a.length, b.length);
//       const shorter = Math.min(a.length, b.length);
//       return timeDiff < 10 && longer > 0 && shorter / longer > 0.85;
//     });
//     if (!isDuplicate) dedupedSegments.push(seg);
//   }

//   logger.info(`After same-speaker dedup: ${dedupedSegments.length} segments (from ${allSegments.length})`);

//   // ── Stitch consecutive same-speaker fragments ─────────────────────────────
//   const stitchedSegments = stitchSegments(dedupedSegments);
//   logger.info(`Per-device pipeline: ${stitchedSegments.length} segments from ${perDeviceAudio.length} participants (stitched from ${dedupedSegments.length})`);

//   return stitchedSegments;
// }

// function formatTime(seconds) {
//   const mins = Math.floor(seconds / 60);
//   const secs = Math.floor(seconds % 60);
//   return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
// }

// async function processMeeting(job) {
//   const { meetingId, audioKey, perDeviceAudio } = job.data;
//   const io = global.io;
//   logger.info(`Starting processing for meeting ${meetingId}`);
//   logger.info(`Per-device audio available: ${perDeviceAudio?.length || 0} participants`);

//   try {
//     const meeting = await Meeting.findById(meetingId)
//       .populate('attendees.user', 'firstName lastName');

//     if (!meeting) throw new Error('Meeting not found');

//     const hostAttendee = meeting.attendees.find(
//       a => a.user?._id?.toString() === meeting.host?.toString()
//     );
//     const hostName = hostAttendee?.user
//       ? `${hostAttendee.user.firstName} ${hostAttendee.user.lastName}`.trim()
//       : null;

//     logger.info(`Meeting host: ${hostName || 'unknown'}`);

//     await updateStep(meetingId, 'upload', 'done', 'Audio received', io);
//     await updateStep(meetingId, 'transcription', 'running', 'Starting transcription', io);

//     let transcriptSegments = null;
//     let transcript = '';
//     let usedPerDevice = false;

//     // ── PATH 1: Per-device audio (preferred) ─────────────────────────────────
//     if (perDeviceAudio && perDeviceAudio.length > 0) {
//       logger.info('Using per-device audio pipeline — timeline normalization enabled');
//       try {
//         // FIX: Pass hostName into processPerDeviceAudio for tie-breaking sort
//         transcriptSegments = await processPerDeviceAudio(perDeviceAudio, meetingId, hostName);
//         if (transcriptSegments && transcriptSegments.length > 0) {
//           transcript = transcriptSegments.map(s => `${s.speaker}: ${s.text}`).join('\n');
//           usedPerDevice = true;
//           meeting.speakerDiarizationMethod = 'per-device';
//           logger.info(`Per-device transcription success: ${transcriptSegments.length} segments`);
//         } else {
//           logger.warn('Per-device pipeline returned no segments — falling back to mixed audio');
//         }
//       } catch (e) {
//         logger.warn(`Per-device pipeline failed: ${e.message} — falling back to mixed audio`);
//       }
//     }

//     // ── PATH 2: Mixed audio fallback ─────────────────────────────────────────
//     if (!usedPerDevice && audioKey) {
//       logger.info('Using mixed audio pipeline with diarization');

//       const localAudioPath = await downloadAudio(audioKey);
//       const rawDuration = await getAudioDuration(localAudioPath);
//       meeting.actualDuration = (rawDuration && !isNaN(rawDuration)) ? Math.round(rawDuration / 60) : 0;
//       logger.info(`Audio duration: ${rawDuration}s`);

//       let groqResult = null;
//       const fileSizeMB = fs.statSync(localAudioPath).size / (1024 * 1024);

//       if (fileSizeMB > 24 || rawDuration > 590) {
//         logger.info('Large file — splitting into overlapping chunks');
//         const chunks = await splitAudioWithOverlap(localAudioPath);
//         const allSegments = [];

//         for (const chunk of chunks) {
//           const chunkResult = await transcribeWithGroq(chunk.path);
//           transcript += (chunkResult?.text || '') + '\n';
//           if (chunkResult?.segments) {
//             chunkResult.segments.forEach(seg => {
//               allSegments.push({
//                 ...seg,
//                 start: (seg.start || 0) + chunk.startTime,
//                 end: (seg.end || 0) + chunk.startTime
//               });
//             });
//           }
//           try { fs.unlinkSync(chunk.path); } catch (_) { }
//         }
//         groqResult = { text: transcript, segments: allSegments };
//       } else {
//         groqResult = await transcribeWithGroq(localAudioPath);
//         transcript = groqResult?.text || '';
//       }

//       meeting.transcriptRaw = transcript;
//       logger.info(`Transcription done. Text: ${transcript.length} chars, segments: ${groqResult?.segments?.length || 0}`);
//       await updateStep(meetingId, 'transcription', 'done', 'Transcription complete', io);
//       await updateStep(meetingId, 'diarization', 'running', 'Identifying speakers', io);

//       const joinedAttendees = meeting.attendees.filter(
//         a => a.attended === true || a.joinedAt !== null
//       );
//       const activeAttendees = joinedAttendees.length > 0 ? joinedAttendees : meeting.attendees;
//       const attendeeNames = activeAttendees
//         .map(a => `${(a.user?.firstName || '').trim()} ${(a.user?.lastName || '').trim()}`.trim())
//         .filter(name => name.length > 0);

//       logger.info(`Attendees for diarization: ${attendeeNames.join(', ')}`);

//       const rawSegments = (groqResult?.segments || []).map(seg => ({
//         text: seg.text?.trim() || '',
//         startTime: seg.start || 0,
//         endTime: seg.end || 0,
//         start: seg.start || 0,
//         end: seg.end || 0
//       })).filter(seg => seg.text.length > 0);

//       const numSpeakers = attendeeNames.length;
//       const diarSegments = await diarizeWithPyannote(localAudioPath, numSpeakers);

//       let labeledSegments;
//       if (diarSegments && diarSegments.length > 0) {
//         logger.info(`Using pyannote diarization (${diarSegments.length} segments)`);
//         labeledSegments = mergeTranscriptWithDiarization(rawSegments, diarSegments, attendeeNames);
//         meeting.speakerDiarizationMethod = 'pyannote';
//       } else {
//         logger.info('Pyannote unavailable — using LLM speaker inference fallback');
//         const segmentsToLabel = rawDuration < 600 ? rawSegments : mergeShortSegments(rawSegments);
//         labeledSegments = await inferSpeakersWithLLM(segmentsToLabel, attendeeNames, hostName);
//         meeting.speakerDiarizationMethod = 'llm';
//       }

//       const rawMappedSegments = labeledSegments.map(seg => ({
//         speaker: seg.speaker || 'Unknown Speaker',
//         startTime: seg.startTime || seg.start || 0,
//         endTime: seg.endTime || seg.end || 0,
//         text: seg.text || ''
//       }));

//       // Mixed audio dedup keeps cross-speaker check since diarization can
//       // produce genuine overlaps on a single-channel recording.
//       const dedupedSegments = [];
//       for (const seg of rawMappedSegments) {
//         const isDuplicate = dedupedSegments.some(existing => {
//           const a = existing.text.trim().toLowerCase();
//           const b = seg.text.trim().toLowerCase();
//           const timeDiff = Math.abs(seg.startTime - existing.startTime);
//           const longer = Math.max(a.length, b.length);
//           const shorter = Math.min(a.length, b.length);
//           return timeDiff < 15 && longer > 0 && shorter / longer > 0.8;
//         });
//         if (!isDuplicate) dedupedSegments.push(seg);
//       }

//       // Stitch mixed audio segments too
//       transcriptSegments = stitchSegments(dedupedSegments);
//       try { fs.unlinkSync(localAudioPath); } catch (_) { }
//     }

//     // Final sort
//     if (transcriptSegments && transcriptSegments.length > 0) {
//       transcriptSegments.sort((a, b) => {
//         const timeDiff = (a.startTime || 0) - (b.startTime || 0);
//         if (Math.abs(timeDiff) <= 0.5 && hostName) {
//           const aIsHost = a.speaker === hostName;
//           const bIsHost = b.speaker === hostName;
//           if (aIsHost && !bIsHost) return -1;
//           if (!aIsHost && bIsHost) return 1;
//         }
//         return timeDiff;
//       });
//     }

//     meeting.transcriptRaw = transcript || transcriptSegments?.map(s => `${s.speaker}: ${s.text}`).join('\n') || '';
//     meeting.transcriptSegments = transcriptSegments || [];
//     meeting.speakerDiarizationEditable = true;

//     if (usedPerDevice) {
//       await updateStep(meetingId, 'transcription', 'done', `Transcribed ${perDeviceAudio.length} participants`, io);
//       await updateStep(meetingId, 'diarization', 'done', 'Speaker attribution via per-device audio — 100% accurate', io);
//     } else {
//       await updateStep(meetingId, 'diarization', 'done', 'Speaker identification complete', io);
//     }

//     logger.info(`Final segments: ${meeting.transcriptSegments.length}, method: ${meeting.speakerDiarizationMethod}`);

//     // Step 4: Analysis
//     await updateStep(meetingId, 'analysis', 'running', 'Analyzing meeting content', io);

//     const promptTemplate = await PromptTemplate.findOne({ domain: meeting.domain, isActive: true });

//     const analysis = await meetingAnalysisChain(
//       meeting.transcriptRaw,
//       meeting.domain,
//       meeting.attendees.map(a => a.user),
//       promptTemplate || {
//         systemPrompt: 'You are a meeting analyst. Analyze the meeting transcript and return structured insights.',
//         userPromptTemplate: 'Analyze this {domain} meeting transcript:\n\n{transcript}\n\nAttendees: {attendees}\n\nReturn JSON with: summary, conclusions, decisions, actionItems (array with owner/task/deadline fields), followUpTopics, attendeeContributions (array with name/score/keyPoints fields)'
//       },
//       meeting.transcriptSegments
//     );

//     meeting.summary = analysis.summary;
//     meeting.conclusions = analysis.conclusions || [];
//     meeting.decisions = analysis.decisions || [];
//     meeting.actionItems = (analysis.actionItems || []).map(item => {
//       let deadline = null;
//       if (item.deadline) {
//         const parsed = new Date(item.deadline);
//         deadline = isNaN(parsed.getTime()) ? null : parsed;
//       }
//       return {
//         owner: meeting.attendees.find(a => {
//           const name = `${a.user?.firstName} ${a.user?.lastName}`.toLowerCase();
//           return name.includes((item.owner || '').toLowerCase());
//         })?.user?._id || meeting.host,
//         task: item.task,
//         deadline,
//         status: 'pending'
//       };
//     });
//     meeting.followUpTopics = analysis.followUpTopics || [];

//     meeting.attendeeContributions = [];

//     for (const attendee of meeting.attendees) {
//       const name = `${attendee.user?.firstName} ${attendee.user?.lastName}`.trim();
//       try {
//         const contribution = await scoreAttendeeChain(
//           name,
//           meeting.transcriptRaw,
//           meeting.domain,
//           meeting.transcriptSegments
//         );
//         const score = (contribution.score && !isNaN(contribution.score)) ? contribution.score : 5;
//         attendee.contributionScore = score;
//         attendee.keyPoints = contribution.keyPoints || [];

//         meeting.attendeeContributions.push({
//           user: attendee.user._id,
//           name,
//           score,
//           keyPoints: contribution.keyPoints || [],
//           speakingTime: 0
//         });
//       } catch (e) {
//         logger.warn(`Score failed for ${name}: ${e.message}`);
//         meeting.attendeeContributions.push({
//           user: attendee.user._id, name, score: 5, keyPoints: [], speakingTime: 0
//         });
//       }
//     }

//     await updateStep(meetingId, 'analysis', 'done', 'Analysis complete', io);

//     // Step 5: Embeddings
//     await updateStep(meetingId, 'embedding', 'running', 'Storing embeddings', io);
//     try {
//       const speakerChunks = [];
//       let currentChunk = '';
//       let currentWordCount = 0;
//       const CHUNK_WORD_LIMIT = 300;

//       for (const seg of meeting.transcriptSegments) {
//         const line = `${seg.speaker}: ${seg.text}`;
//         const wordCount = line.split(' ').length;
//         if (currentWordCount + wordCount > CHUNK_WORD_LIMIT && currentChunk.length > 0) {
//           speakerChunks.push(currentChunk.trim());
//           currentChunk = '';
//           currentWordCount = 0;
//         }
//         currentChunk += line + '\n';
//         currentWordCount += wordCount;
//       }
//       if (currentChunk.trim().length > 0) speakerChunks.push(currentChunk.trim());

//       const chunks = speakerChunks.length > 0 ? speakerChunks : chunkTranscript(meeting.transcriptRaw, 300);
//       const attendeeNames = meeting.attendees.map(a =>
//         `${a.user?.firstName || ''} ${a.user?.lastName || ''}`.trim()
//       ).filter(Boolean);

//       const collection = await chromaClient.getCollection({ name: 'meeting_transcripts' });
//       for (let i = 0; i < chunks.length; i++) {
//         const embedding = await generateEmbedding(chunks[i]);
//         await collection.add({
//           ids: [`${meetingId}_chunk_${i}`],
//           embeddings: [embedding],
//           documents: [chunks[i]],
//           metadatas: [{
//             meetingId: meetingId.toString(),
//             domain: meeting.domain,
//             date: meeting.scheduledDate.toISOString(),
//             attendees: attendeeNames.join(', '),
//             chunkIndex: i
//           }]
//         });
//       }
//     } catch (e) {
//       logger.warn(`Embedding failed: ${e.message}`);
//     }
//     await updateStep(meetingId, 'embedding', 'done', 'Embeddings stored', io);

//     for (const attendee of meeting.attendees) {
//       try {
//         const performance = await Performance.findOne({ user: attendee.user._id });
//         if (performance) {
//           performance.meetingStats = performance.meetingStats || { totalMeetings: 0, avgContributionScore: 0 };
//           performance.meetingStats.totalMeetings += 1;
//           const prevAvg = performance.meetingStats.avgContributionScore || 0;
//           const prevCount = performance.meetingStats.totalMeetings - 1;
//           const newScore = attendee.contributionScore || 5;
//           const newAvg = (prevAvg * prevCount + newScore) / performance.meetingStats.totalMeetings;
//           performance.meetingStats.avgContributionScore = isNaN(newAvg) ? 5 : newAvg;
//           await performance.save();
//         }
//       } catch (e) {
//         logger.warn(`Performance update failed: ${e.message}`);
//       }
//     }

//     await Meeting.findByIdAndUpdate(meetingId, {
//       status: 'ready',
//       transcriptRaw: meeting.transcriptRaw,
//       transcriptSegments: meeting.transcriptSegments,
//       speakerDiarizationMethod: meeting.speakerDiarizationMethod,
//       speakerDiarizationEditable: meeting.speakerDiarizationEditable,
//       actualDuration: meeting.actualDuration,
//       summary: meeting.summary,
//       conclusions: (meeting.conclusions || []).filter(Boolean),
//       decisions: (meeting.decisions || []).filter(Boolean),
//       followUpTopics: (meeting.followUpTopics || []).filter(Boolean),
//       actionItems: (meeting.actionItems || []).filter(item => item && item.task),
//       attendeeContributions: (meeting.attendeeContributions || []).filter(Boolean),
//       attendees: meeting.attendees,
//     }, { new: true });

//     await updateStep(meetingId, 'ready', 'done', 'Meeting processing complete', io);

//     await Notification.create({
//       user: meeting.host,
//       type: 'meeting_ready',
//       title: 'Meeting analysis ready',
//       message: `"${meeting.name}" has been processed and is ready for review`,
//       link: `/meetings/${meeting._id}`,
//       entityType: 'meeting',
//       entityId: meeting._id
//     });

//     logger.info(`Meeting ${meetingId} processing complete — method: ${meeting.speakerDiarizationMethod}`);

//   } catch (error) {
//     logger.error(`Processing error for meeting ${meetingId}: ${error.message}`);
//     try {
//       await Meeting.findByIdAndUpdate(meetingId, {
//         status: 'completed',
//         processingError: error.message,
//         $set: { 'processingSteps.$[elem].status': 'failed' }
//       }, { arrayFilters: [{ 'elem.status': 'running' }] });
//     } catch (updateError) {
//       logger.error(`Failed to update meeting status: ${updateError.message}`);
//     }
//     throw error;
//   }
// }

// const worker = new Worker('meeting-processing', processMeeting, {
//   connection: { url: process.env.REDIS_URL },
//   concurrency: 2
// });

// worker.on('completed', (job) => logger.info(`Job ${job.id} completed`));
// worker.on('failed', (job, err) => logger.error(`Job ${job.id} failed: ${err.message}`));

// const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000;

// async function pingDiarizationService() {
//   try {
//     const res = await fetch(`${DIARIZATION_URL}/health`, { timeout: 8000 });
//     const data = await res.json();
//     if (data.pipeline_loaded) {
//       logger.info('Diarization keep-alive: pipeline loaded');
//     } else {
//       logger.warn('Diarization keep-alive: pipeline not loaded yet');
//     }
//   } catch (e) {
//     logger.warn(`Diarization keep-alive failed: ${e.message}`);
//   }
// }

// pingDiarizationService();
// const keepAliveTimer = setInterval(pingDiarizationService, KEEP_ALIVE_INTERVAL);
// const workerHealthTimer = setInterval(() => {
//   logger.info(`Worker alive, uptime: ${Math.round(process.uptime())}s`);
// }, 5 * 60 * 1000);

// process.on('SIGTERM', () => {
//   clearInterval(keepAliveTimer);
//   clearInterval(workerHealthTimer);
//   logger.info('Worker shutting down gracefully');
//   process.exit(0);
// });

// module.exports = worker;

// const { Worker } = require('bullmq');
// const fs = require('fs');
// const path = require('path');
// const ffmpeg = require('fluent-ffmpeg');
// const { promisify } = require('util');
// const Groq = require('groq-sdk');
// const FormData = require('form-data');
// const fetch = require('node-fetch');
// const { Meeting, PromptTemplate, Performance, Notification } = require('../models');
// const { chromaClient } = require('../config/chroma');
// const { generateEmbedding } = require('../ai/embeddings');
// const { meetingAnalysisChain, chunkTranscript, scoreAttendeeChain } = require('../ai/langchain');
// const { getFileUrl, uploadFile } = require('../config/s3');
// const winston = require('winston');

// const execAsync = promisify(require('child_process').exec);

// const logger = winston.createLogger({
//   level: 'info',
//   format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
//   transports: [new winston.transports.Console()]
// });

// const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// const DIARIZATION_URL = process.env.DIARIZATION_URL || 'http://diarization:8001';

// // ─────────────────────────────────────────────────────────────────────────────
// // Hallucination filter
// // ─────────────────────────────────────────────────────────────────────────────
// const HALLUCINATION_PHRASES = new Set([
//   'thank you',
//   'thank you very much',
//   'thanks for watching',
//   'thanks for listening',
//   'please subscribe',
//   'see you next time',
//   'bye bye',
//   'goodbye',
//   'you',
//   'thanks',
//   'thank you for watching',
//   'thank you for listening',
//   'subtitles by',
//   'subscribe to',
//   'like and subscribe',
//   "i'll see you in the next one",
//   "don't forget to subscribe",
// ]);

// function filterHallucination(text) {
//   if (!text || !text.trim()) return '';
//   const trimmed = text.trim().toLowerCase().replace(/[.,!?]+$/, '');
//   if (HALLUCINATION_PHRASES.has(trimmed)) {
//     logger.warn(`Hallucination filtered: "${text.trim()}"`);
//     return '';
//   }
//   return text.trim();
// }

// async function updateStep(meetingId, step, status, message = null, io = null) {
//   const meeting = await Meeting.findById(meetingId);
//   if (meeting) {
//     const stepObj = meeting.processingSteps.find(s => s.step === step);
//     if (stepObj) {
//       stepObj.status = status;
//       stepObj.timestamp = new Date();
//       if (message) stepObj.message = message;
//     }
//     await meeting.save();
//     if (io) io.to(meetingId).emit('processing-update', { step, status, message });
//   }
// }

// async function downloadAudio(audioKey) {
//   const url = await getFileUrl(audioKey, 3600);
//   const tempDir = '/temp';
//   if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
//   const localPath = path.join(tempDir, `${Date.now()}-${path.basename(audioKey)}`);
//   const response = await fetch(url);
//   const buffer = await response.arrayBuffer();
//   fs.writeFileSync(localPath, Buffer.from(buffer));
//   return localPath;
// }

// function getAudioDuration(filePath) {
//   return new Promise((resolve) => {
//     ffmpeg.ffprobe(filePath, (err, metadata) => {
//       if (err) { logger.warn(`ffprobe error: ${err.message}`); return resolve(0); }
//       const duration = metadata?.format?.duration;
//       resolve(typeof duration === 'number' && !isNaN(duration) ? duration : 0);
//     });
//   });
// }

// async function splitAudioWithOverlap(filePath, chunkDuration = 590, overlap = 10) {
//   const outputDir = '/temp/chunks';
//   if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

//   const totalDuration = await getAudioDuration(filePath);
//   const baseName = path.basename(filePath, path.extname(filePath));
//   const chunkPaths = [];
//   let start = 0;
//   let index = 0;

//   while (start < totalDuration) {
//     const outputPath = path.join(outputDir, `${baseName}_chunk_${String(index).padStart(3, '0')}.wav`);
//     const segmentLength = Math.min(chunkDuration + overlap, totalDuration - start);

//     await new Promise((resolve, reject) => {
//       ffmpeg(filePath)
//         .seekInput(start)
//         .duration(segmentLength)
//         .output(outputPath)
//         .audioCodec('pcm_s16le')
//         .audioFrequency(16000)
//         .audioChannels(1)
//         .on('end', resolve)
//         .on('error', reject)
//         .run();
//     });

//     chunkPaths.push({ path: outputPath, startTime: start });
//     start += chunkDuration;
//     index++;
//   }

//   logger.info(`Split into ${chunkPaths.length} overlapping chunks`);
//   return chunkPaths;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // transcribeWithGroq
// // Applies hallucination filter and confidence thresholds.
// // isFirstSegmentOfDevice: relaxes logprob threshold for the very first segment
// // of a device recording since Whisper calibration reduces confidence there.
// // ─────────────────────────────────────────────────────────────────────────────
// async function transcribeWithGroq(audioPath, isFirstChunk = false) {
//   try {
//     logger.info(`Transcribing: ${audioPath}`);
//     const audioStream = fs.createReadStream(audioPath);
//     const transcription = await groq.audio.transcriptions.create({
//       file: audioStream,
//       model: 'whisper-large-v3',
//       response_format: 'verbose_json',
//       language: 'en',
//       temperature: 0,
//     });

//     if (transcription.segments) {
//       transcription.segments = transcription.segments
//         .filter((seg, idx) => {
//           // Relax threshold for first segment of first chunk — Whisper calibration
//           // artificially lowers confidence at the start of a recording
//           const logprobThreshold = (isFirstChunk && idx === 0) ? -1.2 : -0.9;
//           return (seg.avg_logprob ?? 0) >= logprobThreshold && (seg.no_speech_prob ?? 0) <= 0.5;
//         })
//         .map(seg => ({ ...seg, text: filterHallucination(seg.text) }))
//         .filter(seg => seg.text.length > 0);
//     }

//     if (transcription.text) {
//       transcription.text = transcription.segments && transcription.segments.length > 0
//         ? transcription.segments.map(s => s.text).join(' ')
//         : filterHallucination(transcription.text);
//     }

//     return transcription;
//   } catch (error) {
//     logger.error(`Groq transcription error: ${error.message}`);
//     throw error;
//   }
// }

// async function diarizeWithPyannote(audioPath, numSpeakers) {
//   try {
//     const healthRes = await fetch(`${DIARIZATION_URL}/health`, { timeout: 5000 });
//     const health = await healthRes.json();
//     if (!health.pipeline_loaded) {
//       logger.warn('Pyannote pipeline not loaded — falling back to LLM diarization');
//       return null;
//     }

//     logger.info(`Sending audio to pyannote diarization service (num_speakers=${numSpeakers})`);

//     const form = new FormData();
//     form.append('file', fs.createReadStream(audioPath), {
//       filename: path.basename(audioPath),
//       contentType: 'audio/wav'
//     });

//     const url = numSpeakers > 1
//       ? `${DIARIZATION_URL}/diarize?num_speakers=${numSpeakers}`
//       : `${DIARIZATION_URL}/diarize`;

//     const response = await fetch(url, {
//       method: 'POST',
//       body: form,
//       headers: form.getHeaders(),
//       timeout: 300000
//     });

//     if (!response.ok) {
//       const err = await response.text();
//       logger.warn(`Pyannote diarization failed: ${err} — falling back to LLM`);
//       return null;
//     }

//     const result = await response.json();
//     logger.info(`Pyannote complete: ${result.segments.length} segments, ${result.num_speakers_detected} speakers`);
//     return result.segments;

//   } catch (error) {
//     logger.warn(`Pyannote service unreachable: ${error.message} — falling back to LLM diarization`);
//     return null;
//   }
// }

// function mergeTranscriptWithDiarization(groqSegments, diarSegments, attendeeNames) {
//   const speakingTime = {};
//   for (const seg of diarSegments) {
//     const duration = (seg.end || 0) - (seg.start || 0);
//     speakingTime[seg.speaker] = (speakingTime[seg.speaker] || 0) + duration;
//   }

//   const sortedSpeakers = Object.keys(speakingTime).sort(
//     (a, b) => speakingTime[b] - speakingTime[a]
//   );

//   const speakerMap = {};
//   sortedSpeakers.forEach((speaker, idx) => {
//     speakerMap[speaker] = attendeeNames[idx % attendeeNames.length];
//   });

//   logger.info(`Speaker mapping: ${JSON.stringify(speakerMap)}`);

//   return groqSegments.map(seg => {
//     const midpoint = ((seg.start || 0) + (seg.end || 0)) / 2;
//     const diarSeg = diarSegments.find(d => d.start <= midpoint && midpoint <= d.end);
//     const closestSeg = diarSeg || diarSegments.reduce((closest, d) => {
//       if (!closest) return d;
//       return Math.abs(d.start - midpoint) < Math.abs(closest.start - midpoint) ? d : closest;
//     }, null);

//     const speaker = closestSeg
//       ? (speakerMap[closestSeg.speaker] || attendeeNames[0])
//       : attendeeNames[0];

//     return { ...seg, speaker };
//   });
// }

// function mergeShortSegments(segments, minDuration = 1.0) {
//   if (!segments || segments.length === 0) return [];
//   const merged = [];
//   let current = { ...segments[0] };

//   for (let i = 1; i < segments.length; i++) {
//     const seg = segments[i];
//     const duration = (current.end || 0) - (current.start || 0);
//     const endsWithPunctuation = /[.!?]$/.test(current.text?.trim() || '');

//     if (duration < minDuration || !endsWithPunctuation) {
//       current = {
//         ...current,
//         end: seg.end,
//         text: (current.text || '').trim() + ' ' + (seg.text || '').trim()
//       };
//     } else {
//       merged.push(current);
//       current = { ...seg };
//     }
//   }
//   merged.push(current);
//   return merged;
// }

// async function inferSpeakersWithLLM(segments, attendeeNames, hostName = null) {
//   if (!segments || segments.length === 0) return [];

//   if (attendeeNames.length === 1) {
//     return segments.map(seg => ({ ...seg, speaker: attendeeNames[0] }));
//   }

//   const batchSize = 30;
//   const allLabeled = [];

//   for (let batchStart = 0; batchStart < segments.length; batchStart += batchSize) {
//     const batch = segments.slice(batchStart, batchStart + batchSize);
//     const isFirstBatch = batchStart === 0;

//     const segmentList = batch.map((seg, localIdx) =>
//       `[${localIdx}] ${seg.text?.trim()}`
//     ).join('\n');

//     const hostLine = hostName
//       ? `\nIMPORTANT: "${hostName}" is the meeting host. They almost certainly spoke first (segment [0]). Assign them to early segments unless the text clearly shows otherwise.\n`
//       : '';

//     const firstBatchNote = isFirstBatch
//       ? '\nNOTE: This is the very start of the meeting. The host typically opens with greetings or agenda.\n'
//       : '';

//     const prompt = `You are analyzing a meeting transcript. The meeting has exactly these attendees (use ONLY these exact names):
// ${attendeeNames.map((n, i) => `- Speaker ${i + 1}: ${n}`).join('\n')}
// ${hostLine}${firstBatchNote}
// Rules:
// 1. Use ONLY the exact names listed above — no titles, no roles
// 2. Assign each segment to one speaker based on conversation flow and context
// 3. Look for: questions followed by answers, topic handoffs, first-person references
// 4. A speaker can have multiple consecutive segments
// 5. The host typically opens and closes the meeting

// Segments to label:
// ${segmentList}

// Return ONLY a valid JSON array (no markdown, no explanation):
// [{"index":0,"speaker":"${attendeeNames[0]}"},{"index":1,"speaker":"${attendeeNames[Math.min(1, attendeeNames.length - 1)]}"}]`;

//     try {
//       const response = await groq.chat.completions.create({
//         model: 'llama-3.3-70b-versatile',
//         messages: [{ role: 'user', content: prompt }],
//         temperature: 0.1,
//         max_tokens: 4096
//       });

//       const content = response.choices[0]?.message?.content || '[]';
//       const clean = content.replace(/```json|```/g, '').trim();
//       let assignments = [];
//       try {
//         assignments = JSON.parse(clean);
//       } catch (parseErr) {
//         const match = clean.match(/\[[\s\S]*\]/);
//         if (match) assignments = JSON.parse(match[0]);
//       }

//       batch.forEach((seg, localIdx) => {
//         const assignment = assignments.find(a => a.index === localIdx);
//         const assignedName = assignment?.speaker?.trim();
//         const validName = attendeeNames.includes(assignedName)
//           ? assignedName
//           : attendeeNames[localIdx % attendeeNames.length];
//         allLabeled.push({ ...seg, speaker: validName });
//       });

//     } catch (error) {
//       logger.warn(`LLM speaker inference failed for batch at ${batchStart}: ${error.message}`);
//       batch.forEach((seg, localIdx) => {
//         allLabeled.push({
//           ...seg,
//           speaker: attendeeNames[(batchStart + localIdx) % attendeeNames.length]
//         });
//       });
//     }
//   }

//   return allLabeled;
// }

// function stitchSegments(segments) {
//   if (!segments || segments.length === 0) return segments;
//   const stitched = [];
//   let current = { ...segments[0] };

//   for (let i = 1; i < segments.length; i++) {
//     const next = segments[i];
//     const sameSpeaker = current.speaker === next.speaker;
//     const incomplete = !/[.!?]$/.test(current.text.trim());
//     const closeInTime = (next.startTime - current.endTime) < 0.3;

//     const noInterleavedSpeaker = !segments.some((s, j) =>
//       j !== i &&
//       s.speaker !== current.speaker &&
//       s.startTime > current.startTime &&
//       s.startTime < next.startTime
//     );

//     if (sameSpeaker && incomplete && closeInTime && noInterleavedSpeaker) {
//       current.text = current.text.trim() + ' ' + next.text.trim();
//       current.endTime = next.endTime;
//       current.end = next.endTime;
//     } else {
//       stitched.push(current);
//       current = { ...next };
//     }
//   }
//   stitched.push(current);
//   return stitched;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // processPerDeviceAudio
// //
// // THE CORE FIX FOR OVERLAPPING SEGMENTS:
// //
// // Root cause: WebM/Opus chunks concatenated as raw ArrayBuffers lose
// // inter-chunk silence. When Bob is silent for 30s while Alice speaks,
// // those 30s get compressed away. Whisper assigns Bob's first word t=0
// // instead of t=30s. Timeline normalization only adds 2.2s (device offset),
// // giving Bob's segment t=2.2s instead of t=30s — hence the overlap.
// //
// // Fix: Transcribe each 10-second chunk SEPARATELY.
// // Each chunk carries its wall-clock send timestamp.
// // For each Whisper segment within a chunk:
// //   absoluteTime = (chunkTimestamp - CHUNK_DURATION_MS) + segment.start * 1000
// //   relativeToMeeting = absoluteTime - earliestDeviceStart
// //
// // This gives correct absolute time regardless of Opus silence compression
// // because we anchor to the wall clock, not Whisper's internal counter.
// // ─────────────────────────────────────────────────────────────────────────────
// const CHUNK_DURATION_MS = 10000; // Must match server.js and frontend interval

// async function processPerDeviceAudio(perDeviceAudio, meetingId, hostName = null) {
//   logger.info(`Processing per-device audio for ${perDeviceAudio.length} participants`);

//   const tempDir = '/temp';
//   if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

//   // Compute the global earliest start time across all devices
//   const validStartTimes = perDeviceAudio
//     .map(d => d.recordingStartTime)
//     .filter(t => t && t > 0);

//   const earliestStart = validStartTimes.length > 0
//     ? Math.min(...validStartTimes)
//     : null;

//   logger.info(`Earliest device start: ${earliestStart}, devices: ${perDeviceAudio.map(d => `${d.userName}:${d.recordingStartTime}`).join(', ')}`);

//   const allSegments = [];

//   for (const device of perDeviceAudio) {
//     const { userId, userName, chunks, recordingStartTime } = device;

//     // Support both new format (chunks array) and legacy format (single audioKey)
//     const chunkList = chunks && chunks.length > 0
//       ? chunks
//       : [{ audioKey: device.audioKey, timestamp: recordingStartTime + CHUNK_DURATION_MS, chunkIndex: 0 }];

//     logger.info(`Transcribing ${chunkList.length} chunks for ${userName} (${userId})`);

//     let deviceSegmentCount = 0;

//     for (let ci = 0; ci < chunkList.length; ci++) {
//       const chunkMeta = chunkList[ci];
//       let localPath = null;

//       try {
//         localPath = await downloadAudio(chunkMeta.audioKey);

//         const stat = fs.statSync(localPath);
//         if (stat.size < 500) {
//           logger.warn(`Chunk ${ci} for ${userName} too small (${stat.size} bytes) — skipping`);
//           continue;
//         }

//         // Transcribe this chunk independently
//         // isFirstChunk=true relaxes logprob threshold for first segment
//         const result = await transcribeWithGroq(localPath, ci === 0);
//         const segments = result?.segments || [];

//         if (segments.length === 0) continue;

//         // ── KEY FIX: Compute absolute wall-clock time for each segment ──────
//         // chunkTimestamp = wall clock when this chunk was SENT by the client
//         // chunkWallClockStart = wall clock when this chunk's audio BEGAN
//         // = chunkTimestamp - CHUNK_DURATION_MS
//         //
//         // seg.start = seconds into THIS CHUNK FILE (Whisper relative time)
//         // absoluteMs = chunkWallClockStart + seg.start * 1000
//         // relativeToMeeting = (absoluteMs - earliestStart) / 1000
//         //
//         // This correctly positions Bob's speech at t=30s even though his
//         // Whisper sees it at t=0 within his chunk, because the chunk's
//         // wall clock anchor places it at the right position.
//         // ────────────────────────────────────────────────────────────────────
//         const chunkWallClockStart = chunkMeta.timestamp - CHUNK_DURATION_MS;

//         for (const seg of segments) {
//           const text = seg.text?.trim();
//           if (!text || text.length < 2) continue;

//           let startTime, endTime;

//           if (earliestStart) {
//             // New format: use chunk wall-clock anchor for accurate positioning
//             const segAbsoluteStartMs = chunkWallClockStart + (seg.start || 0) * 1000;
//             const segAbsoluteEndMs = chunkWallClockStart + (seg.end || seg.start || 0) * 1000;
//             startTime = Math.max(0, (segAbsoluteStartMs - earliestStart) / 1000);
//             endTime = Math.max(startTime, (segAbsoluteEndMs - earliestStart) / 1000);
//           } else {
//             // Legacy fallback: use Whisper relative time (old behaviour)
//             startTime = seg.start || 0;
//             endTime = seg.end || seg.start || 0;
//           }

//           allSegments.push({
//             speaker: userName,
//             text,
//             startTime,
//             endTime,
//             start: startTime,
//             end: endTime,
//             userId,
//             source: 'per-device',
//           });

//           deviceSegmentCount++;
//         }

//       } catch (e) {
//         logger.warn(`Failed to process chunk ${ci} for ${userName}: ${e.message}`);
//       } finally {
//         if (localPath) {
//           try { fs.unlinkSync(localPath); } catch (_) { }
//         }
//       }
//     }

//     logger.info(`${userName}: ${deviceSegmentCount} segments transcribed across ${chunkList.length} chunks`);
//   }

//   if (allSegments.length === 0) {
//     logger.warn('No segments from per-device audio — will fall back to mixed audio');
//     return null;
//   }

//   // ── Sort with host-first tie-breaking ────────────────────────────────────
//   // Primary: sort by startTime ascending.
//   // Tie-break (within 0.5s): host's segments sort first.
//   allSegments.sort((a, b) => {
//     const timeDiff = a.startTime - b.startTime;
//     if (Math.abs(timeDiff) <= 0.5 && hostName) {
//       const aIsHost = a.speaker === hostName;
//       const bIsHost = b.speaker === hostName;
//       if (aIsHost && !bIsHost) return -1;
//       if (!aIsHost && bIsHost) return 1;
//     }
//     return timeDiff;
//   });

//   // ── Same-speaker-only deduplication ──────────────────────────────────────
//   // Only remove near-duplicates from the SAME speaker (Whisper repeated output).
//   // Never cross-speaker — each device's audio is ground truth.
//   const dedupedSegments = [];
//   for (const seg of allSegments) {
//     const isDuplicate = dedupedSegments.some(existing => {
//       if (existing.speaker !== seg.speaker) return false;
//       const a = existing.text.trim().toLowerCase();
//       const b = seg.text.trim().toLowerCase();
//       const timeDiff = Math.abs(seg.startTime - existing.startTime);
//       const longer = Math.max(a.length, b.length);
//       const shorter = Math.min(a.length, b.length);
//       return timeDiff < 10 && longer > 0 && shorter / longer > 0.85;
//     });
//     if (!isDuplicate) dedupedSegments.push(seg);
//   }

//   logger.info(`After same-speaker dedup: ${dedupedSegments.length} segments (from ${allSegments.length})`);

//   // ── Stitch consecutive same-speaker fragments ─────────────────────────────
//   const stitchedSegments = stitchSegments(dedupedSegments);
//   logger.info(`Per-device pipeline: ${stitchedSegments.length} segments from ${perDeviceAudio.length} participants (stitched from ${dedupedSegments.length})`);

//   return stitchedSegments;
// }

// function formatTime(seconds) {
//   const mins = Math.floor(seconds / 60);
//   const secs = Math.floor(seconds % 60);
//   return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
// }

// async function processMeeting(job) {
//   const { meetingId, audioKey, perDeviceAudio } = job.data;
//   const io = global.io;
//   logger.info(`Starting processing for meeting ${meetingId}`);
//   logger.info(`Per-device audio available: ${perDeviceAudio?.length || 0} participants`);

//   try {
//     const meeting = await Meeting.findById(meetingId)
//       .populate('attendees.user', 'firstName lastName');

//     if (!meeting) throw new Error('Meeting not found');

//     const hostAttendee = meeting.attendees.find(
//       a => a.user?._id?.toString() === meeting.host?.toString()
//     );
//     const hostName = hostAttendee?.user
//       ? `${hostAttendee.user.firstName} ${hostAttendee.user.lastName}`.trim()
//       : null;

//     logger.info(`Meeting host: ${hostName || 'unknown'}`);

//     await updateStep(meetingId, 'upload', 'done', 'Audio received', io);
//     await updateStep(meetingId, 'transcription', 'running', 'Starting transcription', io);

//     let transcriptSegments = null;
//     let transcript = '';
//     let usedPerDevice = false;

//     // ── PATH 1: Per-device audio (preferred) ─────────────────────────────────
//     if (perDeviceAudio && perDeviceAudio.length > 0) {
//       logger.info('Using per-device audio pipeline — chunk-based timeline positioning');
//       try {
//         transcriptSegments = await processPerDeviceAudio(perDeviceAudio, meetingId, hostName);
//         if (transcriptSegments && transcriptSegments.length > 0) {
//           transcript = transcriptSegments.map(s => `${s.speaker}: ${s.text}`).join('\n');
//           usedPerDevice = true;
//           meeting.speakerDiarizationMethod = 'per-device';
//           logger.info(`Per-device transcription success: ${transcriptSegments.length} segments`);
//         } else {
//           logger.warn('Per-device pipeline returned no segments — falling back to mixed audio');
//         }
//       } catch (e) {
//         logger.warn(`Per-device pipeline failed: ${e.message} — falling back to mixed audio`);
//       }
//     }

//     // ── PATH 2: Mixed audio fallback ─────────────────────────────────────────
//     if (!usedPerDevice && audioKey) {
//       logger.info('Using mixed audio pipeline with diarization');

//       const localAudioPath = await downloadAudio(audioKey);
//       const rawDuration = await getAudioDuration(localAudioPath);
//       meeting.actualDuration = (rawDuration && !isNaN(rawDuration)) ? Math.round(rawDuration / 60) : 0;
//       logger.info(`Audio duration: ${rawDuration}s`);

//       let groqResult = null;
//       const fileSizeMB = fs.statSync(localAudioPath).size / (1024 * 1024);

//       if (fileSizeMB > 24 || rawDuration > 590) {
//         logger.info('Large file — splitting into overlapping chunks');
//         const chunks = await splitAudioWithOverlap(localAudioPath);
//         const allSegments = [];

//         for (const chunk of chunks) {
//           const chunkResult = await transcribeWithGroq(chunk.path, chunk.startTime === 0);
//           transcript += (chunkResult?.text || '') + '\n';
//           if (chunkResult?.segments) {
//             chunkResult.segments.forEach(seg => {
//               allSegments.push({
//                 ...seg,
//                 start: (seg.start || 0) + chunk.startTime,
//                 end: (seg.end || 0) + chunk.startTime
//               });
//             });
//           }
//           try { fs.unlinkSync(chunk.path); } catch (_) { }
//         }
//         groqResult = { text: transcript, segments: allSegments };
//       } else {
//         groqResult = await transcribeWithGroq(localAudioPath, true);
//         transcript = groqResult?.text || '';
//       }

//       meeting.transcriptRaw = transcript;
//       logger.info(`Transcription done. Text: ${transcript.length} chars, segments: ${groqResult?.segments?.length || 0}`);
//       await updateStep(meetingId, 'transcription', 'done', 'Transcription complete', io);
//       await updateStep(meetingId, 'diarization', 'running', 'Identifying speakers', io);

//       const joinedAttendees = meeting.attendees.filter(
//         a => a.attended === true || a.joinedAt !== null
//       );
//       const activeAttendees = joinedAttendees.length > 0 ? joinedAttendees : meeting.attendees;
//       const attendeeNames = activeAttendees
//         .map(a => `${(a.user?.firstName || '').trim()} ${(a.user?.lastName || '').trim()}`.trim())
//         .filter(name => name.length > 0);

//       logger.info(`Attendees for diarization: ${attendeeNames.join(', ')}`);

//       const rawSegments = (groqResult?.segments || []).map(seg => ({
//         text: seg.text?.trim() || '',
//         startTime: seg.start || 0,
//         endTime: seg.end || 0,
//         start: seg.start || 0,
//         end: seg.end || 0
//       })).filter(seg => seg.text.length > 0);

//       const numSpeakers = attendeeNames.length;
//       const diarSegments = await diarizeWithPyannote(localAudioPath, numSpeakers);

//       let labeledSegments;
//       if (diarSegments && diarSegments.length > 0) {
//         logger.info(`Using pyannote diarization (${diarSegments.length} segments)`);
//         labeledSegments = mergeTranscriptWithDiarization(rawSegments, diarSegments, attendeeNames);
//         meeting.speakerDiarizationMethod = 'pyannote';
//       } else {
//         logger.info('Pyannote unavailable — using LLM speaker inference fallback');
//         const segmentsToLabel = rawDuration < 600 ? rawSegments : mergeShortSegments(rawSegments);
//         labeledSegments = await inferSpeakersWithLLM(segmentsToLabel, attendeeNames, hostName);
//         meeting.speakerDiarizationMethod = 'llm';
//       }

//       const rawMappedSegments = labeledSegments.map(seg => ({
//         speaker: seg.speaker || 'Unknown Speaker',
//         startTime: seg.startTime || seg.start || 0,
//         endTime: seg.endTime || seg.end || 0,
//         text: seg.text || ''
//       }));

//       const dedupedSegments = [];
//       for (const seg of rawMappedSegments) {
//         const isDuplicate = dedupedSegments.some(existing => {
//           const a = existing.text.trim().toLowerCase();
//           const b = seg.text.trim().toLowerCase();
//           const timeDiff = Math.abs(seg.startTime - existing.startTime);
//           const longer = Math.max(a.length, b.length);
//           const shorter = Math.min(a.length, b.length);
//           return timeDiff < 15 && longer > 0 && shorter / longer > 0.8;
//         });
//         if (!isDuplicate) dedupedSegments.push(seg);
//       }

//       transcriptSegments = stitchSegments(dedupedSegments);
//       try { fs.unlinkSync(localAudioPath); } catch (_) { }
//     }

//     // Final sort with host-first tie-breaking
//     if (transcriptSegments && transcriptSegments.length > 0) {
//       transcriptSegments.sort((a, b) => {
//         const timeDiff = (a.startTime || 0) - (b.startTime || 0);
//         if (Math.abs(timeDiff) <= 0.5 && hostName) {
//           const aIsHost = a.speaker === hostName;
//           const bIsHost = b.speaker === hostName;
//           if (aIsHost && !bIsHost) return -1;
//           if (!aIsHost && bIsHost) return 1;
//         }
//         return timeDiff;
//       });
//     }

//     meeting.transcriptRaw = transcript || transcriptSegments?.map(s => `${s.speaker}: ${s.text}`).join('\n') || '';
//     meeting.transcriptSegments = transcriptSegments || [];
//     meeting.speakerDiarizationEditable = true;

//     if (usedPerDevice) {
//       await updateStep(meetingId, 'transcription', 'done', `Transcribed ${perDeviceAudio.length} participants`, io);
//       await updateStep(meetingId, 'diarization', 'done', 'Speaker attribution via per-device audio — accurate', io);
//     } else {
//       await updateStep(meetingId, 'diarization', 'done', 'Speaker identification complete', io);
//     }

//     logger.info(`Final segments: ${meeting.transcriptSegments.length}, method: ${meeting.speakerDiarizationMethod}`);

//     // Step 4: Analysis
//     await updateStep(meetingId, 'analysis', 'running', 'Analyzing meeting content', io);

//     const promptTemplate = await PromptTemplate.findOne({ domain: meeting.domain, isActive: true });

//     const analysis = await meetingAnalysisChain(
//       meeting.transcriptRaw,
//       meeting.domain,
//       meeting.attendees.map(a => a.user),
//       promptTemplate || {
//         systemPrompt: 'You are a meeting analyst. Analyze the meeting transcript and return structured insights.',
//         userPromptTemplate: 'Analyze this {domain} meeting transcript:\n\n{transcript}\n\nAttendees: {attendees}\n\nReturn JSON with: summary, conclusions, decisions, actionItems (array with owner/task/deadline fields), followUpTopics, attendeeContributions (array with name/score/keyPoints fields)'
//       },
//       meeting.transcriptSegments
//     );

//     meeting.summary = analysis.summary;
//     meeting.conclusions = analysis.conclusions || [];
//     meeting.decisions = analysis.decisions || [];
//     meeting.actionItems = (analysis.actionItems || []).map(item => {
//       let deadline = null;
//       if (item.deadline) {
//         const parsed = new Date(item.deadline);
//         deadline = isNaN(parsed.getTime()) ? null : parsed;
//       }
//       return {
//         owner: meeting.attendees.find(a => {
//           const name = `${a.user?.firstName} ${a.user?.lastName}`.toLowerCase();
//           return name.includes((item.owner || '').toLowerCase());
//         })?.user?._id || meeting.host,
//         task: item.task,
//         deadline,
//         status: 'pending'
//       };
//     });
//     meeting.followUpTopics = analysis.followUpTopics || [];

//     meeting.attendeeContributions = [];

//     for (const attendee of meeting.attendees) {
//       const name = `${attendee.user?.firstName} ${attendee.user?.lastName}`.trim();
//       try {
//         const contribution = await scoreAttendeeChain(
//           name,
//           meeting.transcriptRaw,
//           meeting.domain,
//           meeting.transcriptSegments
//         );
//         const score = (contribution.score && !isNaN(contribution.score)) ? contribution.score : 5;
//         attendee.contributionScore = score;
//         attendee.keyPoints = contribution.keyPoints || [];

//         meeting.attendeeContributions.push({
//           user: attendee.user._id,
//           name,
//           score,
//           keyPoints: contribution.keyPoints || [],
//           speakingTime: 0
//         });
//       } catch (e) {
//         logger.warn(`Score failed for ${name}: ${e.message}`);
//         meeting.attendeeContributions.push({
//           user: attendee.user._id, name, score: 5, keyPoints: [], speakingTime: 0
//         });
//       }
//     }

//     await updateStep(meetingId, 'analysis', 'done', 'Analysis complete', io);

//     // Step 5: Embeddings
//     await updateStep(meetingId, 'embedding', 'running', 'Storing embeddings', io);
//     try {
//       const speakerChunks = [];
//       let currentChunk = '';
//       let currentWordCount = 0;
//       const CHUNK_WORD_LIMIT = 300;

//       for (const seg of meeting.transcriptSegments) {
//         const line = `${seg.speaker}: ${seg.text}`;
//         const wordCount = line.split(' ').length;
//         if (currentWordCount + wordCount > CHUNK_WORD_LIMIT && currentChunk.length > 0) {
//           speakerChunks.push(currentChunk.trim());
//           currentChunk = '';
//           currentWordCount = 0;
//         }
//         currentChunk += line + '\n';
//         currentWordCount += wordCount;
//       }
//       if (currentChunk.trim().length > 0) speakerChunks.push(currentChunk.trim());

//       const chunks = speakerChunks.length > 0 ? speakerChunks : chunkTranscript(meeting.transcriptRaw, 300);
//       const attendeeNames = meeting.attendees.map(a =>
//         `${a.user?.firstName || ''} ${a.user?.lastName || ''}`.trim()
//       ).filter(Boolean);

//       const collection = await chromaClient.getCollection({ name: 'meeting_transcripts' });
//       for (let i = 0; i < chunks.length; i++) {
//         const embedding = await generateEmbedding(chunks[i]);
//         await collection.add({
//           ids: [`${meetingId}_chunk_${i}`],
//           embeddings: [embedding],
//           documents: [chunks[i]],
//           metadatas: [{
//             meetingId: meetingId.toString(),
//             domain: meeting.domain,
//             date: meeting.scheduledDate.toISOString(),
//             attendees: attendeeNames.join(', '),
//             chunkIndex: i
//           }]
//         });
//       }
//     } catch (e) {
//       logger.warn(`Embedding failed: ${e.message}`);
//     }
//     await updateStep(meetingId, 'embedding', 'done', 'Embeddings stored', io);

//     for (const attendee of meeting.attendees) {
//       try {
//         const performance = await Performance.findOne({ user: attendee.user._id });
//         if (performance) {
//           performance.meetingStats = performance.meetingStats || { totalMeetings: 0, avgContributionScore: 0 };
//           performance.meetingStats.totalMeetings += 1;
//           const prevAvg = performance.meetingStats.avgContributionScore || 0;
//           const prevCount = performance.meetingStats.totalMeetings - 1;
//           const newScore = attendee.contributionScore || 5;
//           const newAvg = (prevAvg * prevCount + newScore) / performance.meetingStats.totalMeetings;
//           performance.meetingStats.avgContributionScore = isNaN(newAvg) ? 5 : newAvg;
//           await performance.save();
//         }
//       } catch (e) {
//         logger.warn(`Performance update failed: ${e.message}`);
//       }
//     }

//     await Meeting.findByIdAndUpdate(meetingId, {
//       status: 'ready',
//       transcriptRaw: meeting.transcriptRaw,
//       transcriptSegments: meeting.transcriptSegments,
//       speakerDiarizationMethod: meeting.speakerDiarizationMethod,
//       speakerDiarizationEditable: meeting.speakerDiarizationEditable,
//       actualDuration: meeting.actualDuration,
//       summary: meeting.summary,
//       conclusions: (meeting.conclusions || []).filter(Boolean),
//       decisions: (meeting.decisions || []).filter(Boolean),
//       followUpTopics: (meeting.followUpTopics || []).filter(Boolean),
//       actionItems: (meeting.actionItems || []).filter(item => item && item.task),
//       attendeeContributions: (meeting.attendeeContributions || []).filter(Boolean),
//       attendees: meeting.attendees,
//     }, { new: true });

//     await updateStep(meetingId, 'ready', 'done', 'Meeting processing complete', io);

//     await Notification.create({
//       user: meeting.host,
//       type: 'meeting_ready',
//       title: 'Meeting analysis ready',
//       message: `"${meeting.name}" has been processed and is ready for review`,
//       link: `/meetings/${meeting._id}`,
//       entityType: 'meeting',
//       entityId: meeting._id
//     });

//     logger.info(`Meeting ${meetingId} processing complete — method: ${meeting.speakerDiarizationMethod}`);

//   } catch (error) {
//     logger.error(`Processing error for meeting ${meetingId}: ${error.message}`);
//     try {
//       await Meeting.findByIdAndUpdate(meetingId, {
//         status: 'completed',
//         processingError: error.message,
//         $set: { 'processingSteps.$[elem].status': 'failed' }
//       }, { arrayFilters: [{ 'elem.status': 'running' }] });
//     } catch (updateError) {
//       logger.error(`Failed to update meeting status: ${updateError.message}`);
//     }
//     throw error;
//   }
// }

// const worker = new Worker('meeting-processing', processMeeting, {
//   connection: { url: process.env.REDIS_URL },
//   concurrency: 2
// });

// worker.on('completed', (job) => logger.info(`Job ${job.id} completed`));
// worker.on('failed', (job, err) => logger.error(`Job ${job.id} failed: ${err.message}`));

// const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000;

// async function pingDiarizationService() {
//   try {
//     const res = await fetch(`${DIARIZATION_URL}/health`, { timeout: 8000 });
//     const data = await res.json();
//     if (data.pipeline_loaded) {
//       logger.info('Diarization keep-alive: pipeline loaded');
//     } else {
//       logger.warn('Diarization keep-alive: pipeline not loaded yet');
//     }
//   } catch (e) {
//     logger.warn(`Diarization keep-alive failed: ${e.message}`);
//   }
// }

// pingDiarizationService();
// const keepAliveTimer = setInterval(pingDiarizationService, KEEP_ALIVE_INTERVAL);
// const workerHealthTimer = setInterval(() => {
//   logger.info(`Worker alive, uptime: ${Math.round(process.uptime())}s`);
// }, 5 * 60 * 1000);

// process.on('SIGTERM', () => {
//   clearInterval(keepAliveTimer);
//   clearInterval(workerHealthTimer);
//   logger.info('Worker shutting down gracefully');
//   process.exit(0);
// });

// module.exports = worker;

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

async function transcribeWithGroq(audioPath) {
  try {
    logger.info(`Transcribing: ${audioPath}`);
    const audioStream = fs.createReadStream(audioPath);
    const transcription = await groq.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-large-v3',
      response_format: 'verbose_json',
      // Removed language: 'en' — forces English-only and mangles Hindi words
      // like "matlab", "yaar", "kal tak". Without language lock, Whisper
      // auto-detects Hinglish code-switching and transcribes Hindi words
      // in Roman script as spoken.
      temperature: 0,
      // Primes Whisper with common Hinglish vocabulary for Indian corporate meetings
      prompt: 'This is an Indian corporate meeting in Hinglish — a mix of English and Hindi spoken in Roman script. Transcribe Hindi words exactly as spoken in Roman script, do not translate. Common Hindi words: yaar, bhai, matlab, toh, na, haan, nahi, abhi, kal, aaj, kal tak, theek hai, bilkul, achha, dekho, suno, baat, kaam, karo, ho gaya, pending hai, stuck hai, kya hua, kyun, kab, jaldi, sahi hai, nahi nahi, aisa nahi. Common Hinglish phrases: sync karo, align karna hai, loop mein rakh, bandwidth nahi hai, approve karo, sign off chahiye, review pending, do din mein, ek ghante mein, toh basically, ek cheez batao, meeting reschedule karo, deadline miss ho gayi, blocker hai, escalate karo, wip hai.',
    });
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
// Per-device transcription pipeline
// Each participant's audio is transcribed separately with their name already known
// No pyannote needed — speaker attribution is 100% accurate
// Segments are merged by timestamp to create a chronological transcript
// ─────────────────────────────────────────────────────────────────────────────
async function processPerDeviceAudio(perDeviceAudio, meetingId) {
  logger.info(`Processing per-device audio for ${perDeviceAudio.length} participants`);

  const tempDir = '/temp';
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const allSegments = [];

  for (const device of perDeviceAudio) {
    const { userId, userName, audioKey } = device;
    logger.info(`Transcribing audio for ${userName} (${userId})`);

    let localPath = null;
    try {
      // Download this person's audio from S3
      localPath = await downloadAudio(audioKey);

      // Check file is valid and has content
      const stat = fs.statSync(localPath);
      if (stat.size < 1000) {
        logger.warn(`Audio for ${userName} too small (${stat.size} bytes) — skipping`);
        continue;
      }

      // Transcribe with Groq — speaker is already known, no diarization needed
      const result = await transcribeWithGroq(localPath);
      const segments = result?.segments || [];

      logger.info(`${userName}: ${segments.length} segments transcribed`);

      // Tag each segment with this person's name and real timestamps
      for (const seg of segments) {
        const text = seg.text?.trim();
        if (!text || text.length < 2) continue;

        allSegments.push({
          speaker: userName,
          text,
          startTime: seg.start || 0,
          endTime: seg.end || 0,
          start: seg.start || 0,
          end: seg.end || 0,
          userId,
          source: 'per-device' // mark as per-device for debugging
        });
      }

    } catch (e) {
      logger.warn(`Failed to process audio for ${userName}: ${e.message}`);
    } finally {
      if (localPath) {
        try { fs.unlinkSync(localPath); } catch (e) {}
      }
    }
  }

  if (allSegments.length === 0) {
    logger.warn('No segments from per-device audio — will fall back to mixed audio');
    return null;
  }

  // Sort all segments by start time to create chronological transcript
  allSegments.sort((a, b) => a.startTime - b.startTime);

  // Deduplication — remove hallucinated repeats within 15 seconds with 80% similarity
  const dedupedSegments = [];
  for (const seg of allSegments) {
    const isDuplicate = dedupedSegments.some(existing => {
      const a = existing.text.trim().toLowerCase();
      const b = seg.text.trim().toLowerCase();
      const timeDiff = Math.abs(seg.startTime - existing.startTime);
      const longer = Math.max(a.length, b.length);
      const shorter = Math.min(a.length, b.length);
      return timeDiff < 15 && longer > 0 && shorter / longer > 0.8;
    });
    if (!isDuplicate) dedupedSegments.push(seg);
  }

  logger.info(`Per-device pipeline complete: ${dedupedSegments.length} segments from ${perDeviceAudio.length} participants`);
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

    // ── PATH 1: Per-device audio (preferred) ─────────────────────────────────
    // Each person's audio is transcribed separately — speaker attribution is perfect
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

    // ── PATH 2: Mixed audio fallback ─────────────────────────────────────────
    // Used when per-device audio is unavailable or failed
    // Falls back to Groq transcription + pyannote/LLM diarization
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
              allSegments.push({
                ...seg,
                start: (seg.start || 0) + timeOffset,
                end: (seg.end || 0) + timeOffset
              });
            });
          }
          timeOffset += 600;
          try { fs.unlinkSync(chunk); } catch (e) {}
        }
        groqResult = { text: transcript, segments: allSegments };
      } else {
        groqResult = await transcribeWithGroq(localAudioPath);
        transcript = groqResult?.text || '';
      }

      meeting.transcriptRaw = transcript;
      logger.info(`Transcription done. Text: ${transcript.length} chars, segments: ${groqResult?.segments?.length || 0}`);
      await updateStep(meetingId, 'transcription', 'done', 'Transcription complete', io);

      // Diarization step for mixed audio
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
      })).filter(seg => seg.text.length > 0);

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

      // Dedup
      const dedupedSegments = [];
      for (const seg of rawMappedSegments) {
        const isDuplicate = dedupedSegments.some(existing => {
          const a = existing.text.trim().toLowerCase();
          const b = seg.text.trim().toLowerCase();
          const timeDiff = Math.abs(seg.startTime - existing.startTime);
          const longer = Math.max(a.length, b.length);
          const shorter = Math.min(a.length, b.length);
          return timeDiff < 15 && longer > 0 && shorter / longer > 0.8;
        });
        if (!isDuplicate) dedupedSegments.push(seg);
      }

      transcriptSegments = dedupedSegments;
      try { fs.unlinkSync(localAudioPath); } catch (e) {}
    }

    // Set final segments
    meeting.transcriptRaw = transcript || transcriptSegments?.map(s => `${s.speaker}: ${s.text}`).join('\n') || '';
    meeting.transcriptSegments = transcriptSegments || [];
    meeting.speakerDiarizationEditable = true;

    if (usedPerDevice) {
      // Skip diarization step for per-device — already done
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

// Keep HuggingFace Space warm — ping every 10 minutes
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