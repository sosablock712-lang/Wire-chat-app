const express = require('express');
const queries = require('../config/queries');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function labelFor(n) {
  const actor = n.actor_display_name || 'Someone';
  if (n.type === 'friend_request') return `${actor} sent you a friend request`;
  if (n.type === 'friend_accept') return `${actor} accepted your friend request`;
  if (n.type === 'like') return `${actor} liked your post`;
  if (n.type === 'comment') return `${actor} commented: ${n.preview}`;
  if (n.type === 'message') return `${actor}: ${n.preview}`;
  return n.preview;
}

// GET /api/notifications
router.get('/', (req, res) => {
  const rows = queries.getNotifications.all(req.userId);
  const notifications = rows.map((n) => ({
    id: n.id,
    type: n.type,
    actor: n.actor_id ? { id: n.actor_id, username: n.actor_username, display_name: n.actor_display_name, avatar_path: n.actor_avatar_path } : null,
    post_id: n.post_id,
    label: labelFor(n),
    read: !!n.read_at,
    created_at: n.created_at
  }));
  res.json({ notifications, unread: queries.getUnreadNotificationCount.get(req.userId).count });
});

// POST /api/notifications/read - mark all as read
router.post('/read', (req, res) => {
  queries.markAllNotificationsRead.run(req.userId);
  res.json({ ok: true });
});

module.exports = router;
