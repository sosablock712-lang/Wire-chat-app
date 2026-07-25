const db = require('./db');

module.exports = {
  // ---- Users ----
  createUser: db.prepare(`
    INSERT INTO users (username, display_name, password_hash)
    VALUES (@username, @display_name, @password_hash)
  `),
  getUserByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
  getUserById: db.prepare(`
    SELECT id, username, display_name, bio, avatar_path, last_seen, created_at
    FROM users WHERE id = ?
  `),
  getUserByIdRaw: db.prepare(`SELECT * FROM users WHERE id = ?`),
  searchUsersByUsername: db.prepare(`
    SELECT id, username, display_name, avatar_path
    FROM users
    WHERE username LIKE ? AND id != ?
    ORDER BY username ASC
    LIMIT 15
  `),
  listAllUsersExceptSelf: db.prepare(`
    SELECT id, username, display_name, bio, avatar_path, created_at
    FROM users
    WHERE id != ?
    ORDER BY created_at DESC
  `),
  updateProfile: db.prepare(`
    UPDATE users SET display_name = @display_name, bio = @bio WHERE id = @id
  `),
  updateAvatar: db.prepare(`UPDATE users SET avatar_path = ? WHERE id = ?`),
  touchLastSeen: db.prepare(`UPDATE users SET last_seen = datetime('now') WHERE id = ?`),

  // ---- Contacts (request/accept model) ----
  findContactRow: db.prepare(`
    SELECT * FROM contacts
    WHERE (requester_id = @a AND addressee_id = @b)
       OR (requester_id = @b AND addressee_id = @a)
  `),
  getContactRowById: db.prepare(`SELECT * FROM contacts WHERE id = ?`),
  createContactRequest: db.prepare(`
    INSERT INTO contacts (requester_id, addressee_id, status)
    VALUES (?, ?, 'pending')
  `),
  acceptContactRequest: db.prepare(`
    UPDATE contacts SET status = 'accepted', updated_at = datetime('now')
    WHERE id = ? AND addressee_id = ? AND status = 'pending'
  `),
  declineOrCancelRequest: db.prepare(`
    DELETE FROM contacts WHERE id = ? AND (addressee_id = ? OR requester_id = ?)
  `),
  removeContact: db.prepare(`
    DELETE FROM contacts
    WHERE status = 'accepted'
      AND ((requester_id = @a AND addressee_id = @b) OR (requester_id = @b AND addressee_id = @a))
  `),
  getAcceptedContacts: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_path, u.last_seen
    FROM contacts c
    JOIN users u ON u.id = (CASE WHEN c.requester_id = ? THEN c.addressee_id ELSE c.requester_id END)
    WHERE c.status = 'accepted' AND (c.requester_id = ? OR c.addressee_id = ?)
    ORDER BY u.display_name COLLATE NOCASE ASC
  `),
  getIncomingRequests: db.prepare(`
    SELECT c.id as request_id, u.id, u.username, u.display_name, u.avatar_path, c.created_at
    FROM contacts c
    JOIN users u ON u.id = c.requester_id
    WHERE c.addressee_id = ? AND c.status = 'pending'
    ORDER BY c.created_at DESC
  `),
  getOutgoingRequests: db.prepare(`
    SELECT c.id as request_id, u.id, u.username, u.display_name, u.avatar_path, c.created_at
    FROM contacts c
    JOIN users u ON u.id = c.addressee_id
    WHERE c.requester_id = ? AND c.status = 'pending'
    ORDER BY c.created_at DESC
  `),
  isAcceptedContact: db.prepare(`
    SELECT 1 FROM contacts
    WHERE status = 'accepted'
      AND ((requester_id = @a AND addressee_id = @b) OR (requester_id = @b AND addressee_id = @a))
  `),

  // ---- Messages ----
  insertMessage: db.prepare(`
    INSERT INTO messages
      (sender_id, receiver_id, content, type, attachment_path, attachment_name, attachment_mime, attachment_size, reply_to_id)
    VALUES
      (@sender_id, @receiver_id, @content, @type, @attachment_path, @attachment_name, @attachment_mime, @attachment_size, @reply_to_id)
  `),
  getMessageById: db.prepare(`SELECT * FROM messages WHERE id = ?`),
  getConversation: db.prepare(`
    SELECT * FROM messages
    WHERE (sender_id = @a AND receiver_id = @b) OR (sender_id = @b AND receiver_id = @a)
    ORDER BY created_at ASC, id ASC
    LIMIT @limit OFFSET @offset
  `),
  searchConversation: db.prepare(`
    SELECT * FROM messages
    WHERE ((sender_id = @a AND receiver_id = @b) OR (sender_id = @b AND receiver_id = @a))
      AND deleted_at IS NULL
      AND content LIKE @term
    ORDER BY created_at DESC
    LIMIT 50
  `),
  markDelivered: db.prepare(`
    UPDATE messages SET delivered_at = datetime('now')
    WHERE receiver_id = ? AND delivered_at IS NULL
  `),
  getUndeliveredForRecipient: db.prepare(`
    SELECT id, sender_id FROM messages WHERE receiver_id = ? AND delivered_at IS NULL
  `),
  markRead: db.prepare(`
    UPDATE messages SET read_at = datetime('now'), delivered_at = COALESCE(delivered_at, datetime('now'))
    WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL
  `),
  getUnreadMessageIds: db.prepare(`
    SELECT id FROM messages WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL
  `),
  editMessage: db.prepare(`
    UPDATE messages SET content = ?, edited_at = datetime('now')
    WHERE id = ? AND sender_id = ? AND deleted_at IS NULL AND type = 'text'
  `),
  deleteMessage: db.prepare(`
    UPDATE messages
    SET deleted_at = datetime('now'), content = '', attachment_path = NULL,
        attachment_name = NULL, attachment_mime = NULL, attachment_size = NULL
    WHERE id = ? AND sender_id = ?
  `),
  getLastMessageForPair: db.prepare(`
    SELECT content, type, created_at, sender_id, deleted_at
    FROM messages
    WHERE (sender_id = @a AND receiver_id = @b) OR (sender_id = @b AND receiver_id = @a)
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `),
  getUnreadCount: db.prepare(`
    SELECT COUNT(*) as count FROM messages
    WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL AND deleted_at IS NULL
  `)
};
