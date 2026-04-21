const express = require('express');
const router = express.Router();
const multer = require('multer');
const { meetingController } = require('../controllers');
const { authMiddleware } = require('../middleware');

const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/x-aac',
]);

const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.has(file.mimetype)) cb(null, true);
  else cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: MP3, WAV, M4A, WebM, OGG, AAC`));
};

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 }, fileFilter });

router.use(authMiddleware);

// ── Meeting CRUD ───────────────────────────────────────────────────────────
router.get('/', meetingController.getMeetings);
router.post('/', meetingController.createMeeting);

// ── Static routes BEFORE /:id ──────────────────────────────────────────────
router.post('/upload', upload.single('recording'), meetingController.manualUpload);

// ── Dynamic :id routes ─────────────────────────────────────────────────────
router.get('/:id', meetingController.getMeeting);
router.put('/:id', meetingController.updateMeeting);
router.delete('/:id', meetingController.deleteMeeting);
router.post('/:id/cancel', meetingController.cancelMeeting);

// Room lifecycle
router.post('/:id/join', meetingController.joinMeeting);
router.post('/:id/leave', meetingController.leaveMeeting);
router.post('/:id/end', meetingController.endMeeting);

// Room recording upload
router.post('/:id/upload-recording', upload.single('recording'), meetingController.uploadRecording);

// ── Analyze Meeting (manual trigger button) ────────────────────────────────
// POST /:id/analyze
// Accessible by host or any attendee.
// Requeus the meeting processing job using the stored recording.
// Returns immediately — processing happens async, progress via Socket.io.
router.post('/:id/analyze', meetingController.analyzeMeeting);

// Processing status
router.get('/:id/processing-status', meetingController.getProcessingStatus);

// AI features
router.post('/:id/qa', meetingController.meetingQA);
router.get('/:id/similar', meetingController.getSimilarMeetings);

// Follow-up
router.post('/:id/schedule-followup', meetingController.scheduleFollowup);

// Export
router.get('/:id/export', meetingController.exportToPDF);

// Transcript corrections
router.put('/:id/transcript-segments', meetingController.updateTranscriptSegments);

module.exports = router;