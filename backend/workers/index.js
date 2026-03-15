// Initialize environment variables
require('dotenv').config();

// MongoDB connection
const connectDB = require('../config/db');

// Logger
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Import all workers
const meetingProcessor = require('./meetingProcessor');
const performanceScorer = require('./performanceScorer');
const recommendationEngine = require('./recommendationEngine');
const promotionAnalyzer = require('./promotionAnalyzer');
const resignationPredictor = require('./resignationPredictor');

// Start worker system
const startWorkers = async () => {
  try {
    // Connect MongoDB first
    await connectDB();
    logger.info('MongoDB connected for workers');

    logger.info('All workers initialized');

  } catch (error) {
    logger.error(`Worker initialization failed: ${error.message}`);
    process.exit(1);
  }
};

// Start workers
startWorkers();

module.exports = {
  meetingProcessor,
  performanceScorer,
  recommendationEngine,
  promotionAnalyzer,
  resignationPredictor
};