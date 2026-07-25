const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const queries = require('../config/queries');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 12;

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// Slow down brute-force attempts on login/register
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' }
});

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, password, displayName } = req.body || {};

    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3-20 characters: letters, numbers, underscores only.'
      });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const cleanDisplayName = (typeof displayName === 'string' && displayName.trim())
      ? displayName.trim().slice(0, 40)
      : username;

    const existing = queries.getUserByUsername.get(username.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const info = queries.createUser.run({
      username: username.toLowerCase(),
      display_name: cleanDisplayName,
      password_hash
    });

    const user = queries.getUserById.get(info.lastInsertRowid);
    const token = signToken(user);
    setAuthCookie(res, token);

    res.status(201).json({ user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = queries.getUserByUsername.get(username.toLowerCase());
    // Always run bcrypt.compare even if user is missing, to avoid leaking
    // via response-time whether a username exists.
    const hash = user ? user.password_hash : '$2b$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltinva';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    queries.touchLastSeen.run(user.id);
    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user: queries.getUserById.get(user.id) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong logging you in.' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = queries.getUserById.get(req.userId);
  res.json({ user });
});

module.exports = router;
