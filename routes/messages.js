const express = require('express');
const queries = require('../config/queries');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function attachReplyPreview(message) {
  if (!message.reply_to_id) return message;
  const original = queries.getMessageById.get(message.reply_to_id);
  if (!original) return message;
  return {
    ...message,
    reply_preview: {
      id: original.id,
      sender_id: original.sender_id,
      content: original.deleted_at ? 'This message was deleted' : original.content,
      type: original.type
    }
  };
}

// GET /api/messages/:contactId?limit=50&offset=0
router.get('/:contactId', (req, res) => {
  const contactId = parseInt(req.params.contactId, 10);
  if (!Number.isInteger(contactId)) return res.status(400).json({ error: 'Invalid contact id.' });

  const isContact = queries.isAcceptedContact.get({ a: req.userId, b: contactId });
  if (!isContact) return res.status(403).json({ error: 'Not in your contacts.' });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const messages = queries.getConversation
    .all({ a: req.userId, b: contactId, limit, offset })
    .map(attachReplyPreview);

  // Intentionally NOT marking messages read here. Read state is set via the
  // 'mark_read' Socket.io event instead, so the sender gets a live update
  // (blue ticks) the moment the recipient actually opens the chat, rather
  // than silently going stale in the background over plain REST.
  res.json({ messages });
});

// GET /api/messages/:contactId/search?q=term
router.get('/:contactId/search', (req, res) => {
  const contactId = parseInt(req.params.contactId, 10);
  if (!Number.isInteger(contactId)) return res.status(400).json({ error: 'Invalid contact id.' });

  const isContact = queries.isAcceptedContact.get({ a: req.userId, b: contactId });
  if (!isContact) return res.status(403).json({ error: 'Not in your contacts.' });

  const q = (req.query.q || '').toString().trim();
  if (q.length < 1) return res.json({ messages: [] });

  const messages = queries.searchConversation.all({
    a: req.userId,
    b: contactId,
    term: `%${q}%`
  });
  res.json({ messages });
});

module.exports = router;
