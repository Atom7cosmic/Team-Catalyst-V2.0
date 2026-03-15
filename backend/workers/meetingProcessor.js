const { Worker } = require('bullmq');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { promisify } = require('util');
const Groq = require('groq-sdk');
const { Meeting, PromptTemplate, Performance, Notification } = require('../models');
const { chromaClient } = require('../config/chroma');
const { generateEmbedding } = require('../ai/embeddings');
const { meetingAnalysisChain, chunkTranscript, scoreAttendeeChain } = require('../ai/langchain');
const { getFileUrl } = require('../config/s3');
const winston = require('winston');

const execAsync = promisify(require('child_process').exec);

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Update processing step
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
    if (io) {
      io.to(meetingId).emit('processing-update', { step, status, message });
    }
  }
}

// Download audio from S3
async function downloadAudio(audioKey) {
  const url = await getFileUrl(audioKey, 3600);
  const tempDir = '/temp';

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const localPath = path.join(tempDir, `${Date.now()}-${path.basename(audioKey)}`);
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(localPath, Buffer.from(buffer));

  return localPath;
}

// Get audio duration using ffprobe
function getAudioDuration(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        logger.warn(`ffprobe error: ${err.message} — defaulting duration to 0`);
        return resolve(0);
      }
      const duration = metadata?.format?.duration;
      resolve(typeof duration === 'number' && !isNaN(duration) ? duration : 0);
    });
  });
}

// Split audio into chunks
async function splitAudio(filePath, chunkDuration = 600) {
  const outputDir = '/temp/chunks';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const baseName = path.basename(filePath, path.extname(filePath));
  const outputPattern = path.join(outputDir, `${baseName}_chunk_%03d.wav`);

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .output(outputPattern)
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .outputOptions([
        `-f segment`,
        `-segment_time ${chunkDuration}`,
        `-reset_timestamps 1`
      ])
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

// Transcribe using Groq Whisper API
async function transcribeWithGroq(audioPath) {
  try {
    logger.info(`Transcribing with Groq Whisper: ${audioPath}`);
    const audioStream = fs.createReadStream(audioPath);
    const transcription = await groq.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-large-v3',
      response_format: 'text',
      language: 'en',
    });
    return typeof transcription === 'string' ? transcription : transcription.text || '';
  } catch (error) {
    logger.error(`Groq transcription error: ${error.message}`);
    throw error;
  }
}

