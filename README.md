# Wirely — Fast. Private. Connected.

Version 2 — a polish and redesign pass on top of the same working
foundation: Node.js, Express, Socket.io, SQLite. Same architecture, same
database, same deployment story. No rebuild, no removed functionality.

## What's new in V2

**Rebrand** — renamed to Wirely everywhere (titles, pages, notifications,
manifest, favicon, README).

**Splash screen** — a ~1s animated startup: an SVG lightning bolt draws
itself in with a glow pulse, the wordmark fades in, then it dismisses into
the app. No spinner, no progress bar.

**8 built-in themes** — Midnight (default), Ocean Blue, Emerald Green, Ruby
Red, Pink Blossom, Purple Neon, AMOLED Black, and Clean White. Switchable
from Settings, remembered via `localStorage`. Themes use semantic tokens
(`--bubble-in-*` / `--bubble-out-*` rather than hardcoded "light paper /
dark sent") so inverted themes like AMOLED render correctly instead of
just recoloring a light-mode assumption.

**People page** — replaces the old bare "Requests" tab. Two sub-tabs:
- *Requests*: incoming (accept/decline) and outgoing (pending) — unchanged
  logic from V1, restyled.
- *Discover*: every registered user except you, with profile picture,
  display name, username, bio, and live online/offline status. The
  Add Friend / Pending / Message button state updates automatically based
  on your relationship with that person. Search and three sort modes
  (Newest, Online first, A–Z). New registrations appear in everyone's
  Discover list live via Socket.io, no refresh needed.

**Chat/composer polish** — rounded bubbles restyled per-theme, a proper
attachment menu (Photo & Video / Document) instead of a single bare file
picker, skeleton loading placeholders while chats and messages load,
button ripple feedback, smoother modal/message animations, sticky header
and composer, date separators. Typing indicator, read receipts, reply,
edit, delete, copy, forward, emoji picker, image/file/voice notes — all
unchanged in function, restyled in appearance.

**Settings** — theme picker, display name, bio, and profile photo, all in
one place (opened from your avatar in the sidebar).

**Performance / code quality** — no new runtime dependencies were added
for any of the above (pure CSS/vanilla JS on the frontend). Presence
tracking was pulled out of `server.js` into `config/presence.js` so the
new Discover endpoint can read the same online/offline state without
duplicating it — that's the only structural refactor in this pass.

## Everything from V1 is still here, unchanged in behavior

Registration, login, contacts/friend requests, real-time 1:1 messaging,
Socket.io, SQLite persistence, bcrypt/JWT/CSRF/Helmet/rate-limiting
security, and the Render deployment model are all exactly as before. No
database migration is required to upgrade from V1 — the schema didn't
change in this pass (Discover uses the `bio`/`avatar_path`/`created_at`
columns that already existed).

## 1. Install

Requires Node.js 18+.

```bash
cd chat-app
npm install
```

(No new dependencies were added in V2 — if you're upgrading in place from
a V1 `node_modules`, you don't strictly need to reinstall, but it doesn't
hurt.)

## 2. Configure

```bash
cp .env.example .env
```

Set a real `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## 3. Run locally

```bash
npm start
```

Visit `http://localhost:3000`. Register two accounts to see Discover, send
a friend request, accept it, and message each other.

## 4. Deploy (Render / Railway / a VPS)

Unchanged from V1: build command `npm install`, start command `npm start`,
env vars `JWT_SECRET`, `NODE_ENV=production`, `CLIENT_URL=<your URL>`.
Persistent disk still needs to cover `data/chat.db` and `public/uploads/`.

Presence (used for online dots and Discover's "online first" sort) is
tracked in memory on a single Node process — fine for the default
single-instance Render/Railway setup, and intentionally left without
Redis per the brief. See `config/presence.js`.

## Project structure

```
chat-app/
  server.js                  Express app + Socket.io + presence wiring
  config/
    db.js                     SQLite schema (+ migrations from earlier versions)
    queries.js                 All prepared SQL statements
    presence.js                 Shared in-memory online/offline tracking
  middleware/
    auth.js                     JWT sign/verify + auth middleware
    csrf.js                      CSRF double-submit cookie middleware
  routes/
    auth.js                      register/login/logout/me (+ live "user_registered" broadcast)
    users.js                     search, contacts, requests, Discover, profile, avatar
    messages.js                   conversation history + in-chat search
    upload.js                     file/image/voice upload (multer)
  public/
    index.html, register.html, chat.html
    favicon.svg, manifest.json
    css/style.css                theme tokens + full UI
    js/api.js, emoji.js, splash.js, login.js, register.js, chat.js
    uploads/                     user-uploaded files (gitignored, kept via .gitkeep)
```

## Extending it further

Deliberately left out of this version per the brief: phone/OTP auth, voice
or video calls, group chats, end-to-end encryption, and cloud storage
migration. All of those are natural next versions but would each be a
significant new system rather than a polish pass.
