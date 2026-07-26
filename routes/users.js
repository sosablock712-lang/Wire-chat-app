const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const queries = require('../config/queries');
const { requireAuth } = require('../middleware/auth');
const { isOnline } = require('../config/presence');

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

function notifyUser(req, userId, event, payload) {
  const io = req.app.get('io');
  if (io) io.to(`user:${userId}`).emit(event, payload);
}

// ---------------- Search ----------------
// GET /api/users/search?q=alic
router.get('/search', (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  if (q.length < 2) return res.json({ users: [] });

  const users = queries.searchUsersByUsername.all(`%${q}%`, req.userId)
    .filter((u) => !queries.isBlocked.get({ a: req.userId, b: u.id }))
    .map((u) => ({ ...u, relationship: relationshipStatus(req.userId, u.id) }));
  res.json({ users });
});

// ---------------- Discover (People page) ----------------
// GET /api/users/discover?sort=recent|online|alpha&q=term
router.get('/discover', (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const sort = (req.query.sort || 'recent').toString();

  let users = queries.listAllUsersExceptSelf.all(req.userId)
    .filter((u) => !queries.isBlocked.get({ a: req.userId, b: u.id }));

  if (q) {
    users = users.filter((u) =>
      u.username.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q)
    );
  }

  users = users.map((u) => ({
    ...u,
    online: isOnline(u.id),
    relationship: relationshipStatus(req.userId, u.id)
  }));

  if (sort === 'alpha') {
    users.sort((a, b) => a.display_name.localeCompare(b.display_name));
  } else if (sort === 'online') {
    users.sort((a, b) => (b.online - a.online) || new Date(b.created_at) - new Date(a.created_at));
  } // 'recent' is already the SQL order (created_at DESC)

  res.json({ users });
});

// ---------------- Public profile (View Profile) ----------------
// GET /api/users/:id/profile
router.get('/:id/profile', (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'Invalid user id.' });
  const user = queries.getUserById.get(otherId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  res.json({
    user,
    friend_count: queries.countFriends.get(otherId, otherId).count,
    online: isOnline(otherId),
    relationship: relationshipStatus(req.userId, otherId),
    is_blocked_by_me: !!queries.hasBlocked.get(req.userId, otherId),
    is_muted: !!queries.isMuted.get(req.userId, otherId)
  });
});

// ---------------- Block ----------------
router.post('/:id/block', (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isInteger(otherId) || otherId === req.userId) return res.status(400).json({ error: 'Invalid user.' });
  queries.createBlock.run(req.userId, otherId);
  res.json({ ok: true, blocked: true });
});

router.delete('/:id/block', (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'Invalid user.' });
  queries.removeBlock.run(req.userId, otherId);
  res.json({ ok: true, blocked: false });
});

// ---------------- Mute ----------------
router.post('/:id/mute', (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'Invalid user.' });
  queries.toggleMuteOn.run(req.userId, otherId);
  res.json({ ok: true, muted: true });
});

router.delete('/:id/mute', (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'Invalid user.' });
  queries.toggleMuteOff.run(req.userId, otherId);
  res.json({ ok: true, muted: false });
});

// ---------------- Clear chat (hide until new activity) ----------------
router.post('/:id/clear-chat', (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'Invalid user.' });
  queries.clearChat.run(req.userId, otherId);
  res.json({ ok: true });
});

// ---------------- Contacts (accepted) ----------------
// GET /api/users/contacts
router.get('/contacts', (req, res) => {
  const contacts = queries.getAcceptedContacts.all(req.userId, req.userId, req.userId);
  const mutedIds = new Set(queries.getMutedContactIds.all(req.userId).map((r) => r.contact_id));

  const withPreview = contacts.map((c) => {
    const last = queries.getLastMessageForPair.get({ a: req.userId, b: c.id });
    const clearedRow = queries.getClearedAt.get(req.userId, c.id);

    // A cleared chat with no activity since clearing stays out of the list
    // entirely (matches "Delete Chat" behavior); it reappears the moment
    // there's a new message, same as most messaging apps.
    if (clearedRow && (!last || new Date(last.created_at) <= new Date(clearedRow.cleared_at))) {
      return null;
    }

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
      unread,
      muted: mutedIds.has(c.id),
      blockedByMe: !!queries.hasBlocked.get(req.userId, c.id)
    };
  }).filter(Boolean);

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
    queries.createNotification.run({
      user_id: existing.requester_id, type: 'friend_accept', actor_id: req.userId, post_id: null, preview: ''
    });
    notifyUser(req, existing.requester_id, 'contact_request_accepted', { byUserId: req.userId });
    notifyUser(req, existing.requester_id, 'notification', { type: 'friend_accept' });
    return res.status(200).json({
      status: 'accepted',
      contact: { id: target.id, username: target.username, display_name: target.display_name }
    });
  }

  queries.createContactRequest.run(req.userId, target.id);
  queries.createNotification.run({
    user_id: target.id, type: 'friend_request', actor_id: req.userId, post_id: null, preview: ''
  });
  notifyUser(req, target.id, 'contact_request_received', {});
  notifyUser(req, target.id, 'notification', { type: 'friend_request' });
  res.status(201).json({
    status: 'pending',
    contact: { id: target.id, username: target.username, display_name: target.display_name }
  });
});

// POST /api/users/contacts/requests/:id/accept
router.post('/contacts/requests/:id/accept', (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (!Number.isInteger(requestId)) return res.status(400).json({ error: 'Invalid request id.' });
  const row = queries.getContactRowById.get(requestId);
  const info = queries.acceptContactRequest.run(requestId, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Request not found.' });
  if (row) {
    queries.createNotification.run({
      user_id: row.requester_id, type: 'friend_accept', actor_id: req.userId, post_id: null, preview: ''
    });
    notifyUser(req, row.requester_id, 'contact_request_accepted', { byUserId: req.userId });
    notifyUser(req, row.requester_id, 'notification', { type: 'friend_accept' });
  }
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
