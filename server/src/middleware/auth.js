const { verifyAccess } = require('../utils/tokens');
const User = require('../models/User');

const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  const decoded = verifyAccess(token);
  req.user = await User.findById(decoded.id).select('-password -refreshToken');
  if (!req.user) return res.status(401).json({ message: 'User not found' });
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
};

module.exports = { requireAuth, requireRole };
