const mongoose = require('mongoose');
const { Attendance, AuditLog } = require('../models');
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

// Get attendance records
exports.getAttendance = async (req, res) => {
  try {
    const { userId, startDate, endDate, page = 1, limit = 31 } = req.query;

    const targetUserId = userId || req.user.userId;

    const hasAccess = await canAccessUser(req.user, targetUserId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const query = { user: targetUserId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const attendance = await Attendance.find(query)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Attendance.countDocuments(query);

    // Calculate stats
    const stats = await Attendance.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(targetUserId) } },
      {
        $group: {
          _id: null,
          avgHours: { $avg: '$totalHours' },
          presentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
          },
          absentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] }
          },
          lateDays: {
            $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      attendance,
      stats: stats[0] || {},
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error(`Get attendance error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get attendance'
    });
  }
};

// Check in
exports.checkIn = async (req, res) => {
  try {
    const userId = req.user.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let attendance = await Attendance.findOne({
      user: userId,
      date: today
    });

    if (attendance && attendance.checkIn) {
      return res.status(400).json({
        success: false,
        message: 'Already checked in today'
      });
    }

    if (!attendance) {
      attendance = new Attendance({
        user: userId,
        date: today,
        status: 'present'
      });
    }

    attendance.checkIn = new Date();
    await attendance.save();

    res.json({
      success: true,
      message: 'Checked in successfully',
      attendance
    });
  } catch (error) {
    logger.error(`Check in error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to check in'
    });
  }
};

// Check out
exports.checkOut = async (req, res) => {
  try {
    const userId = req.user.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      user: userId,
      date: today
    });

    if (!attendance || !attendance.checkIn) {
      return res.status(400).json({
        success: false,
        message: 'Not checked in today'
      });
    }

    if (attendance.checkOut) {
      return res.status(400).json({
        success: false,
        message: 'Already checked out today'
      });
    }

    attendance.checkOut = new Date();
    await attendance.save();

    res.json({
      success: true,
      message: 'Checked out successfully',
      attendance
    });
  } catch (error) {
    logger.error(`Check out error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to check out'
    });
  }
};

// Record attendance (for superiors)
exports.recordAttendance = async (req, res) => {
  try {
    const { userId, date, status, checkIn, checkOut, notes } = req.body;

    const hasAccess = await canAccessUser(req.user, userId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    let attendance = await Attendance.findOne({
      user: userId,
      date: attendanceDate
    });

    if (attendance) {
      attendance.status = status;
      if (checkIn) attendance.checkIn = new Date(checkIn);
      if (checkOut) attendance.checkOut = new Date(checkOut);
      if (notes) attendance.notes = notes;
      attendance.approvedBy = req.user.userId;
    } else {
      attendance = new Attendance({
        user: userId,
        date: attendanceDate,
        status,
        checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null,
        notes,
        approvedBy: req.user.userId
      });
    }

    await attendance.save();

    await AuditLog.create({
      user: req.user.userId,
      action: 'user_update',
      resourceType: 'user',
      resourceId: userId,
      newValue: { attendance: { date, status } },
      success: true,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: 'Attendance recorded',
      attendance
    });
  } catch (error) {
    logger.error(`Record attendance error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to record attendance'
    });
  }
};

// Get attendance heatmap data
exports.getHeatmap = async (req, res) => {
  try {
    const { userId, year, month } = req.query;
    const targetUserId = userId || req.user.userId;

    const hasAccess = await canAccessUser(req.user, targetUserId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const startDate = new Date(year || new Date().getFullYear(), month ? month - 1 : 0, 1);
    const endDate = new Date(year || new Date().getFullYear(), month ? month : 12, 0);

    const attendance = await Attendance.find({
      user: targetUserId,
      date: { $gte: startDate, $lte: endDate }
    }).select('date status totalHours');

    // Format for heatmap
    const heatmapData = attendance.map(a => ({
      date: a.date.toISOString().split('T')[0],
      status: a.status,
      hours: a.totalHours
    }));

    res.json({
      success: true,
      heatmap: heatmapData
    });
  } catch (error) {
    logger.error(`Get heatmap error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get heatmap'
    });
  }
};
