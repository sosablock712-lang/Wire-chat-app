const db = require('./db');

module.exports = {
  // ---- Users ----
  createUser: db.prepare(`
    INSERT INTO users (username, display_name, password_hash)
    VALUES (@username, @display_name, @password_hash)
  `),
  getUserByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
  getUserById: db.prepare(`
    SELECT id, username, display_name, bio, avatar_path, cover_path, badge, birthday, country,
           interests, wallpaper, onboarded, privacy, university, location_text, tour_completed,
           last_seen, created_at
    FROM users WHERE id = ?
  `),
  getUserByIdRaw: db.prepare(`SELECT * FROM users WHERE id = ?`),
  searchUsersByUsername: db.prepare(`
    SELECT id, username, display_name, avatar_path, badge
    FROM users
    WHERE (username LIKE @term OR display_name LIKE @term) AND id != @myId
    ORDER BY username ASC
    LIMIT 15
  `),
  updateProfileExtra: db.prepare(`
    UPDATE users SET university = @university, location_text = @location_text WHERE id = @id
  `),
  markTourCompleted: db.prepare(`UPDATE users SET tour_completed = 1 WHERE id = ?`),
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
  countFriends: db.prepare(`
    SELECT COUNT(*) as count FROM contacts
    WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
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
    SELECT m.* FROM messages m
    WHERE ((m.sender_id = @a AND m.receiver_id = @b) OR (m.sender_id = @b AND m.receiver_id = @a))
      AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = @a)
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT @limit OFFSET @offset
  `),
  searchConversation: db.prepare(`
    SELECT m.* FROM messages m
    WHERE ((m.sender_id = @a AND m.receiver_id = @b) OR (m.sender_id = @b AND m.receiver_id = @a))
      AND m.deleted_at IS NULL
      AND m.content LIKE @term
      AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = @a)
    ORDER BY m.created_at DESC
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
  `),
  getSharedMedia: db.prepare(`
    SELECT id, sender_id, type, attachment_path, attachment_name, attachment_size, created_at
    FROM messages m
    WHERE ((sender_id = @a AND receiver_id = @b) OR (sender_id = @b AND receiver_id = @a))
      AND deleted_at IS NULL AND type IN ('image', 'file')
      AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = @a)
    ORDER BY created_at DESC
    LIMIT 100
  `),
  getSharedVoiceNotes: db.prepare(`
    SELECT id, sender_id, attachment_path, attachment_size, created_at
    FROM messages m
    WHERE ((sender_id = @a AND receiver_id = @b) OR (sender_id = @b AND receiver_id = @a))
      AND deleted_at IS NULL AND type = 'voice'
      AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = @a)
    ORDER BY created_at DESC
    LIMIT 100
  `),
  getSharedLinks: db.prepare(`
    SELECT id, sender_id, content, created_at
    FROM messages m
    WHERE ((sender_id = @a AND receiver_id = @b) OR (sender_id = @b AND receiver_id = @a))
      AND deleted_at IS NULL AND type = 'text' AND (content LIKE '%http://%' OR content LIKE '%https://%')
      AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = @a)
    ORDER BY created_at DESC
    LIMIT 100
  `),

  // ---- Posts (Home feed) ----
  createPost: db.prepare(`
    INSERT INTO posts (author_id, content, image_path) VALUES (?, ?, ?)
  `),
  getPostById: db.prepare(`SELECT * FROM posts WHERE id = ?`),
  getPostWithAuthorById: db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar_path
    FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.id = ?
  `),
  getFeedPage: db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar_path
    FROM posts p JOIN users u ON u.id = p.author_id
    WHERE (@cursor IS NULL OR p.id < @cursor)
    ORDER BY p.id DESC
    LIMIT @limit
  `),
  editPost: db.prepare(`
    UPDATE posts SET content = ?, edited_at = datetime('now') WHERE id = ? AND author_id = ?
  `),
  deletePost: db.prepare(`DELETE FROM posts WHERE id = ? AND author_id = ?`),
  countPostsByAuthor: db.prepare(`SELECT COUNT(*) as count FROM posts WHERE author_id = ?`),

  likePost: db.prepare(`INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)`),
  unlikePost: db.prepare(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`),
  countLikes: db.prepare(`SELECT COUNT(*) as count FROM post_likes WHERE post_id = ?`),
  hasLiked: db.prepare(`SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`),

  addComment: db.prepare(`
    INSERT INTO post_comments (post_id, author_id, content, parent_comment_id) VALUES (?, ?, ?, ?)
  `),
  getCommentById: db.prepare(`SELECT * FROM post_comments WHERE id = ?`),
  getComments: db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar_path, u.badge,
           p.author_id as parent_author_id, pu.display_name as parent_author_name
    FROM post_comments c
    JOIN users u ON u.id = c.author_id
    LEFT JOIN post_comments p ON p.id = c.parent_comment_id
    LEFT JOIN users pu ON pu.id = p.author_id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `),
  countComments: db.prepare(`SELECT COUNT(*) as count FROM post_comments WHERE post_id = ?`),
  countReplies: db.prepare(`SELECT COUNT(*) as count FROM post_comments WHERE parent_comment_id = ?`),

  setCommentReaction: db.prepare(`
    INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES (?, ?, ?)
    ON CONFLICT(comment_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = datetime('now')
  `),
  removeCommentReaction: db.prepare(`DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ?`),
  getReactionsForPost: db.prepare(`
    SELECT r.comment_id, r.user_id, r.emoji
    FROM comment_reactions r
    JOIN post_comments c ON c.id = r.comment_id
    WHERE c.post_id = ?
  `),

  // ---- Notifications ----
  createNotification: db.prepare(`
    INSERT INTO notifications (user_id, type, actor_id, post_id, preview)
    VALUES (@user_id, @type, @actor_id, @post_id, @preview)
  `),
  getNotifications: db.prepare(`
    SELECT n.*, u.username as actor_username, u.display_name as actor_display_name, u.avatar_path as actor_avatar_path
    FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 50
  `),
  getUnreadNotificationCount: db.prepare(`
    SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL
  `),
  markAllNotificationsRead: db.prepare(`
    UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL
  `),

  // ---- Block / Mute / Clear ----
  createBlock: db.prepare(`INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)`),
  removeBlock: db.prepare(`DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?`),
  isBlocked: db.prepare(`
    SELECT 1 FROM blocks WHERE (blocker_id = @a AND blocked_id = @b) OR (blocker_id = @b AND blocked_id = @a)
  `),
  hasBlocked: db.prepare(`SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?`),

  toggleMuteOn: db.prepare(`INSERT OR IGNORE INTO muted_contacts (user_id, contact_id) VALUES (?, ?)`),
  toggleMuteOff: db.prepare(`DELETE FROM muted_contacts WHERE user_id = ? AND contact_id = ?`),
  getMutedContactIds: db.prepare(`SELECT contact_id FROM muted_contacts WHERE user_id = ?`),
  isMuted: db.prepare(`SELECT 1 FROM muted_contacts WHERE user_id = ? AND contact_id = ?`),

  clearChat: db.prepare(`
    INSERT INTO cleared_chats (user_id, contact_id, cleared_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id, contact_id) DO UPDATE SET cleared_at = datetime('now')
  `),
  getClearedAt: db.prepare(`
    SELECT cleared_at FROM cleared_chats WHERE user_id = ? AND contact_id = ?
  `),

  // ---- Follows ----
  followUser: db.prepare(`INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)`),
  unfollowUser: db.prepare(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`),
  isFollowing: db.prepare(`SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`),
  countFollowers: db.prepare(`SELECT COUNT(*) as count FROM follows WHERE followee_id = ?`),
  countFollowing: db.prepare(`SELECT COUNT(*) as count FROM follows WHERE follower_id = ?`),
  listFollowers: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_path, u.badge
    FROM follows f JOIN users u ON u.id = f.follower_id
    WHERE f.followee_id = ? ORDER BY f.created_at DESC LIMIT 100
  `),
  listFollowing: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_path, u.badge
    FROM follows f JOIN users u ON u.id = f.followee_id
    WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 100
  `),
  countMutualFriends: db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT CASE WHEN requester_id = @me THEN addressee_id ELSE requester_id END as friend_id
      FROM contacts WHERE status = 'accepted' AND (requester_id = @me OR addressee_id = @me)
    ) mine
    WHERE friend_id IN (
      SELECT CASE WHEN requester_id = @other THEN addressee_id ELSE requester_id END as friend_id
      FROM contacts WHERE status = 'accepted' AND (requester_id = @other OR addressee_id = @other)
    )
  `),

  // ---- Save / Hide / Report posts ----
  savePost: db.prepare(`INSERT OR IGNORE INTO saved_posts (user_id, post_id) VALUES (?, ?)`),
  unsavePost: db.prepare(`DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?`),
  isSaved: db.prepare(`SELECT 1 FROM saved_posts WHERE user_id = ? AND post_id = ?`),
  getSavedPosts: db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar_path, u.badge
    FROM saved_posts s
    JOIN posts p ON p.id = s.post_id
    JOIN users u ON u.id = p.author_id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
    LIMIT 30
  `),
  hidePost: db.prepare(`INSERT OR IGNORE INTO hidden_posts (user_id, post_id) VALUES (?, ?)`),
  getHiddenPostIds: db.prepare(`SELECT post_id FROM hidden_posts WHERE user_id = ?`),
  reportPost: db.prepare(`INSERT INTO post_reports (reporter_id, post_id, reason) VALUES (?, ?, ?)`),
  reportUser: db.prepare(`INSERT INTO user_reports (reporter_id, reported_user_id, reason) VALUES (?, ?, ?)`),

  // ---- Message reactions ----
  setReaction: db.prepare(`
    INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)
    ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = datetime('now')
  `),
  removeReaction: db.prepare(`DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?`),
  getReactionsForPair: db.prepare(`
    SELECT r.message_id, r.user_id, r.emoji
    FROM message_reactions r
    JOIN messages m ON m.id = r.message_id
    WHERE (m.sender_id = @a AND m.receiver_id = @b) OR (m.sender_id = @b AND m.receiver_id = @a)
  `),

  // ---- Pinned messages ----
  pinMessage: db.prepare(`INSERT OR IGNORE INTO pinned_messages (message_id, pinned_by) VALUES (?, ?)`),
  unpinMessage: db.prepare(`DELETE FROM pinned_messages WHERE message_id = ?`),
  getLatestPinForPair: db.prepare(`
    SELECT pm.message_id, m.content, m.type, m.sender_id
    FROM pinned_messages pm
    JOIN messages m ON m.id = pm.message_id
    WHERE (m.sender_id = @a AND m.receiver_id = @b) OR (m.sender_id = @b AND m.receiver_id = @a)
    ORDER BY pm.created_at DESC
    LIMIT 1
  `),

  // ---- Delete for me ----
  deleteMessageForMe: db.prepare(`INSERT OR IGNORE INTO message_deletions (message_id, user_id) VALUES (?, ?)`),

  // ---- Profile extensions (badge, onboarding, wallpaper, cover) ----
  updateBadge: db.prepare(`UPDATE users SET badge = ? WHERE id = ?`),
  updateWallpaper: db.prepare(`UPDATE users SET wallpaper = ? WHERE id = ?`),
  updatePrivacy: db.prepare(`UPDATE users SET privacy = ? WHERE id = ?`),
  updateCover: db.prepare(`UPDATE users SET cover_path = ? WHERE id = ?`),
  completeOnboarding: db.prepare(`
    UPDATE users SET birthday = @birthday, country = @country, interests = @interests,
                      privacy = @privacy, onboarded = 1
    WHERE id = @id
  `),

  // ---- Universal search ----
  searchPosts: db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar_path, u.badge
    FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.content LIKE ?
    ORDER BY p.created_at DESC
    LIMIT 20
  `)
};
