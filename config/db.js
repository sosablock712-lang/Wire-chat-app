const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'chat.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Base schema (kept from v1, extended below via migrations) ----
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    avatar_path   TEXT,
    last_seen     TEXT NOT NULL DEFAULT (datetime('now')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(requester_id, addressee_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL DEFAULT '',
    type            TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','image','file','voice')),
    attachment_path TEXT,
    attachment_name TEXT,
    attachment_mime TEXT,
    attachment_size INTEGER,
    reply_to_id     INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    edited_at       TEXT,
    deleted_at      TEXT,
    delivered_at    TEXT,
    read_at         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_pair
    ON messages (sender_id, receiver_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_contacts_requester ON contacts (requester_id, status);
  CREATE INDEX IF NOT EXISTS idx_contacts_addressee ON contacts (addressee_id, status);
`);

// ---- Lightweight migrations for anyone upgrading from the v1 schema ----
function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

const userCols = {
  bio: `ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''`,
  avatar_path: `ALTER TABLE users ADD COLUMN avatar_path TEXT`,
  last_seen: `ALTER TABLE users ADD COLUMN last_seen TEXT NOT NULL DEFAULT (datetime('now'))`
};
for (const [col, sql] of Object.entries(userCols)) {
  if (!columnExists('users', col)) db.exec(sql);
}

const messageCols = {
  type: `ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'text'`,
  attachment_path: `ALTER TABLE messages ADD COLUMN attachment_path TEXT`,
  attachment_name: `ALTER TABLE messages ADD COLUMN attachment_name TEXT`,
  attachment_mime: `ALTER TABLE messages ADD COLUMN attachment_mime TEXT`,
  attachment_size: `ALTER TABLE messages ADD COLUMN attachment_size INTEGER`,
  reply_to_id: `ALTER TABLE messages ADD COLUMN reply_to_id INTEGER`,
  edited_at: `ALTER TABLE messages ADD COLUMN edited_at TEXT`,
  deleted_at: `ALTER TABLE messages ADD COLUMN deleted_at TEXT`,
  delivered_at: `ALTER TABLE messages ADD COLUMN delivered_at TEXT`
};
for (const [col, sql] of Object.entries(messageCols)) {
  if (!columnExists('messages', col)) db.exec(sql);
}

// If an old v1 "contacts" table (user_id/contact_id, no status) exists, migrate it.
const contactCols = db.prepare(`PRAGMA table_info(contacts)`).all().map((c) => c.name);
if (contactCols.includes('user_id') && !contactCols.includes('requester_id')) {
  db.exec(`
    ALTER TABLE contacts RENAME TO contacts_old_v1;
    CREATE TABLE contacts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(requester_id, addressee_id)
    );
    INSERT OR IGNORE INTO contacts (requester_id, addressee_id, status)
      SELECT user_id, contact_id, 'accepted' FROM contacts_old_v1;
    DROP TABLE contacts_old_v1;
    CREATE INDEX IF NOT EXISTS idx_contacts_requester ON contacts (requester_id, status);
    CREATE INDEX IF NOT EXISTS idx_contacts_addressee ON contacts (addressee_id, status);
  `);
}

// ---- Beta 2.5 additions ----
// These are all NEW tables only. Nothing about users/contacts/messages above
// is altered, so upgrading in place from V2 requires no data migration and
// breaks nothing that already works.
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content       TEXT NOT NULL DEFAULT '',
    image_path    TEXT,
    edited_at     TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author_id);

  CREATE TABLE IF NOT EXISTS post_likes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id       INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(post_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes (post_id);

  CREATE TABLE IF NOT EXISTS post_comments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id       INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments (post_id, created_at);

  CREATE TABLE IF NOT EXISTS notifications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          TEXT NOT NULL CHECK (type IN ('friend_request','friend_accept','like','comment','message')),
    actor_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    post_id       INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    preview       TEXT NOT NULL DEFAULT '',
    read_at       TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS blocks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(blocker_id, blocked_id)
  );

  CREATE TABLE IF NOT EXISTS muted_contacts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, contact_id)
  );

  CREATE TABLE IF NOT EXISTS cleared_chats (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cleared_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, contact_id)
  );
`);

// ---- Beta 2.7 additions ----
// Same rule as Beta 2.5: only ADD. No existing table, column, or row shape
// is touched. New profile fields are nullable/defaulted columns (same safe
// pattern as bio/avatar_path/last_seen back in V1), and every new concept
// (follows, saves, reactions, pins, per-user deletion, reports) gets its
// own table rather than repurposing an existing one.

const profileCols = {
  badge: `ALTER TABLE users ADD COLUMN badge TEXT`,
  birthday: `ALTER TABLE users ADD COLUMN birthday TEXT`,
  country: `ALTER TABLE users ADD COLUMN country TEXT`,
  interests: `ALTER TABLE users ADD COLUMN interests TEXT NOT NULL DEFAULT '[]'`,
  wallpaper: `ALTER TABLE users ADD COLUMN wallpaper TEXT NOT NULL DEFAULT 'default'`,
  onboarded: `ALTER TABLE users ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0`,
  cover_path: `ALTER TABLE users ADD COLUMN cover_path TEXT`,
  privacy: `ALTER TABLE users ADD COLUMN privacy TEXT NOT NULL DEFAULT 'public'`
};
for (const [col, sql] of Object.entries(profileCols)) {
  if (!columnExists('users', col)) db.exec(sql);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS follows (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(follower_id, followee_id)
  );
  CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id);
  CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows (followee_id);

  CREATE TABLE IF NOT EXISTS saved_posts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id       INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS hidden_posts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id       INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS post_reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id       INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    reason        TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason          TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS message_reactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji         TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(message_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions (message_id);

  CREATE TABLE IF NOT EXISTS pinned_messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id    INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS message_deletions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(message_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_msg_deletions_msg ON message_deletions (message_id);
`);

module.exports = db;

// ---- Beta 2.8 additions ----
// Same additive-only rule as every prior pass: no existing table/column is
// touched. New profile fields via safe column migration, new tables for the
// upgraded comment system (replies + likes/reactions).

const beta28Cols = {
  university: `ALTER TABLE users ADD COLUMN university TEXT`,
  location_text: `ALTER TABLE users ADD COLUMN location_text TEXT`,
  tour_completed: `ALTER TABLE users ADD COLUMN tour_completed INTEGER NOT NULL DEFAULT 0`
};
for (const [col, sql] of Object.entries(beta28Cols)) {
  if (!columnExists('users', col)) db.exec(sql);
}

const postCommentsCols = {
  parent_comment_id: `ALTER TABLE post_comments ADD COLUMN parent_comment_id INTEGER`
};
for (const [col, sql] of Object.entries(postCommentsCols)) {
  if (!columnExists('post_comments', col)) db.exec(sql);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS comment_reactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id    INTEGER NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji         TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(comment_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions (comment_id);
`);
