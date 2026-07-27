// One-off validation script (not part of the app). Shims better-sqlite3's
// API on top of Node's built-in node:sqlite so we can run the real schema
// and every real prepared statement against an actual SQLite engine in this
// sandbox, which has no internet access to npm install the real dependency.
const { DatabaseSync } = require('node:sqlite');
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === 'better-sqlite3') {
    return class FakeDatabase {
      constructor() { this._db = new DatabaseSync(':memory:'); }
      pragma() {}
      exec(sql) { this._db.exec(sql); }
      prepare(sql) {
        const stmt = this._db.prepare(sql);
        const normalize = (args) =>
          args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])
            ? args[0]
            : args;
        return {
          run: (...args) => { const a = normalize(args); const info = Array.isArray(a) ? stmt.run(...a) : stmt.run(a); return { lastInsertRowid: Number(info.lastInsertRowid), changes: info.changes }; },
          get: (...args) => { const a = normalize(args); return Array.isArray(a) ? stmt.get(...a) : stmt.get(a); },
          all: (...args) => { const a = normalize(args); return Array.isArray(a) ? stmt.all(...a) : stmt.all(a); }
        };
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const db = require('../config/db.js');
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
console.log('Tables created:', tables.join(', '));

// Loading queries.js runs db.prepare() on every single statement in the file.
// If any SQL is invalid, this throws immediately with the bad statement name.
const queries = require('../config/queries.js');
console.log('All', Object.keys(queries).length, 'prepared statements compiled successfully.');

// Exercise a representative slice end-to-end to catch parameter-binding bugs
// (not just syntax errors).
queries.createUser.run({ username: 'alice', display_name: 'Alice', password_hash: 'x' });
queries.createUser.run({ username: 'bob', display_name: 'Bob', password_hash: 'x' });
const alice = queries.getUserByUsername.get('alice');
const bob = queries.getUserByUsername.get('bob');

queries.createContactRequest.run(alice.id, bob.id);
queries.acceptContactRequest.run(1, bob.id);
console.log('Contacts accepted OK:', !!queries.isAcceptedContact.get({ a: alice.id, b: bob.id }));

const msgInfo = queries.insertMessage.run({
  sender_id: alice.id, receiver_id: bob.id, content: 'hi', type: 'text',
  attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, reply_to_id: null
});
console.log('Message inserted OK, id:', msgInfo.lastInsertRowid);

const postInfo = queries.createPost.run(alice.id, 'hello world', null);
console.log('Post created OK, id:', postInfo.lastInsertRowid);
queries.likePost.run(postInfo.lastInsertRowid, bob.id);
console.log('Like count:', queries.countLikes.get(postInfo.lastInsertRowid).count);
queries.addComment.run(postInfo.lastInsertRowid, bob.id, 'nice post');
console.log('Comment count:', queries.countComments.get(postInfo.lastInsertRowid).count);
const feed = queries.getFeedPage.all({ cursor: null, limit: 10 });
console.log('Feed page rows:', feed.length, '- has username:', !!feed[0].username);

queries.createNotification.run({ user_id: alice.id, type: 'like', actor_id: bob.id, post_id: postInfo.lastInsertRowid, preview: 'Bob liked your post' });
console.log('Unread notifications for alice:', queries.getUnreadNotificationCount.get(alice.id).count);

queries.createBlock.run(alice.id, bob.id);
console.log('isBlocked after block:', !!queries.isBlocked.get({ a: alice.id, b: bob.id }));
queries.removeBlock.run(alice.id, bob.id);
console.log('isBlocked after unblock:', !!queries.isBlocked.get({ a: alice.id, b: bob.id }));

queries.toggleMuteOn.run(alice.id, bob.id);
console.log('isMuted:', !!queries.isMuted.get(alice.id, bob.id));

queries.clearChat.run(alice.id, bob.id);
queries.clearChat.run(alice.id, bob.id); // run twice to test the ON CONFLICT upsert path
console.log('clearChat upsert OK:', !!queries.getClearedAt.get(alice.id, bob.id));

// ---- Beta 2.7 ----
queries.followUser.run(alice.id, bob.id);
console.log('isFollowing:', !!queries.isFollowing.get(alice.id, bob.id));
console.log('followers of bob:', queries.countFollowers.get(bob.id).count);
console.log('following count alice:', queries.countFollowing.get(alice.id).count);
console.log('mutual friends (alice/bob):', queries.countMutualFriends.get({ me: alice.id, other: bob.id }).count);
queries.unfollowUser.run(alice.id, bob.id);
console.log('isFollowing after unfollow:', !!queries.isFollowing.get(alice.id, bob.id));

queries.savePost.run(bob.id, postInfo.lastInsertRowid);
console.log('isSaved:', !!queries.isSaved.get(bob.id, postInfo.lastInsertRowid));
console.log('saved posts for bob:', queries.getSavedPosts.all(bob.id).length);
queries.unsavePost.run(bob.id, postInfo.lastInsertRowid);

queries.hidePost.run(bob.id, postInfo.lastInsertRowid);
console.log('hidden post ids for bob:', queries.getHiddenPostIds.all(bob.id).map(r => r.post_id));

queries.reportPost.run(bob.id, postInfo.lastInsertRowid, 'spam');
queries.reportUser.run(bob.id, alice.id, 'harassment');
console.log('reports inserted OK');

queries.setReaction.run(msgInfo.lastInsertRowid, bob.id, '❤️');
queries.setReaction.run(msgInfo.lastInsertRowid, bob.id, '😂'); // change reaction, tests ON CONFLICT DO UPDATE
const reactions = queries.getReactionsForPair.all({ a: alice.id, b: bob.id });
console.log('reactions for pair:', reactions.map(r => r.emoji));
queries.removeReaction.run(msgInfo.lastInsertRowid, bob.id);
console.log('reactions after remove:', queries.getReactionsForPair.all({ a: alice.id, b: bob.id }).length);

queries.pinMessage.run(msgInfo.lastInsertRowid, alice.id);
console.log('latest pin for pair:', queries.getLatestPinForPair.get({ a: alice.id, b: bob.id })?.content);
queries.unpinMessage.run(msgInfo.lastInsertRowid);
console.log('latest pin after unpin:', queries.getLatestPinForPair.get({ a: alice.id, b: bob.id }));

queries.deleteMessageForMe.run(msgInfo.lastInsertRowid, bob.id);
const bobsView = queries.getConversation.all({ a: bob.id, b: alice.id, limit: 50, offset: 0 });
const alicesView = queries.getConversation.all({ a: alice.id, b: bob.id, limit: 50, offset: 0 });
console.log('delete-for-me: bob sees', bobsView.length, 'messages, alice still sees', alicesView.length);

queries.updateBadge.run('blue_check', alice.id);
queries.updateWallpaper.run('gradient-sunset', alice.id);
queries.updateCover.run('/uploads/cover1.jpg', alice.id);
queries.completeOnboarding.run({ id: alice.id, birthday: '2000-01-01', country: 'US', interests: '["gaming","music"]', privacy: 'public' });
const aliceFull = queries.getUserById.get(alice.id);
console.log('profile extensions OK:', aliceFull.badge, aliceFull.wallpaper, aliceFull.cover_path, aliceFull.onboarded, aliceFull.interests);

console.log('post search results:', queries.searchPosts.all('%hello%').length);

console.log('\\nALL SQL VALIDATION PASSED');
