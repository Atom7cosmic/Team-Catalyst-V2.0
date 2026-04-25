require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const winston = require('winston');
const FormData = require('form-data');
const fetch = require('node-fetch');

const connectDB = require('./config/db');
const { initializeCollections } = require('./config/chroma');

const {
  authRoutes, userRoutes, meetingRoutes, taskRoutes, sprintRoutes,
  attendanceRoutes, performanceRoutes, recommendationRoutes,
  notificationRoutes, auditRoutes, dashboardRoutes, adminRoutes
} = require('./routes');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

const DIARIZATION_URL = process.env.DIARIZATION_URL || 'http://diarization:8001';

const allowedOrigins = [
  'https://orgos-swart.vercel.app',
  'https://team-catalyst-v2-0.vercel.app',
  'https://orgyx.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL,
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 10 * 1024 * 1024
});

connectDB();
initializeCollections().catch(err => logger.error(`ChromaDB initialization failed: ${err.message}`));

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { success: false, message: 'Too many requests, please try again later.' } });
app.use('/api/', generalLimiter);
const speedLimiter = slowDown({ windowMs: 15 * 60 * 1000, delayAfter: 50, delayMs: 500 });

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/sprints', sprintRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/performance', speedLimiter, performanceRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ─────────────────────────────────────────────────────────────────────────────
// VAD scoring helper
// ─────────────────────────────────────────────────────────────────────────────
async function getVadScore(audioBuffer, filename) {
  try {
    const form = new FormData();
    form.append('file', audioBuffer, { filename: filename || 'chunk.webm', contentType: 'audio/webm' });
    const response = await fetch(`${DIARIZATION_URL}/vad-score`, { method: 'POST', body: form, headers: form.getHeaders(), timeout: 10000 });
    if (!response.ok) { logger.warn(`VAD score failed: ${response.status}`); return 0.5; }
    const result = await response.json();
    return typeof result.voiceRatio === 'number' ? result.voiceRatio : 0.5;
  } catch (e) {
    logger.warn(`VAD unavailable: ${e.message} — using neutral 0.5`);
    return 0.5;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stores
// ─────────────────────────────────────────────────────────────────────────────
const transcriptQueue = new Map();
const flushedDeviceAudio = new Map();
const roomParticipants = new Map();
const rooms = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// FIX: Per-device chunk index tracking
//
// audio-chunk now uploads to S3 immediately (fire-and-forget). This means
// chunks survive socket disconnects, start-recording queue resets, and race
// conditions between end and flush-my-chunks.
// ─────────────────────────────────────────────────────────────────────────────
const chunkIndexCounters = new Map(); // Map<`${meetingId}:${userId}`, number>

function nextChunkIndex(meetingId, userId) {
  const key = `${meetingId}:${userId}`;
  const next = (chunkIndexCounters.get(key) ?? 0);
  chunkIndexCounters.set(key, next + 1);
  return next;
}

const { uploadFile, listFiles } = require('./config/s3');
const CHUNK_DURATION_MS = 10000;

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  const workerToken = process.env.WORKER_SOCKET_TOKEN || 'worker-internal';
  if (token === workerToken) { socket.userId = 'worker'; socket.user = { firstName: 'Worker', lastName: 'Process' }; return next(); }
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.user = decoded;
    next();
  } catch (err) { next(new Error('Invalid token')); }
});

