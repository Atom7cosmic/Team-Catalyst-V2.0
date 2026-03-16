const mongoose = require('mongoose');

const pulseScoreSchema = new mongoose.Schema({
  week: {
    type: String, // Format: YYYY-WW
    required: true
  },
  score: {
    type: Number,
    min: 1,
    max: 5
  },
  notes: {
    type: String,
    default: null
  }
}, { _id: false });

const recommendationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    enum: ['promote', 'monitor', 'at_risk'],
    required: true
  },
  score: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  trend: {
    type: String,
    enum: ['improving', 'declining', 'neutral'],
    required: true
  },
  reasoning: {
    type: String,
    required: true
  },
  resignationRiskScore: {
    type: Number,
    min: 0,
    max: 1,
    default: null
  },
  riskFactors: [{
    factor: String,
    weight: Number,
    value: Number
  }],
  promotionPassOverCount: {
    type: Number,
    default: 0
  },
  consecutivePromoteRecommendations: {
    type: Number,
    default: 0
  },
  pulseScores: [pulseScoreSchema],
  actionItems: [{
    action: String,
    priority: { type: String, enum: ['low', 'medium', 'high'] },
    deadline: Date,
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' }
  }],
  similarEmployees: [{
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    similarityScore: Number,
    outcome: { type: String, enum: ['promoted', 'resigned', 'active'] }
  }],
  status: {
    type: String,
    enum: ['pending', 'acknowledged', 'dismissed', 'actioned'],
    default: 'pending'
  },
  acknowledgedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  acknowledgedAt: {
    type: Date,
    default: null
  },
  dismissedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  dismissedAt: {
    type: Date,
    default: null
  },
  dismissedReason: {
    type: String,
    default: null
  },
  acknowledgeReason: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Indexes
recommendationSchema.index({ user: 1 });
recommendationSchema.index({ category: 1 });
recommendationSchema.index({ score: -1 });
recommendationSchema.index({ status: 1 });
recommendationSchema.index({ resignationRiskScore: -1 });
recommendationSchema.index({ createdAt: -1 });
recommendationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Recommendation', recommendationSchema);
