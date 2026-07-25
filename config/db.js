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

module.exports = db;
