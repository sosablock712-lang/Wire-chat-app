# Wire — a modern, secure 1:1 chat app

A real-time chat application built from scratch: Node.js, Express, Socket.io,
and SQLite. No Docker, no Redis, no third-party chat SDKs — you own the
whole stack, and it deploys as a single web service.

## What's in this version

**Contacts**
- Search users by username
- Send / accept / decline contact requests (no more instant-add)
- Remove a contact
- Can't add yourself, can't send duplicate requests

**Chat list**
- Avatar (photo or initials), name, last message, timestamp, unread count,
  online/offline dot — sorted by most recent activity
- Search across your chat list

**Messaging**
- Real-time delivery over Socket.io
- Typing indicator
- Read receipts: single grey ✓ (sent) → double grey ✓✓ (delivered) →
  double blue ✓✓ (read)
- Reply to a message (quoted preview, tap to jump to the original)
- Edit and delete your own messages (delete is a soft-delete: shows
  "This message was deleted" for both people)
- Copy any message to clipboard
- Forward a message to another contact
- Emoji picker
- Image sharing, file sharing, voice notes (recorded in-browser)
- Search messages within a conversation

**Profiles**
- Display name, bio, profile photo upload
- Online status and "last seen"

**Notifications**
- Browser notifications (with permission prompt) for messages that arrive
  while you're not looking at that chat
- A short notification sound (synthesized in the browser, no audio file
  needed)
- Unread badge counts in the chat list and in the browser tab title

**Interface**
- Responsive, mobile-friendly layout (sidebar becomes a full-screen view
  on small screens, with a back button)
- Light/dark theme toggle
- Rounded bubbles, sticky header and composer, auto-scroll, date separators

**Security**
- bcrypt password hashing, JWT in an httpOnly cookie
- CSRF protection (double-submit cookie pattern) on every state-changing
  request
- Rate limiting on auth, messaging-adjacent uploads, etc.
- Helmet security headers + a strict Content-Security-Policy
- Parameterized SQL everywhere — no injection surface
- HTML-escaping everywhere on the frontend — no XSS from message content,
  names, or bios
- Upload validation: file-type allowlist, size limits, randomized filenames
  (the original filename is never used as a path)

## 1. Install

Requires Node.js 18+.

```bash
cd chat-app
npm install
```

## 2. Configure

```bash
cp .env.example .env
```

Set a real `JWT_SECRET` in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

The server refuses to start if this is left as the placeholder.

## 3. Run locally

```bash
npm start
```

Visit `http://localhost:3000`. Open a second browser/incognito window to
create a second account, add each other as contacts, and confirm real-time
messaging, typing, read receipts, and attachments all work.

## 4. Deploy (Render / Railway / a VPS)

Same as before — single Node process, build command `npm install`, start
command `npm start`, environment variables `JWT_SECRET`, `NODE_ENV=production`,
`CLIENT_URL=<your deployed URL>`.

**Important — persistent disk covers two things now, not just the database:**
- `data/chat.db` — your SQLite database
- `public/uploads/` — profile photos, shared images/files, and voice notes

On Render/Railway, make sure your persistent disk/volume is mounted so it
covers the app root (or both `data/` and `public/uploads/` specifically),
otherwise uploaded files and avatars disappear on every redeploy.

**Single-instance note:** online/offline presence is tracked in memory on
the Node process. This works great on a single instance (the default on
Render/Railway for an app like this) but won't stay in sync if you scale to
multiple instances without adding a shared store (e.g. Redis) for presence —
intentionally left out here per the "no Redis" requirement. Everything else
(messages, contacts, read receipts) is backed by SQLite and stays correct
regardless.

### On a plain VPS
Same as before: Node 18+, `npm install`, `.env`, a reverse proxy (Nginx or
Caddy) terminating HTTPS, and a process manager (pm2 or systemd) so it
survives restarts.

## Project structure

```
chat-app/
  server.js                 Express app + Socket.io real-time layer + presence
  config/
    db.js                    SQLite schema (+ safe migrations from v1)
    queries.js                All prepared SQL statements
  middleware/
    auth.js                   JWT sign/verify + auth middleware
    csrf.js                    CSRF double-submit cookie middleware
  routes/
    auth.js                    /api/auth/register, /login, /logout, /me
    users.js                   search, contacts, contact requests, profile, avatar
    messages.js                 conversation history + in-chat search
    upload.js                   file/image/voice upload (multer)
  public/
    index.html, register.html, chat.html
    css/style.css
    js/api.js, emoji.js, login.js, register.js, chat.js
    uploads/                   user-uploaded files (gitignored, kept via .gitkeep)
```

## How the contact request flow works

- `POST /api/users/contacts/requests { username }` — sends a request. If the
  other person already sent *you* one, this auto-accepts instead of creating
  a duplicate.
- `GET /api/users/contacts/requests` — your incoming and outgoing pending
  requests.
- `POST /api/users/contacts/requests/:id/accept` / `/decline`
- `DELETE /api/users/contacts/:userId` — remove an existing (accepted)
  contact. Message history is kept; the person just leaves your chat list
  until you message or re-add them.

## How read receipts work

Messages start as **sent**. The moment a message reaches a connected
recipient's browser (Socket.io emits it, or the server detects them coming
online with unread messages waiting), it's marked **delivered**. Only when
the recipient actually opens that conversation is `mark_read` emitted, which
flips it to **read** and pushes a live update back to the sender — this is
deliberately done over the socket event rather than the REST history fetch,
so the sender sees the blue ticks appear in real time instead of it silently
happening in the background.

## Extending it further

- Group chats (needs a `conversations` + `conversation_members` table —
  everything here is intentionally 1:1/pair-based to keep it simple)
- End-to-end encryption (bigger undertaking — moves key management to the
  client, server only ever sees ciphertext)
- Push notifications for fully offline users (would need a service worker +
  Web Push, or a mobile push provider)
- Multi-instance presence sync (add Redis pub/sub if you outgrow one server)
