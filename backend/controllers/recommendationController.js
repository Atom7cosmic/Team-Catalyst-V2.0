const { Recommendation, User, Notification, AuditLog } = require('../models');
const { runRecommendationWorkflow } = require('../ai/langgraph');
const { canAccessUser } = require('../middleware');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Get all recommendations
exports.getRecommendations = async (req, res) => {
  try {
    const { status, category, userId, page = 1, limit = 20 } = req.query;

    const query = {};

    // Access control
    if (!req.user.isAdmin) {
      // Get users this person can see
      const { getOrgTreeUsers } = require('../middleware');
      const accessibleUsers = await getOrgTreeUsers(req.user.userId);

      if (userId && !accessibleUsers.includes(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      if (!userId) {
        query.user = { $in: accessibleUsers };
      } else {
        query.user = userId;
      }
    } else if (userId) {
      query.user = userId;
    }

    if (status) query.status = status;
    if (category) query.category = category;

    const recommendations = await Recommendation.find(query)
      .populate('user', 'firstName lastName email role avatar')
      .populate('acknowledgedBy', 'firstName lastName')
      .populate('dismissedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Recommendation.countDocuments(query);

    res.json({
      success: true,
      recommendations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error(`Get recommendations error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get recommendations'
    });
  }
};

// Get single recommendation
exports.getRecommendation = async (req, res) => {
  try {
    const { id } = req.params;

    const recommendation = await Recommendation.findById(id)
      .populate('user', 'firstName lastName email role avatar joinedAt')
      .populate('acknowledgedBy', 'firstName lastName')
      .populate('dismissedBy', 'firstName lastName')
      .populate('actionItems.assignedTo', 'firstName lastName email');

    if (!recommendation) {
      return res.status(404).json({
        success: false,
        message: 'Recommendation not found'
      });
    }

    const hasAccess = await canAccessUser(req.user, recommendation.user._id.toString());
    if (!hasAccess && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      recommendation
    });
  } catch (error) {
    logger.error(`Get recommendation error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get recommendation'
    });
  }
};

// Acknowledge recommendation
exports.acknowledgeRecommendation = async (req, res) => {
  try {
    const { id } = req.params;

    const recommendation = await Recommendation.findById(id);

    if (!recommendation) {
      return res.status(404).json({
        success: false,
        message: 'Recommendation not found'
      });
    }

    const { reason } = req.body;

    recommendation.status = 'acknowledged';
    recommendation.acknowledgedBy = req.user.userId;
    recommendation.acknowledgedAt = new Date();
    recommendation.acknowledgeReason = reason || null;

    await recommendation.save();

    await AuditLog.create({
      user: req.user.userId,
      action: 'recommendation_acknowledge',
      resourceType: 'recommendation',
      resourceId: id,
      success: true,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: 'Recommendation acknowledged',
      recommendation
    });
  } catch (error) {
    logger.error(`Acknowledge error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to acknowledge'
    });
  }
};

// Dismiss recommendation
exports.dismissRecommendation = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const recommendation = await Recommendation.findById(id);

    if (!recommendation) {
      return res.status(404).json({
        success: false,
        message: 'Recommendation not found'
      });
    }

    recommendation.status = 'dismissed';
    recommendation.dismissedBy = req.user.userId;
    recommendation.dismissedAt = new Date();
    recommendation.dismissedReason = reason;

    // Increment promotion pass-over count if it was a promote recommendation
    if (recommendation.category === 'promote') {
      recommendation.promotionPassOverCount += 1;
    }

    await recommendation.save();

    await AuditLog.create({
      user: req.user.userId,
      action: 'recommendation_dismiss',
      resourceType: 'recommendation',
      resourceId: id,
      oldValue: { status: 'pending' },
      newValue: { status: 'dismissed', reason },
      success: true,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: 'Recommendation dismissed',
      recommendation
    });
  } catch (error) {
    logger.error(`Dismiss error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to dismiss'
    });
  }
};

// Generate recommendation for user
exports.generateRecommendation = async (req, res) => {
  try {
    const { userId } = req.body;

    const hasAccess = await canAccessUser(req.user, userId);
    if (!hasAccess && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Run LangGraph workflow
    const result = await runRecommendationWorkflow(userId);

    res.json({
      success: true,
      message: 'Recommendation generated',
      result
    });
  } catch (error) {
    logger.error(`Generate recommendation error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to generate recommendation'
    });
  }
};

// Get recommendation stats
exports.getStats = async (req, res) => {
  try {
    const stats = await Recommendation.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      }
    ]);

    const statusStats = await Recommendation.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      stats: {
        byCategory: stats,
        byStatus: statusStats
      }
    });
  } catch (error) {
    logger.error(`Get recommendation stats error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get stats'
    });
  }
};
