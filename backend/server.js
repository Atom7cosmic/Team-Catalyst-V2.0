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

const connectDB = require('./config/db');
const { initializeCollections } = require('./config/chroma');

const {
  authRoutes,
  userRoutes,
  meetingRoutes,
  taskRoutes,
  sprintRoutes,
  attendanceRoutes,
  performanceRoutes,
  recommendationRoutes,
  notificationRoutes,
  auditRoutes,
  dashboardRoutes,
  adminRoutes
} = require('./routes');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

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
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 10 * 1024 * 1024 // 10MB
});

connectDB();
initializeCollections().catch(err =>
  logger.error(`ChromaDB initialization failed: ${err.message}`)
);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api/', generalLimiter);

const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 50,
  delayMs: 500
});

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
// Per-device transcript queue
//
// Each participant's audio chunks are stored in-memory keyed by meetingId.
// When the meeting ends:
//   1. Every participant (host + non-hosts) emits flush-my-chunks, which
//      uploads their chunks to S3 immediately and marks them as ready.
//   2. The host emits get-transcript-queue after all participants have
//      flushed, receiving the combined perDeviceAudio array for all speakers.
//   3. The host POSTs the mixed recording + perDeviceAudio to upload-recording.
//
// This eliminates the race condition where non-host chunks were never uploaded
// because get-transcript-queue was only called by the host, and non-host
// chunks sat in memory without ever reaching S3.
// ─────────────────────────────────────────────────────────────────────────────
const transcriptQueue = new Map();

// Tracks per-meeting which userIds have completed their S3 flush.
// Structure: Map<meetingId, Map<userId, { userName, recordingStartTime, chunks: [{audioKey, timestamp, chunkIndex}] }>>
const flushedDeviceAudio = new Map();

const roomParticipants = new Map();

const { uploadFile } = require('./config/s3');

const rooms = new Map();

