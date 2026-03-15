const { Sprint, Task, AuditLog } = require('../models');
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

// Get all sprints
exports.getSprints = async (req, res) => {
  try {
    const { status, team, page = 1, limit = 20 } = req.query;

    const query = {};

    if (status) query.status = status;
    if (team) query.team = team;

    // Access control - can see sprints for teams user has access to
    if (!req.user.isAdmin) {
      const User = require('../models/User');
      const managedTeams = await User.find({ superior: req.user.userId }).select('_id');
      const teamIds = managedTeams.map(t => t._id.toString());
      teamIds.push(req.user.userId);

      // Only apply team filter if no explicit team was requested
      if (!team) {
        query.team = { $in: teamIds };
      }
    }

    const sprints = await Sprint.find(query)
      .populate('team', 'firstName lastName email role')
      .populate('createdBy', 'firstName lastName')
      .sort({ startDate: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Sprint.countDocuments(query);

    res.json({
      success: true,
      sprints,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error(`Get sprints error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get sprints'
    });
  }
};

// Get single sprint
exports.getSprint = async (req, res) => {
  try {
    const { id } = req.params;

    const sprint = await Sprint.findById(id)
      .populate('team', 'firstName lastName email avatar')
      .populate('createdBy', 'firstName lastName');

    if (!sprint) {
      return res.status(404).json({
        success: false,
        message: 'Sprint not found'
      });
    }

    // Get sprint tasks
    const tasks = await Task.find({ sprint: id })
      .populate('assignee', 'firstName lastName avatar')
      .sort({ status: 1, priority: -1 });

    // Calculate stats
    const completedTasks = tasks.filter(t => t.status === 'done');
    const completionRate = tasks.length > 0 ? completedTasks.length / tasks.length : 0;

    res.json({
      success: true,
      sprint: {
        ...sprint.toObject(),
        tasks,
        stats: {
          totalTasks: tasks.length,
          completedTasks: completedTasks.length,
          completionRate,
          totalStoryPoints: sprint.totalStoryPoints,
          completedStoryPoints: sprint.completedStoryPoints
        }
      }
    });
  } catch (error) {
    logger.error(`Get sprint error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get sprint'
    });
  }
};

// Create sprint
exports.createSprint = async (req, res) => {
  try {
    const {
      name,
      goal,
      startDate,
      endDate,
      totalStoryPoints
    } = req.body;

    // team defaults to the creating user — they always have access to themselves
    const team = req.body.team || req.user.userId;

    // Only check access if team is a different user and requester is not admin
    if (team !== req.user.userId && !req.user.isAdmin) {
      const hasAccess = await canAccessUser(req.user, team);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this team'
        });
      }
    }

    const sprint = new Sprint({
      name,
      goal,
      team,
      startDate,
      endDate,
      totalStoryPoints,
      createdBy: req.user.userId
    });

    await sprint.save();

    await AuditLog.create({
      user: req.user.userId,
      action: 'sprint_create',
      resourceType: 'sprint',
      resourceId: sprint._id,
      newValue: { name, team, startDate, endDate },
      success: true,
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Sprint created',
      sprint
    });
  } catch (error) {
    logger.error(`Create sprint error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to create sprint'
    });
  }
};

// Update sprint
exports.updateSprint = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const sprint = await Sprint.findById(id);

    if (!sprint) {
      return res.status(404).json({
        success: false,
        message: 'Sprint not found'
      });
    }

    // Only creator or admin can update
    if (sprint.createdBy.toString() !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const oldValue = { ...sprint.toObject() };

    Object.assign(sprint, updates);
    await sprint.save();

    await AuditLog.create({
      user: req.user.userId,
      action: 'sprint_update',
      resourceType: 'sprint',
      resourceId: id,
      oldValue,
      newValue: updates,
      success: true,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: 'Sprint updated',
      sprint
    });
  } catch (error) {
    logger.error(`Update sprint error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to update sprint'
    });
  }
};

// Complete sprint
exports.completeSprint = async (req, res) => {
  try {
    const { id } = req.params;
    const { retrospectiveNotes } = req.body;

    const sprint = await Sprint.findById(id);

    if (!sprint) {
      return res.status(404).json({
        success: false,
        message: 'Sprint not found'
      });
    }

    if (sprint.createdBy.toString() !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const tasks = await Task.find({ sprint: id, status: 'done' });
    const completedPoints = tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);

    sprint.status = 'completed';
    sprint.retrospectiveNotes = retrospectiveNotes;
    sprint.completedStoryPoints = completedPoints;
    sprint.velocity = completedPoints;

    await sprint.save();

    await AuditLog.create({
      user: req.user.userId,
      action: 'sprint_complete',
      resourceType: 'sprint',
      resourceId: id,
      success: true,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: 'Sprint completed',
      sprint
    });
  } catch (error) {
    logger.error(`Complete sprint error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to complete sprint'
    });
  }
};

// Delete sprint
exports.deleteSprint = async (req, res) => {
  try {
    const { id } = req.params;

    const sprint = await Sprint.findById(id);

    if (!sprint) {
      return res.status(404).json({
        success: false,
        message: 'Sprint not found'
      });
    }

    if (sprint.createdBy.toString() !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await Task.updateMany(
      { sprint: id },
      { $unset: { sprint: '' } }
    );

    await Sprint.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Sprint deleted'
    });
  } catch (error) {
    logger.error(`Delete sprint error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to delete sprint'
    });
  }
}; 