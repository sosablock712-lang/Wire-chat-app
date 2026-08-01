const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
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

  const users = queries.searchUsersByUsername.all({ term: `%${q}%`, myId: req.userId })
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
    follower_count: queries.countFollowers.get(otherId).count,
    following_count: queries.countFollowing.get(otherId).count,
    post_count: queries.countPostsByAuthor.get(otherId).count,
    mutual_friend_count: queries.countMutualFriends.get({ me: req.userId, other: otherId }).count,
    online: isOnline(otherId),
    relationship: relationshipStatus(req.userId, otherId),
    is_following: !!queries.isFollowing.get(req.userId, otherId),
    is_blocked_by_me: !!queries.hasBlocked.get(req.userId, otherId),
    is_muted: !!queries.isMuted.get(req.userId, otherId)
  });
});

// GET /api/users/:id/followers
router.get('/:id/followers', (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'Invalid user id.' });
  res.json({ users: queries.listFollowers.all(otherId) });
});

// GET /api/users/:id/following
router.get('/:id/following', (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'Invalid user id.' });
  res.json({ users: queries.listFollowing.all(otherId) });
});

// ---------------- Follow ----------------
router.post('/:id/follow', (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isInteger(otherId) || otherId === req.userId) return res.status(400).json({ error: 'Invalid user.' });
  queries.followUser.run(req.userId, otherId);
  queries.createNotification.run({ user_id: otherId, type: 'friend_accept', actor_id: req.userId, post_id: null, preview: 'started following you' });
  notifyUser(req, otherId, 'notification', { type: 'follow' });
  res.json({ ok: true, following: true, follower_count: queries.countFollowers.get(otherId).count });
});

router.delete('/:id/follow', (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'Invalid user.' });
  queries.unfollowUser.run(req.userId, otherId);
  res.json({ ok: true, following: false, follower_count: queries.countFollowers.get(otherId).count });
});

// ---------------- Report user ----------------
const reportUserLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
router.post('/:id/report', reportUserLimiter, (req, res) => {
  const otherId = parseInt(req.params.id, 10);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
  if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'Invalid user.' });
  queries.reportUser.run(req.userId, otherId, reason);
  res.json({ ok: true });
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
      blockedByMe: !!queries.hasBlocked.get(req.userId, c.id),
      blockedMe: !!queries.hasBlocked.get(c.id, req.userId)
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
// PATCH /api/users/me { displayName, bio, university, location }
router.patch('/me', (req, res) => {
  const { displayName, bio, university, location } = req.body || {};
  const cleanName = (typeof displayName === 'string' && displayName.trim())
    ? displayName.trim().slice(0, 40)
    : null;
  const cleanBio = typeof bio === 'string' ? bio.trim().slice(0, 200) : '';

  if (!cleanName) return res.status(400).json({ error: 'Display name is required.' });

  queries.updateProfile.run({ id: req.userId, display_name: cleanName, bio: cleanBio });
  if (university !== undefined || location !== undefined) {
    queries.updateProfileExtra.run({
      id: req.userId,
      university: typeof university === 'string' ? university.trim().slice(0, 80) || null : null,
      location_text: typeof location === 'string' ? location.trim().slice(0, 80) || null : null
    });
  }
  res.json({ user: queries.getUserById.get(req.userId) });
});

// POST /api/users/me/tour-complete — marks the first-time app walkthrough as seen
router.post('/me/tour-complete', (req, res) => {
  queries.markTourCompleted.run(req.userId);
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

// Cover photo upload (same pattern as avatar)
const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 6) || '.jpg';
      cb(null, 'cover-' + crypto.randomBytes(12).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      return cb(new Error('Cover photo must be an image (JPEG, PNG, WEBP, or GIF).'));
    }
    cb(null, true);
  }
});

router.post('/me/cover', (req, res) => {
  coverUpload.single('cover')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    if (!req.file) return res.status(400).json({ error: 'No image received.' });
    queries.updateCover.run(`/uploads/${req.file.filename}`, req.userId);
    res.json({ user: queries.getUserById.get(req.userId) });
  });
});

// PATCH /api/users/me/badge { badge: 'blue_check'|'gold_lightning'|'red_check'|null }
const ALLOWED_BADGES = new Set(['blue_check', 'gold_lightning', 'red_check']);
router.patch('/me/badge', (req, res) => {
  const { badge } = req.body || {};
  const clean = badge === null || badge === undefined ? null : String(badge);
  if (clean !== null && !ALLOWED_BADGES.has(clean)) {
    return res.status(400).json({ error: 'Not a valid badge.' });
  }
  queries.updateBadge.run(clean, req.userId);
  res.json({ user: queries.getUserById.get(req.userId) });
});

// PATCH /api/users/me/wallpaper { wallpaper }
router.patch('/me/wallpaper', (req, res) => {
  const wallpaper = typeof req.body?.wallpaper === 'string' ? req.body.wallpaper.slice(0, 60) : 'default';
  queries.updateWallpaper.run(wallpaper, req.userId);
  res.json({ user: queries.getUserById.get(req.userId) });
});

// PATCH /api/users/me/privacy { privacy: 'public'|'private' }
router.patch('/me/privacy', (req, res) => {
  const privacy = req.body?.privacy === 'private' ? 'private' : 'public';
  queries.updatePrivacy.run(privacy, req.userId);
  res.json({ user: queries.getUserById.get(req.userId) });
});

// POST /api/users/me/onboarding { birthday, country, interests: [...], privacy }
router.post('/me/onboarding', (req, res) => {
  const { birthday, country, interests, privacy } = req.body || {};
  const cleanBirthday = typeof birthday === 'string' ? birthday.slice(0, 10) : null;
  const cleanCountry = typeof country === 'string' ? country.slice(0, 60) : null;
  const cleanInterests = Array.isArray(interests) ? JSON.stringify(interests.slice(0, 20).map((i) => String(i).slice(0, 30))) : '[]';
  const cleanPrivacy = privacy === 'private' ? 'private' : 'public';

  queries.completeOnboarding.run({
    id: req.userId, birthday: cleanBirthday, country: cleanCountry, interests: cleanInterests, privacy: cleanPrivacy
  });
  res.json({ user: queries.getUserById.get(req.userId) });
});

module.exports = router;