io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}, user: ${socket.userId}`);

  const getDisplayName = () => {
    const first = socket.user?.firstName || '';
    const last = socket.user?.lastName || '';
    return `${first} ${last}`.trim() || socket.user?.email || 'Participant';
  };

  socket.on('worker-broadcast', ({ meetingId, event, data }) => {
    if (meetingId && event) { io.to(meetingId).emit(event, data); logger.info(`Worker broadcast: ${event} → room ${meetingId}`); }
  });

  socket.on('media-state', ({ meetingId, audio, video }) => {
    if (!meetingId || !socket.userId) return;
    socket.to(meetingId).emit('media-state-update', { userId: socket.userId, audio, video });
  });

  socket.on('join-room', ({ meetingId, userId }) => {
    socket.join(meetingId);
    if (!rooms.has(meetingId)) rooms.set(meetingId, { users: [], recording: false, raisedHands: new Set() });
    if (!roomParticipants.has(meetingId)) roomParticipants.set(meetingId, {});
    const room = rooms.get(meetingId);
    const participants = roomParticipants.get(meetingId);
    const displayName = getDisplayName();
    participants[userId] = displayName;
    room.users.push({ socketId: socket.id, userId: userId?.toString(), displayName });
    socket.to(meetingId).emit('user-connected', userId);
    socket.emit('existing-users', room.users.filter(u => u.socketId !== socket.id).map(u => ({ userId: u.userId?.toString(), displayName: u.displayName })));
    socket.emit('participant-names', participants);
    socket.emit('recording-status', room.recording);
    io.to(meetingId).emit('participant-joined', { userId, displayName });
  });

  socket.on('offer', ({ meetingId, offer, targetUserId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      const t = room.users.find(u => u.userId?.toString() === targetUserId?.toString());
      if (t) io.to(t.socketId).emit('offer', { offer, userId: socket.userId });
      else socket.to(meetingId).emit('offer', { offer, userId: socket.userId });
    }
  });

  socket.on('answer', ({ meetingId, answer, targetUserId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      const t = room.users.find(u => u.userId?.toString() === targetUserId?.toString());
      if (t) io.to(t.socketId).emit('answer', { answer, userId: socket.userId });
      else socket.to(meetingId).emit('answer', { answer, userId: socket.userId });
    }
  });

  socket.on('ice-candidate', ({ meetingId, candidate, targetUserId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      const t = room.users.find(u => u.userId?.toString() === targetUserId?.toString());
      if (t) io.to(t.socketId).emit('ice-candidate', { candidate, userId: socket.userId });
      else socket.to(meetingId).emit('ice-candidate', { candidate, userId: socket.userId });
    }
  });

  socket.on('chat-message', ({ meetingId, message }) => {
    const displayName = getDisplayName();
    io.to(meetingId).emit('chat-message', { userId: socket.userId, userName: displayName, message, timestamp: new Date().toISOString() });
  });

  // ── Per-device audio chunk ────────────────────────────────────────────────
  //
  // FIX: Upload to S3 immediately (fire-and-forget) in addition to buffering
  // in memory. Previously chunks only lived in transcriptQueue. If the socket
  // disconnected before flush-my-chunks fired, those chunks were lost and
  // scanPerDeviceAudio found 0 device files.
  //
  // Now every chunk is written to S3 the moment it arrives. flush-my-chunks
  // still runs for VAD scoring but is no longer the only write path.
  socket.on('audio-chunk', ({ meetingId, audioChunk, timestamp, recordingStartTime }) => {
    if (!transcriptQueue.has(meetingId)) transcriptQueue.set(meetingId, []);
    const queue = transcriptQueue.get(meetingId);
    const displayName = getDisplayName();
    const chunkTime = timestamp || Date.now();
    const effectiveStartTime = (recordingStartTime && recordingStartTime > 0) ? recordingStartTime : chunkTime;
    const audioBuffer = Buffer.from(audioChunk);
    const chunkIndex = nextChunkIndex(meetingId, socket.userId);

    queue.push({ userId: socket.userId, userName: displayName, timestamp: chunkTime, recordingStartTime: effectiveStartTime, chunkIndex, audioBuffer });
    logger.info(`Audio chunk queued for ${displayName} in meeting ${meetingId} (index=${chunkIndex}), queue size: ${queue.length}`);

    // ── Fire-and-forget S3 upload ──────────────────────────────────────────
    const audioKey = `meetings/${meetingId}/device-${socket.userId}-chunk${chunkIndex}-${chunkTime}.webm`;
    uploadFile(audioKey, audioBuffer, 'audio/webm')
      .then(() => logger.info(`S3 immediate upload OK: ${audioKey}`))
      .catch(err => logger.warn(`S3 immediate upload failed for chunk ${chunkIndex} (${displayName}): ${err.message}`));
  });

  // ── Per-participant chunk flush with non-blocking VAD scoring ─────────────
  //
  // flush-my-chunks now focuses purely on VAD scoring and writing the VAD
  // sidecar. S3 upload already happened in audio-chunk.
  socket.on('flush-my-chunks', async ({ meetingId }) => {
    const queue = transcriptQueue.get(meetingId) || [];
    const myChunks = queue.filter(c => c.userId === socket.userId);
    const displayName = getDisplayName();

    if (myChunks.length === 0) {
      logger.info(`flush-my-chunks: no chunks for ${displayName} in ${meetingId}`);
      socket.emit('my-chunks-flushed', { meetingId, success: true, chunkCount: 0 });
      return;
    }

    if (!flushedDeviceAudio.has(meetingId)) flushedDeviceAudio.set(meetingId, new Map());
    const meetingFlushed = flushedDeviceAudio.get(meetingId);

    const vadCompletePromise = (async () => {
      let earliestStartTime = myChunks[0].recordingStartTime;
      const uploadedChunks = [];

      for (let i = 0; i < myChunks.length; i++) {
        const chunk = myChunks[i];
        if (chunk.recordingStartTime < earliestStartTime) earliestStartTime = chunk.recordingStartTime;
        const audioKey = `meetings/${meetingId}/device-${socket.userId}-chunk${chunk.chunkIndex}-${chunk.timestamp}.webm`;
        // Re-upload idempotently (same key) in case immediate upload failed
        if (chunk.audioBuffer) {
          try { await uploadFile(audioKey, chunk.audioBuffer, 'audio/webm'); } catch (e) { logger.warn(`flush-my-chunks re-upload failed for chunk ${chunk.chunkIndex}: ${e.message}`); }
        }
        uploadedChunks.push({ audioKey, timestamp: chunk.timestamp, chunkIndex: chunk.chunkIndex, voiceRatio: 0.5, hasVoice: false });
      }

      meetingFlushed.set(socket.userId, { userId: socket.userId, userName: displayName, recordingStartTime: earliestStartTime, chunks: uploadedChunks, audioKey: uploadedChunks[0]?.audioKey, _vadComplete: false });
      logger.info(`flush-my-chunks S3 confirmed for ${displayName}: ${uploadedChunks.length} chunks — scoring VAD in background`);

      try {
        // P0 FIX: Run VAD scoring in parallel (not serially) so total time is
        // bounded by a single /vad-score call (~1–3s) regardless of chunk count.
        // Serial scoring took 10s × N chunks — a 30-min meeting had 180 chunks
        // = 1800s, far exceeding the BullMQ 30s delay, so the sidecar was never
        // ready when the worker scanned S3.
        const vadResults = await Promise.all(
          myChunks.map(c => getVadScore(c.audioBuffer, `${socket.userId}-chunk${c.chunkIndex}.webm`))
        );
        vadResults.forEach((voiceRatio, i) => {
          uploadedChunks[i].voiceRatio = voiceRatio;
          uploadedChunks[i].hasVoice = voiceRatio > 0.15;
          logger.info(`  chunk ${myChunks[i].chunkIndex} ${displayName}: voiceRatio=${voiceRatio.toFixed(3)}`);
        });
        meetingFlushed.set(socket.userId, { userId: socket.userId, userName: displayName, recordingStartTime: earliestStartTime, chunks: uploadedChunks, audioKey: uploadedChunks[0]?.audioKey, _vadComplete: true });
        logger.info(`VAD scoring complete for ${displayName} in meeting ${meetingId} (${myChunks.length} chunks parallel)`);

        try {
          const vadKey = `meetings/${meetingId}/device-${socket.userId}-vad.json`;
          const vadPayload = Buffer.from(JSON.stringify({ userId: socket.userId, chunks: uploadedChunks.map(c => ({ chunkIndex: c.chunkIndex, voiceRatio: c.voiceRatio, hasVoice: c.hasVoice })) }));
          await uploadFile(vadKey, vadPayload, 'application/json');
          logger.info(`VAD sidecar written: ${vadKey}`);
        } catch (vadWriteErr) { logger.warn(`VAD sidecar upload failed for ${displayName}: ${vadWriteErr.message}`); }
      } catch (e) {
        logger.warn(`Background VAD failed for ${displayName}: ${e.message}`);
        meetingFlushed.set(socket.userId, { userId: socket.userId, userName: displayName, recordingStartTime: earliestStartTime, chunks: uploadedChunks, audioKey: uploadedChunks[0]?.audioKey, _vadComplete: true });
        try {
          const vadKey = `meetings/${meetingId}/device-${socket.userId}-vad.json`;
          const vadPayload = Buffer.from(JSON.stringify({ userId: socket.userId, chunks: uploadedChunks.map(c => ({ chunkIndex: c.chunkIndex, voiceRatio: 0.5, hasVoice: false })) }));
          await uploadFile(vadKey, vadPayload, 'application/json');
        } catch (_) { /* best-effort */ }
      }
    })();

    socket.emit('my-chunks-flushed', { meetingId, success: true, chunkCount: myChunks.length });
    vadCompletePromise.catch(e => logger.warn(`Unhandled VAD promise rejection: ${e.message}`));
  });

  // ── Host collects combined per-device audio ───────────────────────────────
  socket.on('get-transcript-queue', async ({ meetingId, expectedParticipants }) => {
    if (expectedParticipants && expectedParticipants > 1) {
      for (let attempts = 0; attempts < 30; attempts++) {
        const meetingFlushed = flushedDeviceAudio.get(meetingId);
        const flushedCount = meetingFlushed?.size || 0;
        if (flushedCount >= expectedParticipants) break;
        logger.info(`get-transcript-queue: waiting for participants (${flushedCount}/${expectedParticipants})`);
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const meetingFlushed = flushedDeviceAudio.get(meetingId);

    if (!meetingFlushed || meetingFlushed.size === 0) {
      const queue = transcriptQueue.get(meetingId) || [];
      if (queue.length === 0) { socket.emit('transcript-queue', { meetingId, perDeviceAudio: [] }); return; }

      const byUser = {};
      for (const chunk of queue) {
        if (!byUser[chunk.userId]) byUser[chunk.userId] = { userId: chunk.userId, userName: chunk.userName, chunks: [], recordingStartTime: chunk.recordingStartTime };
        byUser[chunk.userId].chunks.push(chunk);
        if (chunk.recordingStartTime < byUser[chunk.userId].recordingStartTime) byUser[chunk.userId].recordingStartTime = chunk.recordingStartTime;
      }

      const perDeviceAudio = [];
      for (const [userId, data] of Object.entries(byUser)) {
        try {
          const uploadedChunks = [];
          for (let i = 0; i < data.chunks.length; i++) {
            const chunk = data.chunks[i];
            const audioKey = `meetings/${meetingId}/device-${userId}-chunk${chunk.chunkIndex ?? i}-${chunk.timestamp}.webm`;
            await uploadFile(audioKey, chunk.audioBuffer, 'audio/webm');
            const voiceRatio = await getVadScore(chunk.audioBuffer, `${userId}-chunk${chunk.chunkIndex ?? i}.webm`);
            uploadedChunks.push({ audioKey, timestamp: chunk.timestamp, chunkIndex: chunk.chunkIndex ?? i, voiceRatio, hasVoice: voiceRatio > 0.15 });
          }
          perDeviceAudio.push({ userId, userName: data.userName, recordingStartTime: data.recordingStartTime, chunks: uploadedChunks, audioKey: uploadedChunks[0]?.audioKey });
        } catch (e) { logger.warn(`Fallback upload failed for ${data.userName}: ${e.message}`); }
      }

      socket.emit('transcript-queue', { meetingId, perDeviceAudio });
      return;
    }

    const allVadPromises = [];
    for (const [userId, entry] of meetingFlushed.entries()) {
      if (!entry._vadComplete) {
        const pollVad = async () => {
          for (let attempts = 0; attempts < 20; attempts++) {
            await new Promise(r => setTimeout(r, 500));
            const fresh = flushedDeviceAudio.get(meetingId)?.get(userId);
            if (fresh?._vadComplete) return fresh;
          }
          logger.warn(`VAD did not complete for ${userId} after 10s — returning partial data`);
          return entry;
        };
        allVadPromises.push(pollVad());
      } else {
        allVadPromises.push(Promise.resolve(entry));
      }
    }

    const perDeviceAudio = await Promise.all(allVadPromises);
    logger.info(`get-transcript-queue: returning ${perDeviceAudio.length} participants with VAD scores`);
    socket.emit('transcript-queue', { meetingId, perDeviceAudio });
  });

  socket.on('raise-hand', ({ meetingId }) => { const r = rooms.get(meetingId); if (r) { r.raisedHands.add(socket.userId); io.to(meetingId).emit('hand-raised', { userId: socket.userId }); } });
  socket.on('lower-hand', ({ meetingId }) => { const r = rooms.get(meetingId); if (r) { r.raisedHands.delete(socket.userId); io.to(meetingId).emit('hand-lowered', { userId: socket.userId }); } });

  socket.on('start-recording', ({ meetingId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      room.recording = true;
      // FIX: Only initialise the queue if it doesn't already exist.
      // Previously transcriptQueue.set(meetingId, []) would wipe any chunks
      // that arrived before start-recording fired on the server.
      if (!transcriptQueue.has(meetingId)) transcriptQueue.set(meetingId, []);
      flushedDeviceAudio.delete(meetingId);
      // Reset chunk index counters for this meeting
      for (const [k] of chunkIndexCounters) {
        if (k.startsWith(`${meetingId}:`)) chunkIndexCounters.delete(k);
      }
      io.to(meetingId).emit('recording-started');

      // Pre-warm diarization service so no cold-start when processing starts
      fetch(`${DIARIZATION_URL}/health`, { timeout: 5000 })
        .then(() => logger.info(`Pre-warmed diarization service for meeting ${meetingId}`))
        .catch(e => logger.warn(`Failed to pre-warm diarization service: ${e.message}`));
    }
  });

  socket.on('stop-recording', ({ meetingId }) => {
    const room = rooms.get(meetingId);
    if (room) { room.recording = false; io.to(meetingId).emit('recording-stopped'); }
  });

  socket.on('peer-restart', ({ meetingId, targetUserId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      const t = room.users.find(u => u.userId?.toString() === targetUserId?.toString());
      if (t) { io.to(t.socketId).emit('peer-restart', { userId: socket.userId }); logger.info(`Peer restart: ${socket.userId} → ${targetUserId}`); }
    }
  });

  socket.on('processing-update', ({ meetingId, step, status, message }) => {
    io.to(meetingId).emit('processing-update', { step, status, message, timestamp: new Date().toISOString() });
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
    rooms.forEach((room, meetingId) => {
      const idx = room.users.findIndex(u => u.socketId === socket.id);
      if (idx > -1) {
        const userId = room.users[idx].userId;
        room.users.splice(idx, 1);
        room.raisedHands.delete(userId);
        socket.to(meetingId).emit('user-disconnected', userId);
        if (room.users.length === 0) {
          rooms.delete(meetingId);
          setTimeout(() => {
            if (!rooms.has(meetingId)) {
              transcriptQueue.delete(meetingId);
              flushedDeviceAudio.delete(meetingId);
              roomParticipants.delete(meetingId);
              for (const [k] of chunkIndexCounters) {
                if (k.startsWith(`${meetingId}:`)) chunkIndexCounters.delete(k);
              }
            }
          }, 30 * 60 * 1000);
        }
      }
    });
  });
});

app.set('io', io);

app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  if (err.name === 'MulterError') return res.status(400).json({ success: false, message: `File upload error: ${err.message}` });
  if (err.message === 'CORS not allowed' || err.message === 'Not allowed by CORS') return res.status(403).json({ success: false, message: 'CORS error' });
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error' });
});

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Diarization URL: ${DIARIZATION_URL}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => { logger.info('Server closed'); process.exit(0); });
});

module.exports = { app, server, io };