const CHUNK_DURATION_MS = 10000; // Must match frontend chunkInterval (10s)

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));

  const workerToken = process.env.WORKER_SOCKET_TOKEN || 'worker-internal';
  if (token === workerToken) {
    socket.userId = 'worker';
    socket.user = { firstName: 'Worker', lastName: 'Process' };
    return next();
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}, user: ${socket.userId}`);

  const getDisplayName = () => {
    const first = socket.user?.firstName || '';
    const last = socket.user?.lastName || '';
    return `${first} ${last}`.trim() || socket.user?.email || 'Participant';
  };

  socket.on('worker-broadcast', ({ meetingId, event, data }) => {
    if (meetingId && event) {
      io.to(meetingId).emit(event, data);
      logger.info(`Worker broadcast: ${event} → room ${meetingId}`);
    }
  });

  socket.on('media-state', ({ meetingId, audio, video }) => {
    if (!meetingId || !socket.userId) return;
    socket.to(meetingId).emit('media-state-update', {
      userId: socket.userId,
      audio,
      video
    });
  });

  socket.on('join-room', ({ meetingId, userId }) => {
    socket.join(meetingId);

    if (!rooms.has(meetingId)) {
      rooms.set(meetingId, { users: [], recording: false, raisedHands: new Set() });
    }
    if (!roomParticipants.has(meetingId)) {
      roomParticipants.set(meetingId, {});
    }

    const room = rooms.get(meetingId);
    const participants = roomParticipants.get(meetingId);

    const displayName = getDisplayName();
    participants[userId] = displayName;

    room.users.push({ socketId: socket.id, userId: userId?.toString(), displayName });

    socket.to(meetingId).emit('user-connected', userId);

    socket.emit('existing-users', room.users
      .filter(u => u.socketId !== socket.id)
      .map(u => ({ userId: u.userId?.toString(), displayName: u.displayName }))
    );
    socket.emit('participant-names', participants);
    socket.emit('recording-status', room.recording);

    io.to(meetingId).emit('participant-joined', { userId, displayName });
  });

  socket.on('offer', ({ meetingId, offer, targetUserId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      const targetUser = room.users.find(u => u.userId?.toString() === targetUserId?.toString());
      if (targetUser) {
        io.to(targetUser.socketId).emit('offer', { offer, userId: socket.userId });
      } else {
        socket.to(meetingId).emit('offer', { offer, userId: socket.userId });
      }
    }
  });

  socket.on('answer', ({ meetingId, answer, targetUserId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      const targetUser = room.users.find(u => u.userId?.toString() === targetUserId?.toString());
      if (targetUser) {
        io.to(targetUser.socketId).emit('answer', { answer, userId: socket.userId });
      } else {
        socket.to(meetingId).emit('answer', { answer, userId: socket.userId });
      }
    }
  });

  socket.on('ice-candidate', ({ meetingId, candidate, targetUserId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      const targetUser = room.users.find(u => u.userId?.toString() === targetUserId?.toString());
      if (targetUser) {
        io.to(targetUser.socketId).emit('ice-candidate', { candidate, userId: socket.userId });
      } else {
        socket.to(meetingId).emit('ice-candidate', { candidate, userId: socket.userId });
      }
    }
  });

  socket.on('chat-message', ({ meetingId, message }) => {
    const displayName = getDisplayName();
    io.to(meetingId).emit('chat-message', {
      userId: socket.userId,
      userName: displayName,
      message,
      timestamp: new Date().toISOString()
    });
  });

  // ── Per-device audio chunk ────────────────────────────────────────────────
  // Store each chunk with its own wall-clock timestamp.
  // BUG 5 FIX: Do NOT clamp recordingStartTime. Trust the value from the
  // client — it is set at MediaRecorder.start() time. Clamping caused late
  // joiners' recordingStartTime to be shifted forward, placing their segments
  // at the wrong position on the shared timeline and causing speaker mixing.
  socket.on('audio-chunk', ({ meetingId, audioChunk, timestamp, recordingStartTime }) => {
    if (!transcriptQueue.has(meetingId)) {
      transcriptQueue.set(meetingId, []);
    }
    const queue = transcriptQueue.get(meetingId);
    const displayName = getDisplayName();

    const now = Date.now();
    const chunkTime = timestamp || now;

    const effectiveStartTime = (recordingStartTime && recordingStartTime > 0)
      ? recordingStartTime
      : chunkTime;

    // Sanity log only — no mutation
    const offsetSeconds = Math.round((chunkTime - effectiveStartTime) / 1000);
    if (offsetSeconds > 300) {
      logger.warn(`${displayName} recordingStartTime is ${offsetSeconds}s before chunkTime — keeping as-is (late joiner or clock skew)`);
    }

    queue.push({
      userId: socket.userId,
      userName: displayName,
      timestamp: chunkTime,
      recordingStartTime: effectiveStartTime,
      audioBuffer: Buffer.from(audioChunk),
    });

    logger.info(`Audio chunk queued for ${displayName} in meeting ${meetingId}, chunkTime: ${chunkTime}, queue size: ${queue.length}`);
  });

  // ── Per-participant chunk flush ───────────────────────────────────────────
  // FIX: Every participant (host AND non-hosts) emits this when the meeting
  // ends. It uploads only THIS participant's chunks to S3 immediately, then
  // stores the result in flushedDeviceAudio for the host to collect later.
  //
  // This solves the bug where non-host chunks were never uploaded because
  // get-transcript-queue was only emitted by the host after recorder.onstop,
  // which only ran on the host's device.
  socket.on('flush-my-chunks', async ({ meetingId }) => {
    const queue = transcriptQueue.get(meetingId) || [];
    const myChunks = queue.filter(c => c.userId === socket.userId);
    const displayName = getDisplayName();

    if (myChunks.length === 0) {
      logger.info(`flush-my-chunks: no chunks for ${displayName} in ${meetingId}`);
      socket.emit('my-chunks-flushed', { meetingId, success: true, chunkCount: 0 });
      return;
    }

    // Ensure flushedDeviceAudio map exists for this meeting
    if (!flushedDeviceAudio.has(meetingId)) {
      flushedDeviceAudio.set(meetingId, new Map());
    }
    const meetingFlushed = flushedDeviceAudio.get(meetingId);

    try {
      const uploadedChunks = [];
      let earliestStartTime = myChunks[0].recordingStartTime;

      for (let i = 0; i < myChunks.length; i++) {
        const chunk = myChunks[i];
        if (chunk.recordingStartTime < earliestStartTime) {
          earliestStartTime = chunk.recordingStartTime;
        }
        const audioKey = `meetings/${meetingId}/device-${socket.userId}-chunk${i}-${chunk.timestamp}.webm`;
        await uploadFile(audioKey, chunk.audioBuffer, 'audio/webm');
        uploadedChunks.push({
          audioKey,
          timestamp: chunk.timestamp,
          chunkIndex: i,
        });
      }

      meetingFlushed.set(socket.userId, {
        userId: socket.userId,
        userName: displayName,
        recordingStartTime: earliestStartTime,
        chunks: uploadedChunks,
        audioKey: uploadedChunks[0]?.audioKey, // legacy compat
      });

      logger.info(`flush-my-chunks: uploaded ${uploadedChunks.length} chunks for ${displayName} in ${meetingId}`);
      socket.emit('my-chunks-flushed', { meetingId, success: true, chunkCount: uploadedChunks.length });
    } catch (e) {
      logger.warn(`flush-my-chunks failed for ${displayName}: ${e.message}`);
      socket.emit('my-chunks-flushed', { meetingId, success: false, chunkCount: 0 });
    }
  });

  // ── Host requests combined per-device audio after all participants flush ──
  // Called only by the host, after all participants have emitted flush-my-chunks.
  // Returns the combined flushedDeviceAudio for all speakers in this meeting.
  socket.on('get-transcript-queue', async ({ meetingId }) => {
    const meetingFlushed = flushedDeviceAudio.get(meetingId);

    if (!meetingFlushed || meetingFlushed.size === 0) {
      // Fallback: old path — upload from in-memory queue directly (no flush was done)
      const queue = transcriptQueue.get(meetingId) || [];
      if (queue.length === 0) {
        socket.emit('transcript-queue', { meetingId, perDeviceAudio: [] });
        return;
      }

      const byUser = {};
      for (const chunk of queue) {
        if (!byUser[chunk.userId]) {
          byUser[chunk.userId] = {
            userId: chunk.userId,
            userName: chunk.userName,
            chunks: [],
            recordingStartTime: chunk.recordingStartTime,
          };
        }
        byUser[chunk.userId].chunks.push({
          audioBuffer: chunk.audioBuffer,
          timestamp: chunk.timestamp,
          recordingStartTime: chunk.recordingStartTime,
        });
        if (chunk.recordingStartTime < byUser[chunk.userId].recordingStartTime) {
          byUser[chunk.userId].recordingStartTime = chunk.recordingStartTime;
        }
      }

      logger.info(`get-transcript-queue (fallback path): uploading for ${Object.keys(byUser).length} participants`);
      const perDeviceAudio = [];

      for (const [userId, data] of Object.entries(byUser)) {
        try {
          const uploadedChunks = [];
          for (let i = 0; i < data.chunks.length; i++) {
            const chunk = data.chunks[i];
            const audioKey = `meetings/${meetingId}/device-${userId}-chunk${i}-${chunk.timestamp}.webm`;
            await uploadFile(audioKey, chunk.audioBuffer, 'audio/webm');
            uploadedChunks.push({ audioKey, timestamp: chunk.timestamp, chunkIndex: i });
          }
          perDeviceAudio.push({
            userId,
            userName: data.userName,
            recordingStartTime: data.recordingStartTime,
            chunks: uploadedChunks,
            audioKey: uploadedChunks[0]?.audioKey,
          });
          logger.info(`Fallback uploaded ${uploadedChunks.length} chunks for ${data.userName}`);
        } catch (e) {
          logger.warn(`Fallback upload failed for ${data.userName}: ${e.message}`);
        }
      }

      socket.emit('transcript-queue', { meetingId, perDeviceAudio });
      return;
    }

    // Normal path — all participants have flushed, return combined result
    const perDeviceAudio = Array.from(meetingFlushed.values());
    logger.info(`get-transcript-queue: returning ${perDeviceAudio.length} flushed participants for meeting ${meetingId}`);
    socket.emit('transcript-queue', { meetingId, perDeviceAudio });
  });

  socket.on('raise-hand', ({ meetingId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      room.raisedHands.add(socket.userId);
      io.to(meetingId).emit('hand-raised', { userId: socket.userId });
    }
  });

  socket.on('lower-hand', ({ meetingId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      room.raisedHands.delete(socket.userId);
      io.to(meetingId).emit('hand-lowered', { userId: socket.userId });
    }
  });

  socket.on('start-recording', ({ meetingId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      room.recording = true;
      transcriptQueue.set(meetingId, []);
      flushedDeviceAudio.delete(meetingId); // clear any stale flush state from previous recording
      io.to(meetingId).emit('recording-started');
    }
  });

  socket.on('stop-recording', ({ meetingId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      room.recording = false;
      io.to(meetingId).emit('recording-stopped');
    }
  });

  socket.on('peer-restart', ({ meetingId, targetUserId }) => {
    const room = rooms.get(meetingId);
    if (room) {
      const targetUser = room.users.find(u => u.userId?.toString() === targetUserId?.toString());
      if (targetUser) {
        io.to(targetUser.socketId).emit('peer-restart', { userId: socket.userId });
        logger.info(`Peer restart relayed from ${socket.userId} to ${targetUserId}`);
      }
    }
  });

  socket.on('processing-update', ({ meetingId, step, status, message }) => {
    io.to(meetingId).emit('processing-update', {
      step, status, message,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
    rooms.forEach((room, meetingId) => {
      const userIndex = room.users.findIndex(u => u.socketId === socket.id);
      if (userIndex > -1) {
        const userId = room.users[userIndex].userId;
        room.users.splice(userIndex, 1);
        room.raisedHands.delete(userId);
        socket.to(meetingId).emit('user-disconnected', userId);
        if (room.users.length === 0) {
          rooms.delete(meetingId);
          setTimeout(() => {
            if (!rooms.has(meetingId)) {
              transcriptQueue.delete(meetingId);
              flushedDeviceAudio.delete(meetingId);
              roomParticipants.delete(meetingId);
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
  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, message: `File upload error: ${err.message}` });
  }
  if (err.message === 'CORS not allowed' || err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'CORS error' });
  }
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, io };