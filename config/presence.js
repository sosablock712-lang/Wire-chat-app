// Shared in-memory presence tracking. Used by both the Socket.io layer
// (server.js) and REST routes (e.g. sorting the Discover list by who's
// online) without those two needing to require each other.
//
// Single-instance only, by design — see README for the multi-instance note.

const onlineCounts = new Map(); // userId -> number of open sockets

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

function listOnlineIds() {
  return Array.from(onlineCounts.keys());
}

module.exports = { markOnline, markOfflineAndCheck, isOnline, listOnlineIds };
