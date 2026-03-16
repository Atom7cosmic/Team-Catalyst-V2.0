const { User, PromptTemplate, AuditLog, Recommendation } = require('../models');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Get all users (admin)
exports.getAllUsers = async (req, res) => {
  try {
    const { isActive, role, search, page = 1, limit = 50 } = req.query;

    const query = {};
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (role) query.role = role;
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .populate('superior', 'firstName lastName email')
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error(`Admin get users error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to get users' });
  }
};

// Activate/deactivate user
exports.toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const user = await User.findByIdAndUpdate(id, { isActive }, { new: true });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'}`,
      user
    });
  } catch (error) {
    logger.error(`Toggle user status error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to update user status' });
  }
};

// Get prompt templates
exports.getPromptTemplates = async (req, res) => {
  try {
    const templates = await PromptTemplate.find()
      .populate('createdBy', 'firstName lastName')
      .sort({ domain: 1 });

    res.json({ success: true, templates });
  } catch (error) {
    logger.error(`Get prompt templates error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to get prompt templates' });
  }
};

// Update prompt template
exports.updatePromptTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    updates.updatedBy = req.user.userId;

    const template = await PromptTemplate.findByIdAndUpdate(id, updates, { new: true });

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    await AuditLog.create({
      user: req.user.userId,
      action: 'prompt_update',
      resourceType: 'system',
      resourceId: id,
      success: true,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Template updated', template });
  } catch (error) {
    logger.error(`Update prompt template error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to update template' });
  }
};

// Get system stats
exports.getSystemStats = async (req, res) => {
  try {
    // ── Basic counts ──────────────────────────────────────────────────────────
    const [
      totalUsers,
      activeUsers,
      adminUsers,
      newUsersThisMonth,
      atRiskUsers,
      roleAggregation
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isAdmin: true }),
      User.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }),
      // at-risk = recommendations with category at_risk
      Recommendation.countDocuments({ category: 'at_risk' }).catch(() => 0),
      // group users by role for chart
      User.aggregate([
        { $match: { isAdmin: false } },
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ])
    ]);

    // ── Map role aggregation into chart-friendly format ───────────────────────
    // Group similar roles into readable buckets for the bar chart
    const roleBuckets = {
      'Engineers':  ['Software Engineer', 'Senior Engineer', 'Junior Engineer', 'Intern'],
      'Managers':   ['Engineering Manager', 'VP Engineering', 'Director of Engineering'],
      'Leads':      ['Tech Lead', 'CTO', 'CEO'],
      'QA / Ops':   ['QA Engineer', 'DevOps Engineer', 'Data Engineer', 'Security Engineer'],
    };

    const usersByRole = Object.entries(roleBuckets).map(([bucket, roles]) => ({
      role: bucket,
      count: roleAggregation
        .filter(r => roles.includes(r._id))
        .reduce((sum, r) => sum + r.count, 0)
    }));

    // ── Service connectivity (simple ping checks) ─────────────────────────────
    let mongoConnected = false;
    let redisConnected = false;
    let chromaConnected = false;

    try {
      await User.findOne().select('_id').lean();
      mongoConnected = true;
    } catch (_) {}

    try {
      const redis = require('../config/redis');
      if (redis?.status === 'ready' || typeof redis?.ping === 'function') {
        await redis.ping();
        redisConnected = true;
      }
    } catch (_) {}

    try {
      const chromaHost = process.env.CHROMA_HOST || 'chroma';
      const chromaPort = process.env.CHROMA_PORT || 8000;
      const response = await fetch(`http://${chromaHost}:${chromaPort}/api/v2/heartbeat`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) chromaConnected = true;
    } catch (_) {}

    res.json({
      success: true,
      stats: {
        users: totalUsers,
        activeUsers,
        adminUsers,
        newUsersThisMonth,
        atRiskUsers,
        usersByRole,
        mongoConnected,
        redisConnected,
        chromaConnected,
      }
    });
  } catch (error) {
    logger.error(`Get system stats error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to get system stats' });
  }
};

// Impersonate user (for admin support)
exports.impersonateUser = async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const jwt = require('jsonwebtoken');
    const accessToken = jwt.sign(
      {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
        roleLevel: user.roleLevel,
        isAdmin: user.isAdmin,
        superior: user.superior?.toString(),
        impersonatedBy: req.user.userId
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    await AuditLog.create({
      user: req.user.userId,
      action: 'user_impersonate',
      resourceType: 'user',
      resourceId: userId,
      success: true,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Impersonation token generated', accessToken });
  } catch (error) {
    logger.error(`Impersonate user error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to impersonate user' });
  }
};

// Create user (admin or superior)
exports.createUser = async (req, res) => {
  try {
    const { firstName, lastName, email, password, role, superior } = req.body;

    if (!firstName || !lastName || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'firstName, lastName, email, password and role are required'
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    const roleLevelMap = {
      'CEO': 1, 'CTO': 2, 'VP Engineering': 3,
      'Director of Engineering': 4, 'Engineering Manager': 5,
      'Tech Lead': 6, 'Senior Engineer': 6,
      'Software Engineer': 7, 'Junior Engineer': 8,
      'QA Engineer': 4, 'DevOps Engineer': 7,
      'Data Engineer': 7, 'Security Engineer': 7,
      'Intern': 9, 'Admin': 1
    };

    const user = new User({
      firstName,
      lastName,
      email,
      password,
      role,
      roleLevel: roleLevelMap[role] || 7,
      superior: superior || req.user.userId,
      isFirstLogin: true
    });

    await user.save();

    await AuditLog.create({
      user: req.user.userId,
      action: 'user_create',
      resourceType: 'user',
      resourceId: user._id,
      newValue: { firstName, lastName, email, role },
      success: true,
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        roleLevel: user.roleLevel
      }
    });
  } catch (error) {
    logger.error(`Create user error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
};