const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'chat_token';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Express middleware: requires a valid auth cookie, attaches req.userId
function requireAuth(req, res, next) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
  req.userId = payload.sub;
  req.username = payload.username;
  next();
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,               // JS on the page can never read this cookie
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

module.exports = {
  COOKIE_NAME,
  signToken,
  verifyToken,
  requireAuth,
  setAuthCookie,
  clearAuthCookie
};
