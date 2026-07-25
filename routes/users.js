const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const queries = require('../config/queries');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function relationshipStatus(myId, otherId) {
  const row = queries.findContactRow.get({ a: myId, b: otherId });
  if (!row) return 'none';
  if (row.status === 'accepted') return 'accepted';
  if (row.requester_id === myId) return 'pending_sent';
  return 'pending_received';
}

// ---------------- Search ----------------
// GET /api/users/search?q=alic
router.get('/search', (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  if (q.length < 2) return res.json({ users: [] });

  const users = queries.searchUsersByUsername.all(`%${q}%`, req.userId).map((u) => ({
    ...u,
    relationship: relationshipStatus(req.userId, u.id)
  }));
  res.json({ users });
});

// ---------------- Contacts (accepted) ----------------
// GET /api/users/contacts
router.get('/contacts', (req, res) => {
  const contacts = queries.getAcceptedContacts.all(req.userId, req.userId, req.userId);
  const withPreview = contacts.map((c) => {
    const last = queries.getLastMessageForPair.get({ a: req.userId, b: c.id });
    const unread = queries.getUnreadCount.get(c.id, req.userId).count;
    let previewText = null;
    if (last) {
      if (last.deleted_at) previewText = 'This message was deleted';
      else if (last.type === 'image') previewText = 'Photo';
      else if (last.type === 'voice') previewText = 'Voice message';
      else if (last.type === 'file') previewText = 'File';
      else previewText = last.content;
    }
    return {
      ...c,
      lastMessage: previewText,
      lastMessageAt: last ? last.created_at : null,
      unread
    };
  });
  res.json({ contacts: withPreview });
});

// DELETE /api/users/contacts/:userId - remove an accepted contact
router.delete('/contacts/:userId', (req, res) => {
  const otherId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'Invalid user id.' });
  queries.removeContact.run({ a: req.userId, b: otherId });
  res.json({ ok: true });
});

// ---------------- Contact requests ----------------
// GET /api/users/contacts/requests - both incoming and outgoing
router.get('/contacts/requests', (req, res) => {
  res.json({
    incoming: queries.getIncomingRequests.all(req.userId),
    outgoing: queries.getOutgoingRequests.all(req.userId)
  });
});

// POST /api/users/contacts/requests { username }
router.post('/contacts/requests', (req, res) => {
  const { username } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    return res.status(400).json({ error: 'Enter a valid username.' });
  }
  const target = queries.getUserByUsername.get(username.trim().toLowerCase());
  if (!target) return res.status(404).json({ error: 'No user with that username.' });
  if (target.id === req.userId) return res.status(400).json({ error: "You can't add yourself." });

  const existing = queries.findContactRow.get({ a: req.userId, b: target.id });
  if (existing) {
    if (existing.status === 'accepted') {
      return res.status(409).json({ error: 'Already in your contacts.' });
    }
    if (existing.requester_id === req.userId) {
      return res.status(409).json({ error: 'Request already sent.' });
    }
    // They already sent us a request — accept it instead of duplicating.
    queries.acceptContactRequest.run(existing.id, req.userId);
    return res.status(200).json({
      status: 'accepted',
      contact: { id: target.id, username: target.username, display_name: target.display_name }
    });
  }

  queries.createContactRequest.run(req.userId, target.id);
  res.status(201).json({
    status: 'pending',
    contact: { id: target.id, username: target.username, display_name: target.display_name }
  });
});

// POST /api/users/contacts/requests/:id/accept
router.post('/contacts/requests/:id/accept', (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (!Number.isInteger(requestId)) return res.status(400).json({ error: 'Invalid request id.' });
  const info = queries.acceptContactRequest.run(requestId, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Request not found.' });
  res.json({ ok: true });
});

// POST /api/users/contacts/requests/:id/decline
router.post('/contacts/requests/:id/decline', (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (!Number.isInteger(requestId)) return res.status(400).json({ error: 'Invalid request id.' });
  const info = queries.declineOrCancelRequest.run(requestId, req.userId, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Request not found.' });
  res.json({ ok: true });
});

// ---------------- Profile ----------------
// PATCH /api/users/me { displayName, bio }
router.patch('/me', (req, res) => {
  const { displayName, bio } = req.body || {};
  const cleanName = (typeof displayName === 'string' && displayName.trim())
    ? displayName.trim().slice(0, 40)
    : null;
  const cleanBio = typeof bio === 'string' ? bio.trim().slice(0, 200) : '';

  if (!cleanName) return res.status(400).json({ error: 'Display name is required.' });

  queries.updateProfile.run({ id: req.userId, display_name: cleanName, bio: cleanBio });
  res.json({ user: queries.getUserById.get(req.userId) });
});

// Avatar upload
const AVATAR_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 6) || '.jpg';
      cb(null, 'avatar-' + crypto.randomBytes(12).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      return cb(new Error('Avatar must be an image (JPEG, PNG, WEBP, or GIF).'));
    }
    cb(null, true);
  }
});

router.post('/me/avatar', (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    if (!req.file) return res.status(400).json({ error: 'No image received.' });

    queries.updateAvatar.run(`/uploads/${req.file.filename}`, req.userId);
    res.json({ user: queries.getUserById.get(req.userId) });
  });
});

module.exports = router;
