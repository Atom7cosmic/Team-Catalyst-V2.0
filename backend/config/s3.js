const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const uploadFile = async (key, buffer, contentType) => {
  try {
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType
    });

    await s3Client.send(command);
    logger.info(`File uploaded successfully: ${key}`);
    return { success: true, key };
  } catch (error) {
    logger.error(`Error uploading file: ${error.message}`);
    throw error;
  }
};

const getFileUrl = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    logger.error(`Error generating signed URL: ${error.message}`);
    throw error;
  }
};

const deleteFile = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key
    });

    await s3Client.send(command);
    logger.info(`File deleted successfully: ${key}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error deleting file: ${error.message}`);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// listFiles — lists all S3 keys under a given prefix.
//
// Used by meetingProcessor.js scanPerDeviceAudio() to discover all
// device-* chunk files that participants uploaded, regardless of whether
// the client sent a complete perDeviceAudio array at upload-recording time.
//
// Handles S3 pagination automatically — buckets with >1000 objects under
// a prefix are fully traversed.
// ─────────────────────────────────────────────────────────────────────────────
const listFiles = async (prefix) => {
  try {
    const keys = [];
    let continuationToken = undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: process.env.AWS_S3_BUCKET,
        Prefix: prefix,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      });

      const response = await s3Client.send(command);

      for (const obj of response.Contents || []) {
        if (obj.Key) keys.push(obj.Key);
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  } catch (error) {
    logger.error(`Error listing files with prefix "${prefix}": ${error.message}`);
    throw error;
  }
};

module.exports = {
  s3Client,
  uploadFile,
  getFileUrl,
  deleteFile,
  listFiles,
};