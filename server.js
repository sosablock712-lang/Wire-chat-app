require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const cookie = require('cookie');
const { Server } = require('socket.io');

const { verifyToken } = require('./middleware/auth');
const { ensureCsrfCookie, verifyCsrf } = require('./middleware/csrf');
const queries = require('./config/queries');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const uploadRoutes = require('./routes/upload');
const postRoutes = require('./routes/posts');
const notificationRoutes = require('./routes/notifications');
const searchRoutes = require('./routes/search');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'replace_this_with_a_long_random_secret') {
  console.error('\n[FATAL] JWT_SECRET is not set (or still the placeholder) in your .env file.');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"\n');
  process.exit(1);
}

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true
  }
});

// ---- Security & core middleware ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", process.env.CLIENT_URL || 'http://localhost:3000']
    }
  }
}));
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use(ensureCsrfCookie);
app.use(verifyCsrf);

// ---- API routes ----
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);

// ---- Static frontend & uploads ----
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Multer/file errors and any other thrown errors end up here as JSON,
// never as a stack trace leaked to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error.' });
});

// ---- Presence tracking (in-memory; no Redis needed for a single instance) ----
// Lives in ./config/presence so REST routes (e.g. Discover, sorted by who's
// online) can read the same state without a require() cycle.
const { markOnline, markOfflineAndCheck, isOnline, listOnlineIds } = require('./config/presence');

// Let routes emit socket events (e.g. broadcasting a brand-new registration
// to everyone's Discover list) via req.app.get('io').
app.set('io', io);

