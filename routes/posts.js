const express = require('express');
const rateLimit = require('express-rate-limit');
const queries = require('../config/queries');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const postLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const reportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

function serializePost(row, myId) {
  return {
    id: row.id,
    author: {
      id: row.author_id, username: row.username, display_name: row.display_name,
      avatar_path: row.avatar_path, badge: row.badge,
      is_following: row.author_id === myId ? null : !!queries.isFollowing.get(myId, row.author_id)
    },
    content: row.content,
    image_path: row.image_path,
    edited_at: row.edited_at,
    created_at: row.created_at,
    like_count: queries.countLikes.get(row.id).count,
    comment_count: queries.countComments.get(row.id).count,
    liked_by_me: !!queries.hasLiked.get(row.id, myId),
    saved_by_me: !!queries.isSaved.get(myId, row.id),
    is_own: row.author_id === myId
  };
}

// GET /api/posts?cursor=&limit= — excludes posts the viewer has hidden.
router.get('/', (req, res) => {
  const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 30);

  // Hidden posts are filtered client-of-the-query-side, so we over-fetch a
  // batch and take the first `limit` visible ones. The cursor always
  // advances past every row we *considered* (hidden or not) so pagination
  // never stalls or repeats, even on a hide-heavy page.
  const batchSize = limit * 2 + 5;
  const rows = queries.getFeedPage.all({ cursor: Number.isInteger(cursor) ? cursor : null, limit: batchSize });
  const hiddenIds = new Set(queries.getHiddenPostIds.all(req.userId).map((r) => r.post_id));
  const visible = rows.filter((r) => !hiddenIds.has(r.id));
  const page = visible.slice(0, limit);

  const posts = page.map((r) => serializePost(r, req.userId));
  const nextCursor = rows.length === batchSize ? rows[rows.length - 1].id : null;

  res.json({ posts, nextCursor });
});

// GET /api/posts/saved
router.get('/saved', (req, res) => {
  const rows = queries.getSavedPosts.all(req.userId);
  res.json({ posts: rows.map((r) => serializePost(r, req.userId)) });
});

// POST /api/posts { content, imagePath }
router.post('/', postLimiter, (req, res) => {
  const { content, imagePath } = req.body || {};
  const cleanContent = typeof content === 'string' ? content.trim().slice(0, 2000) : '';
  const cleanImage = typeof imagePath === 'string' && imagePath.startsWith('/uploads/') ? imagePath : null;

  if (!cleanContent && !cleanImage) {
    return res.status(400).json({ error: 'A post needs text or a photo.' });
  }

  const info = queries.createPost.run(req.userId, cleanContent, cleanImage);
  const row = queries.getPostWithAuthorById.get(info.lastInsertRowid);
  res.status(201).json({ post: serializePost(row, req.userId) });
});

// PATCH /api/posts/:id { content }
router.patch('/:id', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 2000) : '';
  if (!Number.isInteger(postId)) return res.status(400).json({ error: 'Invalid post.' });
  if (!content) return res.status(400).json({ error: 'Post text cannot be empty.' });

  const info = queries.editPost.run(content, postId, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Post not found or not yours.' });

  const row = queries.getPostWithAuthorById.get(postId);
  res.json({ post: row ? serializePost(row, req.userId) : null });
});

// DELETE /api/posts/:id
router.delete('/:id', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (!Number.isInteger(postId)) return res.status(400).json({ error: 'Invalid post.' });
  const info = queries.deletePost.run(postId, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Post not found or not yours.' });
  res.json({ ok: true });
});

// POST/DELETE /api/posts/:id/like
router.post('/:id/like', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const post = queries.getPostById.get(postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  queries.likePost.run(postId, req.userId);

  if (post.author_id !== req.userId) {
    queries.createNotification.run({ user_id: post.author_id, type: 'like', actor_id: req.userId, post_id: postId, preview: 'liked your post' });
    const io = req.app.get('io');
    if (io) io.to(`user:${post.author_id}`).emit('notification', { type: 'like' });
  }
  res.json({ like_count: queries.countLikes.get(postId).count, liked_by_me: true });
});

router.delete('/:id/like', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  queries.unlikePost.run(postId, req.userId);
  res.json({ like_count: queries.countLikes.get(postId).count, liked_by_me: false });
});

// POST/DELETE /api/posts/:id/save
router.post('/:id/save', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (!queries.getPostById.get(postId)) return res.status(404).json({ error: 'Post not found.' });
  queries.savePost.run(req.userId, postId);
  res.json({ ok: true, saved: true });
});
router.delete('/:id/save', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  queries.unsavePost.run(req.userId, postId);
  res.json({ ok: true, saved: false });
});

// POST /api/posts/:id/hide — removes it from MY feed only
router.post('/:id/hide', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (!queries.getPostById.get(postId)) return res.status(404).json({ error: 'Post not found.' });
  queries.hidePost.run(req.userId, postId);
  res.json({ ok: true });
});

// POST /api/posts/:id/report { reason }
router.post('/:id/report', reportLimiter, (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
  if (!queries.getPostById.get(postId)) return res.status(404).json({ error: 'Post not found.' });
  queries.reportPost.run(req.userId, postId, reason);
  res.json({ ok: true });
});

// GET /api/posts/:id/comments
router.get('/:id/comments', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const comments = queries.getComments.all(postId);
  res.json({ comments });
});

// POST /api/posts/:id/comments { content }
router.post('/:id/comments', postLimiter, (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 500) : '';
  if (!content) return res.status(400).json({ error: 'Comment cannot be empty.' });

  const post = queries.getPostById.get(postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  queries.addComment.run(postId, req.userId, content);

  if (post.author_id !== req.userId) {
    queries.createNotification.run({ user_id: post.author_id, type: 'comment', actor_id: req.userId, post_id: postId, preview: content.slice(0, 80) });
    const io = req.app.get('io');
    if (io) io.to(`user:${post.author_id}`).emit('notification', { type: 'comment' });
  }

  res.status(201).json({ comments: queries.getComments.all(postId), comment_count: queries.countComments.get(postId).count });
});

module.exports = router;
