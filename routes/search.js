const express = require('express');
const queries = require('../config/queries');
const { requireAuth } = require('../middleware/auth');
const { isOnline } = require('../config/presence');

const router = express.Router();
router.use(requireAuth);

function relationshipStatus(myId, otherId) {
  const row = queries.findContactRow.get({ a: myId, b: otherId });
  if (!row) return 'none';
  if (row.status === 'accepted') return 'accepted';
  if (row.requester_id === myId) return 'pending_sent';
  return 'pending_received';
}

// GET /api/search?q=term  — universal search across people, posts, #hashtags, @mentions
router.get('/', (req, res) => {
  const raw = (req.query.q || '').toString().trim();
  if (raw.length < 1) return res.json({ people: [], posts: [] });

  // @mention or plain query both search usernames; #hashtag searches post content
  const isHashtag = raw.startsWith('#');
  const isMention = raw.startsWith('@');
  const term = isHashtag || isMention ? raw.slice(1) : raw;

  let people = [];
  if (!isHashtag && term.length >= 1) {
    people = queries.searchUsersByUsername.all({ term: `%${term.toLowerCase()}%`, myId: req.userId })
      .filter((u) => !queries.isBlocked.get({ a: req.userId, b: u.id }))
      .map((u) => ({ ...u, online: isOnline(u.id), relationship: relationshipStatus(req.userId, u.id) }));
  }

  let posts = [];
  if (!isMention && term.length >= 1) {
    const likeTerm = isHashtag ? `%#${term}%` : `%${term}%`;
    posts = queries.searchPosts.all(likeTerm).map((p) => ({
      id: p.id,
      author: { id: p.author_id, username: p.username, display_name: p.display_name, avatar_path: p.avatar_path, badge: p.badge },
      content: p.content,
      image_path: p.image_path,
      created_at: p.created_at,
      like_count: queries.countLikes.get(p.id).count,
      comment_count: queries.countComments.get(p.id).count
    }));
  }

  res.json({ people, posts });
});

module.exports = router;
