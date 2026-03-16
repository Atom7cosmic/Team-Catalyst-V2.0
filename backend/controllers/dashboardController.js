const {
  User,
  Task,
  Meeting,
  Sprint,
  Attendance,
  Performance,
  Recommendation,
  Notification
} = require('../models');
const { getOrgTreeUsers, isSuperior } = require('../middleware');
const mongoose = require('mongoose');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Get dashboard data
exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user.userId;
    const isSuperiorUser = isSuperior(req.user);

    // Common data for all users
    const user = await User.findById(userId).select('-password');
    const performance = await Performance.findOne({ user: userId });

    // Get upcoming meetings
    const upcomingMeetings = await Meeting.find({
      'attendees.user': userId,
      scheduledDate: { $gte: new Date() },
      status: { $in: ['scheduled', 'live'] }
    })
      .sort({ scheduledDate: 1 })
      .limit(5)
      .populate('host', 'firstName lastName');

    // Get pending tasks
    const pendingTasks = await Task.find({
      assignee: userId,
      status: { $nin: ['done', 'cancelled'] }
    })
      .sort({ dueDate: 1 })
      .limit(10)
      .populate('sprint', 'name');

    // Get unread notifications
    const unreadNotifications = await Notification.countDocuments({
      user: userId,
      read: false
    });

    // Get recent notifications
    const notifications = await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(5);

    const dashboardData = {
      user,
      performance: performance || { currentScore: 70, trend: 'neutral' },
      upcomingMeetings,
      pendingTasks,
      notifications,
      unreadNotifications
    };

    // Superior-specific data
    if (isSuperiorUser || req.user.isAdmin) {
      const accessibleUsers = await getOrgTreeUsers(userId);

      // Team stats
      const teamMembers = await User.find({
        _id: { $in: accessibleUsers },
        isActive: true
      }).select('firstName lastName role avatar');

      // Team performance overview
      const teamPerformance = await Performance.find({
        user: { $in: accessibleUsers }
      }).populate('user', 'firstName lastName avatar');

      // At-risk employees
      const atRiskEmployees = await Recommendation.find({
        user: { $in: accessibleUsers },
        category: 'at_risk',
        status: 'pending'
      }).populate('user', 'firstName lastName email avatar role');

      // Promotion candidates
      const promotionCandidates = await Recommendation.find({
        user: { $in: accessibleUsers },
        category: 'promote',
        status: 'pending'
      }).populate('user', 'firstName lastName email avatar role');

      // Team attendance today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayAttendance = await Attendance.find({
        user: { $in: accessibleUsers },
        date: today
      });

      const presentCount = todayAttendance.filter(a =>
        ['present', 'late'].includes(a.status)
      ).length;

      // Active sprints
      const activeSprints = await Sprint.find({
        team: { $in: accessibleUsers },
        status: 'active'
      }).populate('team', 'firstName lastName');

      // Meetings needing attention (processing, or scheduled today)
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);

      const meetingsToday = await Meeting.find({
        host: { $in: accessibleUsers },
        scheduledDate: { $gte: today, $lte: todayEnd }
      }).countDocuments();

      dashboardData.team = {
        members: teamMembers,
        performance: teamPerformance,
        atRiskEmployees,
        promotionCandidates,
        attendance: {
          present: presentCount,
          total: teamMembers.length
        },
        activeSprints,
        meetingsToday
      };
    }

    // Admin-specific data
    if (req.user.isAdmin) {
      const totalUsers = await User.countDocuments({ isActive: true });
      const totalMeetings = await Meeting.countDocuments();
      const totalTasks = await Task.countDocuments();
      const processingMeetings = await Meeting.countDocuments({ status: 'processing' });

      dashboardData.admin = {
        totalUsers,
        totalMeetings,
        totalTasks,
        processingMeetings
      };
    }

    res.json({
      success: true,
      dashboard: dashboardData
    });
  } catch (error) {
    logger.error(`Get dashboard error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard'
    });
  }
};

// Get team overview
exports.getTeamOverview = async (req, res) => {
  try {
    const accessibleUsers = await getOrgTreeUsers(req.user.userId);

    // Performance distribution
    const performanceDistribution = await Performance.aggregate([
      { $match: { user: { $in: accessibleUsers.map(id => new mongoose.Types.ObjectId(id)) } } },
      {
        $bucket: {
          groupBy: '$currentScore',
          boundaries: [0, 60, 70, 80, 90, 100],
          default: 'Other',
          output: {
            count: { $sum: 1 }
          }
        }
      }
    ]);

    // Trend distribution
    const trendDistribution = await Performance.aggregate([
      { $match: { user: { $in: accessibleUsers.map(id => new mongoose.Types.ObjectId(id)) } } },
      {
        $group: {
          _id: '$trend',
          count: { $sum: 1 }
        }
      }
    ]);

    // Task completion stats
    const taskStats = await Task.aggregate([
      {
        $match: {
          assignee: { $in: accessibleUsers.map(id => new mongoose.Types.ObjectId(id)) }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      overview: {
        performanceDistribution,
        trendDistribution,
        taskStats
      }
    });
  } catch (error) {
    logger.error(`Get team overview error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get team overview'
    });
  }
};