// ---- Socket.io real-time layer ----
// Every socket connection must present a valid auth cookie (same JWT as the REST API).
io.use((socket, next) => {
  try {
    const rawCookie = socket.handshake.headers.cookie;
    if (!rawCookie) return next(new Error('unauthorized'));
    const parsed = cookie.parse(rawCookie);
    const token = parsed['chat_token'];
    const payload = token ? verifyToken(token) : null;
    if (!payload) return next(new Error('unauthorized'));
    socket.userId = payload.sub;
    socket.username = payload.username;
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.userId}`);
  const wasOffline = !isOnline(socket.userId);
  markOnline(socket.userId);
  if (wasOffline) {
    io.emit('presence', { userId: socket.userId, online: true });
  }
  // Seed this client's view of who else is online (it only otherwise learns
  // about presence changes that happen *after* it connects).
  socket.emit('online_snapshot', { userIds: listOnlineIds() });

  // Delivered receipts for anything sent while this user was offline
  const undelivered = queries.getUndeliveredForRecipient.all(socket.userId);
  if (undelivered.length) {
    queries.markDelivered.run(socket.userId);
    const bySender = {};
    undelivered.forEach((m) => {
      bySender[m.sender_id] = bySender[m.sender_id] || [];
      bySender[m.sender_id].push(m.id);
    });
    Object.entries(bySender).forEach(([senderId, ids]) => {
      io.to(`user:${senderId}`).emit('messages_delivered', { toUserId: socket.userId, ids });
    });
  }

  socket.on('send_message', (payload, ack) => {
    try {
      let { toUserId, content, type, attachment, replyToId } = payload || {};
      toUserId = parseInt(toUserId, 10);
      content = typeof content === 'string' ? content.trim() : '';
      type = ['text', 'image', 'file', 'voice'].includes(type) ? type : 'text';
      replyToId = Number.isInteger(replyToId) ? replyToId : null;

      if (!Number.isInteger(toUserId)) {
        return ack && ack({ ok: false, error: 'Invalid recipient.' });
      }
      if (type === 'text' && !content) {
        return ack && ack({ ok: false, error: 'Message is empty.' });
      }
      if (type !== 'text' && (!attachment || !attachment.url)) {
        return ack && ack({ ok: false, error: 'Attachment missing.' });
      }
      if (content.length > 4000) {
        return ack && ack({ ok: false, error: 'Message too long.' });
      }

      const isContact = queries.isAcceptedContact.get({ a: socket.userId, b: toUserId });
      if (!isContact) {
        return ack && ack({ ok: false, error: 'You can only message your contacts.' });
      }
      if (queries.isBlocked.get({ a: socket.userId, b: toUserId })) {
        return ack && ack({ ok: false, error: 'You can\'t message this person.' });
      }

      const info = queries.insertMessage.run({
        sender_id: socket.userId,
        receiver_id: toUserId,
        content,
        type,
        attachment_path: attachment ? attachment.url : null,
        attachment_name: attachment ? attachment.name : null,
        attachment_mime: attachment ? attachment.mime : null,
        attachment_size: attachment ? attachment.size : null,
        reply_to_id: replyToId
      });

      // If recipient is online, it counts as delivered immediately. If not,
      // log a notification for them to see when they check in later.
      if (isOnline(toUserId)) {
        queries.markDelivered.run(toUserId);
      } else {
        queries.createNotification.run({
          user_id: toUserId, type: 'message', actor_id: socket.userId, post_id: null,
          preview: type === 'text' ? content.slice(0, 80) : (type === 'image' ? 'Sent a photo' : type === 'voice' ? 'Sent a voice note' : 'Sent a file')
        });
        io.to(`user:${toUserId}`).emit('notification', { type: 'message' });
      }

      const outgoing = queries.getMessageById.get(info.lastInsertRowid);
      if (replyToId) {
        const original = queries.getMessageById.get(replyToId);
        if (original) {
          outgoing.reply_preview = {
            id: original.id,
            sender_id: original.sender_id,
            content: original.deleted_at ? 'This message was deleted' : original.content,
            type: original.type
          };
        }
      }

      io.to(`user:${toUserId}`).emit('new_message', outgoing);
      ack && ack({ ok: true, message: outgoing });
    } catch (err) {
      console.error('send_message error:', err);
      ack && ack({ ok: false, error: 'Server error sending message.' });
    }
  });

  socket.on('edit_message', ({ messageId, content }, ack) => {
    try {
      const cleanContent = typeof content === 'string' ? content.trim() : '';
      if (!cleanContent || !Number.isInteger(messageId)) {
        return ack && ack({ ok: false, error: 'Invalid edit.' });
      }
      const info = queries.editMessage.run(cleanContent, messageId, socket.userId);
      if (info.changes === 0) {
        return ack && ack({ ok: false, error: 'Cannot edit this message.' });
      }
      const message = queries.getMessageById.get(messageId);
      io.to(`user:${message.sender_id}`).to(`user:${message.receiver_id}`).emit('message_edited', message);
      ack && ack({ ok: true, message });
    } catch (err) {
      console.error('edit_message error:', err);
      ack && ack({ ok: false, error: 'Server error editing message.' });
    }
  });

  socket.on('delete_message', ({ messageId }, ack) => {
    try {
      if (!Number.isInteger(messageId)) {
        return ack && ack({ ok: false, error: 'Invalid message.' });
      }
      const existing = queries.getMessageById.get(messageId);
      if (!existing) return ack && ack({ ok: false, error: 'Message not found.' });

      const info = queries.deleteMessage.run(messageId, socket.userId);
      if (info.changes === 0) {
        return ack && ack({ ok: false, error: 'Cannot delete this message.' });
      }
      io.to(`user:${existing.sender_id}`).to(`user:${existing.receiver_id}`)
        .emit('message_deleted', { id: messageId });
      ack && ack({ ok: true });
    } catch (err) {
      console.error('delete_message error:', err);
      ack && ack({ ok: false, error: 'Server error deleting message.' });
    }
  });

  // "Delete for me" — only removes it from the caller's own view. The other
  // person's copy is untouched, so no broadcast to them.
  socket.on('delete_for_me', ({ messageId }, ack) => {
    try {
      if (!Number.isInteger(messageId)) return ack && ack({ ok: false, error: 'Invalid message.' });
      const existing = queries.getMessageById.get(messageId);
      if (!existing) return ack && ack({ ok: false, error: 'Message not found.' });
      if (existing.sender_id !== socket.userId && existing.receiver_id !== socket.userId) {
        return ack && ack({ ok: false, error: 'Not your conversation.' });
      }
      queries.deleteMessageForMe.run(messageId, socket.userId);
      ack && ack({ ok: true });
    } catch (err) {
      console.error('delete_for_me error:', err);
      ack && ack({ ok: false, error: 'Server error.' });
    }
  });

  socket.on('react_message', ({ messageId, emoji }, ack) => {
    try {
      if (!Number.isInteger(messageId) || typeof emoji !== 'string' || !emoji.trim()) {
        return ack && ack({ ok: false, error: 'Invalid reaction.' });
      }
      const existing = queries.getMessageById.get(messageId);
      if (!existing) return ack && ack({ ok: false, error: 'Message not found.' });
      if (existing.sender_id !== socket.userId && existing.receiver_id !== socket.userId) {
        return ack && ack({ ok: false, error: 'Not your conversation.' });
      }
      queries.setReaction.run(messageId, socket.userId, emoji.trim().slice(0, 8));
      const payload = { messageId, userId: socket.userId, emoji: emoji.trim().slice(0, 8) };
      io.to(`user:${existing.sender_id}`).to(`user:${existing.receiver_id}`).emit('reaction_updated', payload);
      ack && ack({ ok: true });
    } catch (err) {
      console.error('react_message error:', err);
      ack && ack({ ok: false, error: 'Server error.' });
    }
  });

  socket.on('remove_reaction', ({ messageId }, ack) => {
    try {
      if (!Number.isInteger(messageId)) return ack && ack({ ok: false, error: 'Invalid message.' });
      const existing = queries.getMessageById.get(messageId);
      if (!existing) return ack && ack({ ok: false, error: 'Message not found.' });
      queries.removeReaction.run(messageId, socket.userId);
      io.to(`user:${existing.sender_id}`).to(`user:${existing.receiver_id}`)
        .emit('reaction_removed', { messageId, userId: socket.userId });
      ack && ack({ ok: true });
    } catch (err) {
      console.error('remove_reaction error:', err);
      ack && ack({ ok: false, error: 'Server error.' });
    }
  });

  socket.on('pin_message', ({ messageId }, ack) => {
    try {
      if (!Number.isInteger(messageId)) return ack && ack({ ok: false, error: 'Invalid message.' });
      const existing = queries.getMessageById.get(messageId);
      if (!existing) return ack && ack({ ok: false, error: 'Message not found.' });
      if (existing.sender_id !== socket.userId && existing.receiver_id !== socket.userId) {
        return ack && ack({ ok: false, error: 'Not your conversation.' });
      }
      queries.pinMessage.run(messageId, socket.userId);
      const pin = { message_id: messageId, content: existing.content, type: existing.type, sender_id: existing.sender_id };
      io.to(`user:${existing.sender_id}`).to(`user:${existing.receiver_id}`).emit('message_pinned', pin);
      ack && ack({ ok: true });
    } catch (err) {
      console.error('pin_message error:', err);
      ack && ack({ ok: false, error: 'Server error.' });
    }
  });

  socket.on('unpin_message', ({ messageId }, ack) => {
    try {
      if (!Number.isInteger(messageId)) return ack && ack({ ok: false, error: 'Invalid message.' });
      const existing = queries.getMessageById.get(messageId);
      if (!existing) return ack && ack({ ok: false, error: 'Message not found.' });
      queries.unpinMessage.run(messageId);
      io.to(`user:${existing.sender_id}`).to(`user:${existing.receiver_id}`).emit('message_unpinned', { messageId });
      ack && ack({ ok: true });
    } catch (err) {
      console.error('unpin_message error:', err);
      ack && ack({ ok: false, error: 'Server error.' });
    }
  });

  socket.on('mark_read', ({ contactId }) => {
    contactId = parseInt(contactId, 10);
    if (!Number.isInteger(contactId)) return;
    const ids = queries.getUnreadMessageIds.all(contactId, socket.userId).map((m) => m.id);
    if (!ids.length) return;
    queries.markRead.run(contactId, socket.userId);
    io.to(`user:${contactId}`).emit('messages_read', { byUserId: socket.userId, ids });
  });

  socket.on('typing', ({ toUserId }) => {
    toUserId = parseInt(toUserId, 10);
    if (Number.isInteger(toUserId)) {
      io.to(`user:${toUserId}`).emit('typing', { fromUserId: socket.userId });
    }
  });

  socket.on('stop_typing', ({ toUserId }) => {
    toUserId = parseInt(toUserId, 10);
    if (Number.isInteger(toUserId)) {
      io.to(`user:${toUserId}`).emit('stop_typing', { fromUserId: socket.userId });
    }
  });

  socket.on('disconnect', () => {
    const trulyOffline = markOfflineAndCheck(socket.userId);
    if (trulyOffline) {
      queries.touchLastSeen.run(socket.userId);
      io.emit('presence', { userId: socket.userId, online: false, lastSeen: new Date().toISOString() });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chat app running on http://localhost:${PORT}`);
});