// Basic speaker diarization using silence detection
async function performDiarization(audioPath, numSpeakers) {
  return new Promise((resolve) => {
    const segments = [];
    let currentSpeaker = 0;
    let lastEndTime = 0;

    ffmpeg(audioPath)
      .audioFilters(['silencedetect=noise=-30dB:d=0.5', 'volumedetect'])
      .outputOptions('-f null')
      .output('-')
      .on('stderr', (stderrLine) => {
        const line = stderrLine.toString();
        const silenceStart = line.match(/silence_start: ([\d.]+)/);
        if (silenceStart) {
          const startTime = lastEndTime;
          const endTime = parseFloat(silenceStart[1]);
          segments.push({
            speaker: `Speaker_${currentSpeaker + 1}`,
            start: startTime,
            end: endTime
          });
          lastEndTime = endTime;
          currentSpeaker = (currentSpeaker + 1) % (numSpeakers || 1);
        }
      })
      .on('end', () => resolve(segments))
      .on('error', () => resolve([]))
      .run();
  });
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Process meeting
async function processMeeting(job) {
  const { meetingId, audioKey } = job.data;
  const io = global.io;

  logger.info(`Starting processing for meeting ${meetingId}`);

  try {
    const meeting = await Meeting.findById(meetingId)
      .populate('attendees.user', 'firstName lastName');

    if (!meeting) throw new Error('Meeting not found');

    await updateStep(meetingId, 'upload', 'done', 'Audio downloaded', io);
    await updateStep(meetingId, 'transcription', 'running', 'Starting transcription', io);

    const localAudioPath = await downloadAudio(audioKey);

    // ✅ Safe duration — never NaN
    const rawDuration = await getAudioDuration(localAudioPath);
    meeting.actualDuration = (rawDuration && !isNaN(rawDuration))
      ? Math.round(rawDuration / 60)
      : 0;

    let transcript = '';

    const fileSizeMB = fs.statSync(localAudioPath).size / (1024 * 1024);

    if (fileSizeMB > 24 || rawDuration > 600) {
      logger.info('Large file detected, splitting into chunks');
      const chunks = await splitAudio(localAudioPath);
      let timeOffset = 0;

      for (const chunk of chunks) {
        const chunkText = await transcribeWithGroq(chunk);
        const lines = chunkText.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            transcript += `[${formatTime(timeOffset)}] ${line}\n`;
          }
        }
        timeOffset += 600;
        try { fs.unlinkSync(chunk); } catch (e) {}
      }
    } else {
      transcript = await transcribeWithGroq(localAudioPath);
    }

    meeting.transcriptRaw = transcript;
    await updateStep(meetingId, 'transcription', 'done', 'Transcription complete', io);

    // Step 3: Diarization
    await updateStep(meetingId, 'diarization', 'running', 'Detecting speakers', io);

    const numSpeakers = meeting.attendees.length;
    const diarizationSegments = await performDiarization(localAudioPath, numSpeakers);

    const speakerMap = {};
    meeting.attendees.forEach((attendee, idx) => {
      const name = attendee.user?.firstName
        ? `${attendee.user.firstName} ${attendee.user.lastName}`
        : `Speaker ${idx + 1}`;
      speakerMap[`Speaker_${idx + 1}`] = name;
    });

    meeting.transcriptSegments = diarizationSegments.map(seg => ({
      speaker: speakerMap[seg.speaker] || 'Unknown Speaker',
      startTime: seg.start,
      endTime: seg.end,
      text: ''
    }));

    await updateStep(meetingId, 'diarization', 'done', 'Speaker detection complete', io);

    // Step 4: Analysis
    await updateStep(meetingId, 'analysis', 'running', 'Analyzing meeting content', io);

    const promptTemplate = await PromptTemplate.findOne({
      domain: meeting.domain,
      isActive: true
    });

    if (!promptTemplate) {
      logger.warn(`No prompt template for domain: ${meeting.domain}, using default`);
    }

    const analysis = await meetingAnalysisChain(
      transcript,
      meeting.domain,
      meeting.attendees.map(a => a.user),
      promptTemplate || {
        systemPrompt: 'You are a meeting analyst. Analyze the meeting transcript and return structured insights.',
        userPromptTemplate: 'Analyze this {domain} meeting transcript:\n\n{transcript}\n\nAttendees: {attendees}\n\nReturn JSON with: summary, conclusions, decisions, actionItems (array with owner/task/deadline fields), followUpTopics, attendeeContributions (array with name/score/keyPoints fields)'
      }
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

    // Score attendees
    for (const attendee of meeting.attendees) {
      const name = `${attendee.user?.firstName} ${attendee.user?.lastName}`;
      try {
        const contribution = await scoreAttendeeChain(name, transcript, meeting.domain);

        // ✅ Safe score — never NaN
        const score = (contribution.score && !isNaN(contribution.score))
          ? contribution.score
          : 5;

        attendee.contributionScore = score;
        attendee.keyPoints = contribution.keyPoints || [];

        meeting.attendeeContributions = meeting.attendeeContributions || [];
        meeting.attendeeContributions.push({
          user: attendee.user._id,
          score,
          keyPoints: contribution.keyPoints || [],
          speakingTime: 0
        });
      } catch (e) {
        logger.warn(`Score failed for ${name}: ${e.message}`);
      }
    }

    await updateStep(meetingId, 'analysis', 'done', 'Analysis complete', io);

    // Step 5: Embeddings
    await updateStep(meetingId, 'embedding', 'running', 'Storing embeddings', io);

    try {
      const chunks = chunkTranscript(transcript, 300);
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
            attendees: meeting.attendees.map(a =>
              `${a.user?.firstName} ${a.user?.lastName}`).join(', '),
            chunkIndex: i
          }]
        });
      }
    } catch (e) {
      logger.warn(`Embedding storage failed: ${e.message}`);
    }

    await updateStep(meetingId, 'embedding', 'done', 'Embeddings stored', io);

    // Update performance for attendees
    for (const attendee of meeting.attendees) {
      try {
        const performance = await Performance.findOne({ user: attendee.user._id });
        if (performance) {
          performance.meetingStats = performance.meetingStats || {
            totalMeetings: 0,
            avgContributionScore: 0
          };
          performance.meetingStats.totalMeetings += 1;

          const prevAvg = performance.meetingStats.avgContributionScore || 0;
          const prevCount = performance.meetingStats.totalMeetings - 1;
          const newScore = attendee.contributionScore || 5;
          const newAvg = (prevAvg * prevCount + newScore) / performance.meetingStats.totalMeetings;

          // ✅ Safe avg — never NaN
          performance.meetingStats.avgContributionScore = isNaN(newAvg) ? 5 : newAvg;
          await performance.save();
        }
      } catch (e) {
        logger.warn(`Performance update failed: ${e.message}`);
      }
    }

    // Sanitize all arrays before save
    meeting.conclusions = (meeting.conclusions || []).filter(Boolean);
    meeting.decisions = (meeting.decisions || []).filter(Boolean);
    meeting.followUpTopics = (meeting.followUpTopics || []).filter(Boolean);
    meeting.actionItems = (meeting.actionItems || []).filter(item => item && item.task);
    meeting.attendeeContributions = (meeting.attendeeContributions || []).filter(Boolean);

    meeting.status = 'ready';
    await updateStep(meetingId, 'ready', 'done', 'Meeting processing complete', io);
    await meeting.save();

    await Notification.create({
      user: meeting.host,
      type: 'meeting_ready',
      title: 'Meeting analysis ready',
      message: `"${meeting.name}" has been processed and is ready for review`,
      link: `/meetings/${meeting._id}`,
      entityType: 'meeting',
      entityId: meeting._id
    });

    try { fs.unlinkSync(localAudioPath); } catch (e) {}

    logger.info(`Meeting ${meetingId} processing complete`);

  } catch (error) {
    logger.error(`Processing error for meeting ${meetingId}: ${error.message}`);

    try {
      await Meeting.findByIdAndUpdate(meetingId, {
        status: 'completed',
        processingError: error.message,
        $set: { 'processingSteps.$[elem].status': 'failed' }
      }, {
        arrayFilters: [{ 'elem.status': 'running' }]
      });
    } catch (updateError) {
      logger.error(`Failed to update meeting status: ${updateError.message}`);
    }

    throw error;
  }
}

// Create worker
const worker = new Worker('meeting-processing', processMeeting, {
  connection: { url: process.env.REDIS_URL },
  concurrency: 2
});

worker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed: ${err.message}`);
});

module.exports = worker;