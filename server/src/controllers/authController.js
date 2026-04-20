const User = require('../models/User');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/tokens');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

exports.register = async (req, res) => {
  const { name, email, password, role } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ message: 'Email already in use' });

  const user = await User.create({ name, email, password, role });
  const accessToken = signAccess({ id: user._id, role: user.role });
  const refreshToken = signRefresh({ id: user._id });

  user.refreshToken = refreshToken;
  await user.save();

  res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
  res.status(201).json({ accessToken, user });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await user.matchPassword(password))) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const accessToken = signAccess({ id: user._id, role: user.role });
  const refreshToken = signRefresh({ id: user._id });

  user.refreshToken = refreshToken;
  await user.save();

  res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
  res.json({ accessToken, user });
};

exports.refresh = async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ message: 'No refresh token' });

  const decoded = verifyRefresh(token);
  const user = await User.findById(decoded.id);
  if (!user || user.refreshToken !== token) {
    return res.status(403).json({ message: 'Token reuse detected' });
  }

  const accessToken = signAccess({ id: user._id, role: user.role });
  const newRefresh = signRefresh({ id: user._id });

  user.refreshToken = newRefresh;
  await user.save();

  res.cookie('refreshToken', newRefresh, COOKIE_OPTS);
  res.json({ accessToken });
};

exports.logout = async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    const user = await User.findOne({ refreshToken: token });
    if (user) {
      user.refreshToken = null;
      await user.save();
    }
  }
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out' });
};

exports.me = (req, res) => {
  res.json({ user: req.user });
};
