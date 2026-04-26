/**
 * Requeue any meeting for reprocessing.
 * Usage: node requeue-meeting.js <meetingId>
 */

require('dotenv').config();

const { Queue } = require('bullmq');
const mongoose = require('mongoose');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const MEETING_ID = process.argv[2];

if (!MEETING_ID) {
  console.error('Usage: node requeue-meeting.js <meetingId>');
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function scanS3ForAudio(meetingId) {
  try {
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.AWS_S3_BUCKET,
      Prefix: `meetings/${meetingId}/`,
    }));

    const files = (result.Contents || []).map(f => f.Key);
    console.log(`Found ${files.length} files in S3 for this meeting:`);
    files.forEach(f => console.log(' ', f));

    const deviceFiles = files.filter(f => f.includes('/device-'));
    const recordingFile = files.find(f => f.includes('/recording-'));

    return { deviceFiles, recordingFile };
  } catch (e) {
    console.warn(`S3 scan failed: ${e.message}`);
    return { deviceFiles: [], recordingFile: null };
  }
}

async function run() {
  console.log(`\nConnecting to MongoDB...`);
  await mongoose.connect(process.env.MONGODB_URI);

  require('./models');
  const Meeting = require('./models/Meeting');

  const meeting = await Meeting.findById(MEETING_ID)
    .populate('attendees.user', 'firstName lastName');

  if (!meeting) {
    console.error(`Meeting ${MEETING_ID} not found in database`);
    process.exit(1);
  }

  console.log(`\nFound meeting: "${meeting.name}"`);
  console.log(`Status: ${meeting.status}`);
  console.log(`Attendees: ${meeting.attendees.map(a => `${a.user?.firstName} ${a.user?.lastName}`).join(', ')}`);

  let jobData = null;

  // ── Method 1: perDeviceAudioKeys with new chunk format ───────────────────
  if (meeting.perDeviceAudioKeys && meeting.perDeviceAudioKeys.length > 0) {
    const hasChunks = meeting.perDeviceAudioKeys.some(k => k.chunks && k.chunks.length > 0);
    if (hasChunks) {
      console.log(`\n✅ Method 1: Using perDeviceAudioKeys (new chunk format) from meeting document`);
      meeting.perDeviceAudioKeys.forEach(k => console.log(`  ${k.userName}: ${k.chunks?.length} chunks`));
      jobData = {
        meetingId: MEETING_ID,
        perDeviceAudio: meeting.perDeviceAudioKeys,
      };
    } else {
      console.log(`\n⚠️  perDeviceAudioKeys found but old format — falling through to S3 scan`);
    }
  }

  // ── Method 2: Scan S3 for per-device chunks (PRIORITY over recordingUrl) ─
  // We always prefer per-device chunks over the combined recording because:
  // 1. Per-device gives perfect speaker attribution
  // 2. The combined recording may be corrupted or incomplete
  if (!jobData) {
    console.log(`\n🔍 Scanning S3 for per-device chunks...`);
    const { deviceFiles, recordingFile } = await scanS3ForAudio(MEETING_ID);

    if (deviceFiles.length > 0) {
      console.log(`✅ Found ${deviceFiles.length} per-device chunk files in S3`);

      // Group files by userId and sort by chunkIndex
      const byUser = {};
      for (const key of deviceFiles) {
        // Match new format: device-{userId}-chunk{N}-{timestamp}.webm
        const newMatch = key.match(/device-([a-f0-9]+)-chunk(\d+)-(\d+)\.webm/);
        // Match old format: device-{userId}-{timestamp}.webm
        const oldMatch = !newMatch && key.match(/device-([a-f0-9]+)-(\d+)\.webm/);

        if (newMatch) {
          const [, userId, chunkIndex, timestamp] = newMatch;
          if (!byUser[userId]) {
            const attendee = meeting.attendees.find(a => a.user?._id?.toString() === userId);
            byUser[userId] = {
              userId,
              userName: attendee ? `${attendee.user.firstName} ${attendee.user.lastName}` : 'Unknown Speaker',
              chunks: [],
            };
          }
          byUser[userId].chunks.push({
            audioKey: key,
            timestamp: parseInt(timestamp),
            chunkIndex: parseInt(chunkIndex),
          });
        } else if (oldMatch) {
          // Old format — single file per user
          const [, userId, timestamp] = oldMatch;
          const attendee = meeting.attendees.find(a => a.user?._id?.toString() === userId);
          const userName = attendee
            ? `${attendee.user.firstName} ${attendee.user.lastName}`
            : 'Unknown Speaker';
          if (!byUser[userId]) {
            byUser[userId] = { userId, userName, chunks: [] };
          }
          byUser[userId].chunks.push({
            audioKey: key,
            timestamp: parseInt(timestamp),
            chunkIndex: 0,
          });
        }
      }

      // Sort chunks by chunkIndex and compute recordingStartTime
      const perDeviceAudio = Object.values(byUser).map(u => {
        u.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
        // recordingStartTime = timestamp of chunk0 - 10s (chunk covers [start, start+10s])
        u.recordingStartTime = (u.chunks[0]?.timestamp || 0) - 10000;
        console.log(`  ${u.userName}: ${u.chunks.length} chunks, startTime: ${u.recordingStartTime}`);
        return u;
      });

      jobData = { meetingId: MEETING_ID, perDeviceAudio, audioKey: recordingFile || meeting.recordingUrl };

    } else if (recordingFile) {
      console.log(`✅ No per-device chunks found — using mixed recording`);
      console.log(`  Recording: ${recordingFile}`);
      jobData = { meetingId: MEETING_ID, audioKey: recordingFile };

    } else if (meeting.recordingUrl) {
      console.log(`✅ Using recordingUrl from meeting document`);
      console.log(`  Recording: ${meeting.recordingUrl}`);
      jobData = { meetingId: MEETING_ID, audioKey: meeting.recordingUrl };

    } else {
      console.error(`❌ No audio files found for meeting ${MEETING_ID}`);
      process.exit(1);
    }
  }

  // ── Reset meeting ─────────────────────────────────────────────────────────
  meeting.status = 'processing';
  meeting.processingError = null;
  meeting.summary = null;
  meeting.transcriptRaw = null;
  meeting.transcriptSegments = [];
  meeting.conclusions = [];
  meeting.decisions = [];
  meeting.actionItems = [];
  meeting.followUpTopics = [];
  meeting.attendeeContributions = [];
  meeting.processingSteps = [
    { step: 'upload', status: 'done', timestamp: new Date() },
    { step: 'transcription', status: 'pending' },
    { step: 'diarization', status: 'pending' },
    { step: 'analysis', status: 'pending' },
    { step: 'embedding', status: 'pending' },
    { step: 'ready', status: 'pending' },
  ];
  await meeting.save();
  console.log(`\n✅ Meeting reset to processing`);

  // ── Queue job ─────────────────────────────────────────────────────────────
  const q = new Queue('meeting-processing', {
    connection: { url: process.env.REDIS_URL }
  });

  const job = await q.add('process-meeting', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  });

  console.log(`✅ Job ${job.id} queued`);
  console.log(`\nWatch Railway worker logs for progress.`);
  console.log(`Meeting URL: https://team-catalyst-v2-0.vercel.app/meetings/${MEETING_ID}\n`);

  await q.close();
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});