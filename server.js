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
// Maps userId -> count of open sockets (a user can have multiple tabs open).
const onlineCounts = new Map();

function markOnline(userId) {
  onlineCounts.set(userId, (onlineCounts.get(userId) || 0) + 1);
}
function markOfflineAndCheck(userId) {
  const next = (onlineCounts.get(userId) || 1) - 1;
  if (next <= 0) {
    onlineCounts.delete(userId);
    return true; // truly offline now
  }
  onlineCounts.set(userId, next);
  return false;
}
function isOnline(userId) {
  return onlineCounts.has(userId);
}

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

      // If recipient is online, it counts as delivered immediately.
      if (isOnline(toUserId)) {
        queries.markDelivered.run(toUserId);
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
