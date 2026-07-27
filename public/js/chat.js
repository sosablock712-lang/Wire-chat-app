// ===================== Wirely Beta 2.7 client =====================
let me = null;
let socket = null;
let activeContact = null;
let contactsCache = [];
let incomingRequests = [];
let outgoingRequests = [];
let discoverCache = [];
let replyingTo = null;
let editingMessageId = null;
let unreadTotal = 0;
let mediaRecorder = null;
let recordedChunks = [];
let onlineSet = new Set();
let postImageUpload = null;
let postFeeling = null;
let postLocation = null;
let feedCursor = null;
let feedLoading = false;
let feedDone = false;
let notifUnread = 0;
let notifCache = [];
let notifCategory = 'all';
let currentLightboxImages = [];
let currentLightboxIndex = 0;
let activePostForSheet = null;
let activePostForMenu = null;
let soundEnabled = localStorage.getItem('wirely-sound') !== 'off';
let browserNotifEnabled = localStorage.getItem('wirely-browser-notif') !== 'off';
let mePosts = [];
let meSavedPosts = [];
let meActiveTab = 'posts';
let voiceAudioEls = {};

const THEMES = [
  { id: 'midnight',    label: 'Midnight',    dot: '#C1793B' },
  { id: 'ocean',       label: 'Ocean Blue',  dot: '#2AA9DE' },
  { id: 'emerald',     label: 'Emerald',     dot: '#34C77B' },
  { id: 'ruby',        label: 'Ruby Red',    dot: '#E0455A' },
  { id: 'pink',        label: 'Pink Blossom',dot: '#F06BA8' },
  { id: 'purple',      label: 'Purple Neon', dot: '#9B6BFF' },
  { id: 'amoled',      label: 'AMOLED',      dot: '#00E5C7' },
  { id: 'clean-white', label: 'Clean White', dot: '#C1793B' }
];
const WALLPAPERS = [
  { id: 'default',  label: 'Default',  dot: 'linear-gradient(135deg,#1B333C,#12232A)' },
  { id: 'sunset',   label: 'Sunset',   dot: 'linear-gradient(135deg,#C1793B,#B0463A)' },
  { id: 'ocean',    label: 'Ocean',    dot: 'linear-gradient(135deg,#2AA9DE,#0F2B40)' },
  { id: 'forest',   label: 'Forest',   dot: 'linear-gradient(135deg,#34C77B,#0E3527)' },
  { id: 'midnight', label: 'Midnight', dot: 'linear-gradient(135deg,#160B2E,#3A2261)' },
  { id: 'solid',    label: 'Solid',    dot: '#12232A' }
];
const BADGES = [
  { id: 'blue_check',    label: 'Verified',  icon: 'star' },
  { id: 'gold_lightning', label: 'Premium',   icon: 'star' },
  { id: 'red_check',     label: 'Creator',   icon: 'star' }
];
const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '👎'];
const INTERESTS_LIST = ['Gaming', 'Music', 'Movies', 'Sports', 'Tech', 'Art', 'Travel', 'Food', 'Fashion', 'Books', 'Fitness', 'Photography'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function initials(name) { return (name || '?').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase(); }

function avatarInner(user) {
  if (user && user.avatar_path) return { style: `background-image:url('${escapeHtml(user.avatar_path)}')`, html: '' };
  return { style: '', html: `<span>${escapeHtml(initials(user ? user.display_name : ''))}</span>` };
}
function renderAvatar(user, extraClass = '') {
  const a = avatarInner(user);
  return `<div class="avatar ${extraClass}" style="${a.style}">${a.html}</div>`;
}
function badgeHtml(badge) {
  if (!badge) return '';
  return `<span class="badge-chip ${badge}">${icon('star')}</span>`;
}

function toDate(iso) { return new Date(iso.endsWith('Z') ? iso : iso + 'Z'); }
function formatTime(iso) { return toDate(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function formatPreviewTime(iso) {
  const d = toDate(iso); const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function formatRelativeTime(iso) {
  const diffMs = Date.now() - toDate(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return toDate(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function formatDateHeading(iso) {
  const d = toDate(iso); const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}
function fileSizeLabel(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function playNotifySound() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.35);
  } catch (_) {}
}
function vibrate(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} } }

function updateTitleBadge() {
  const total = unreadTotal + notifUnread;
  document.title = total > 0 ? `(${total > 99 ? '99+' : total}) Wirely` : 'Wirely';
}
function notifyIncoming(contact, content) {
  if (document.visibilityState === 'visible' && activeContact) return;
  if (contact && contact.muted) return;
  playNotifySound();
  if (browserNotifEnabled && window.Notification && Notification.permission === 'granted') {
    try { new Notification(contact ? contact.display_name : 'New message', { body: content, tag: 'wirely-message' }); } catch (_) {}
  }
}
function debounce(fn, ms) { let t = null; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

function closeAllPopovers(exceptEl) {
  $$('.more-menu.visible, .emoji-picker.visible, .attach-menu.visible, .reaction-picker.visible, .long-press-menu.visible').forEach((el) => {
    if (el !== exceptEl) el.classList.remove('visible');
  });
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.more-menu, [data-opens-menu], .emoji-picker, #emojiBtn, .attach-menu, #attachBtn, .reaction-picker, .long-press-menu')) {
    closeAllPopovers();
  }
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('.btn-primary, .fab, .send-btn, .icon-btn, .person-action, .search-result-action, .theme-swatch, .composer-post-btn, .post-follow-btn, .bn-btn');
  if (!el) return;
  el.classList.add('rippling');
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  el.appendChild(ripple);
  setTimeout(() => ripple.remove(), 500);
});

function skeletonRows(count) {
  return Array.from({ length: count }).map(() => `
    <div class="skeleton-row"><div class="skeleton-circle"></div>
      <div class="skeleton-meta"><div class="skeleton-line w60"></div><div class="skeleton-line w35"></div></div>
    </div>`).join('');
}
function skeletonPosts(count) {
  return Array.from({ length: count }).map(() => `
    <div class="post-card-v27"><div class="skeleton-row" style="padding:0;"><div class="skeleton-circle"></div>
      <div class="skeleton-meta"><div class="skeleton-line w35"></div><div class="skeleton-line w60" style="height:8px;"></div></div></div>
      <div class="skeleton-line w60" style="height:14px;margin-top:14px;"></div></div>`).join('');
}

// ---------- Theme / Wallpaper / Badge pickers ----------

function initTheme() {
  const saved = localStorage.getItem('wirely-theme') || 'midnight';
  document.documentElement.setAttribute('data-theme', saved);
}
function buildThemeGrid() {
  const grid = $('#themeGrid');
  if (!grid) return;
  const current = document.documentElement.getAttribute('data-theme');
  grid.innerHTML = THEMES.map(t => `
    <button type="button" class="theme-swatch ${t.id === current ? 'active' : ''}" data-theme-id="${t.id}">
      <span class="theme-swatch-dot" style="background:${t.dot}"></span><span>${escapeHtml(t.label)}</span>
    </button>`).join('');
  grid.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.documentElement.setAttribute('data-theme', btn.dataset.themeId);
      localStorage.setItem('wirely-theme', btn.dataset.themeId);
      grid.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}
function buildWallpaperGrid() {
  const grid = $('#wallpaperGrid');
  if (!grid) return;
  const current = (me && me.wallpaper) || 'default';
  grid.innerHTML = WALLPAPERS.map(w => `
    <button type="button" class="theme-swatch ${w.id === current ? 'active' : ''}" data-wallpaper-id="${w.id}">
      <span class="theme-swatch-dot" style="background:${w.dot}"></span><span>${escapeHtml(w.label)}</span>
    </button>`).join('');
  grid.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { user } = await api.patch('/api/users/me/wallpaper', { wallpaper: btn.dataset.wallpaperId });
        me = user;
        grid.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyWallpaper();
      } catch (err) { alert(err.message); }
    });
  });
}
function buildBadgeGrid() {
  const grid = $('#badgeGrid');
  if (!grid) return;
  const current = me ? me.badge : null;
  let html = `<button type="button" class="theme-swatch ${!current ? 'active' : ''}" data-badge-id="">
      <span class="theme-swatch-dot" style="background:#556"></span><span>None</span></button>`;
  html += BADGES.map(b => `
    <button type="button" class="theme-swatch ${b.id === current ? 'active' : ''}" data-badge-id="${b.id}">
      <span class="theme-swatch-dot badge-chip ${b.id}" style="display:flex;align-items:center;justify-content:center;background:var(--ink);">${icon('star')}</span>
      <span>${escapeHtml(b.label)}</span>
    </button>`).join('');
  grid.innerHTML = html;
  grid.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { user } = await api.patch('/api/users/me/badge', { badge: btn.dataset.badgeId || null });
        me = user;
        grid.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderMyAvatar();
      } catch (err) { alert(err.message); }
    });
  });
}
function applyWallpaper() {
  const el = document.querySelector('#conversation .messages');
  if (!el || !me) return;
  const wp = WALLPAPERS.find(w => w.id === me.wallpaper) || WALLPAPERS[0];
  el.classList.add('chat-wallpaper-bg');
  el.style.backgroundImage = me.wallpaper === 'solid' ? 'none' : wp.dot.startsWith('linear') ? wp.dot : '';
  el.style.background = wp.dot.startsWith('linear') ? wp.dot : (wp.dot.startsWith('#') ? wp.dot : '');
}

// ---------- Bottom nav ----------

const NAV_ICONS = { home: 'home', chats: 'chat', people: 'users', notifications: 'bell', me: 'profile' };

function setupBottomNav() {
  $$('.bn-btn[data-view]').forEach((btn) => {
    const view = btn.dataset.view;
    const label = btn.textContent.replace(/\s+/g, ' ').trim();
    const badgeEl = btn.querySelector('.bn-badge, .rail-badge');
    if (view === 'me') {
      btn.innerHTML = `<div class="avatar bn-avatar" id="bnAvatar"><span></span></div><span>${label}</span>`;
    } else {
      btn.innerHTML = `${icon(NAV_ICONS[view])}<span>${label}</span>` + (badgeEl ? badgeEl.outerHTML : '');
    }
    btn.addEventListener('click', () => switchView(view));
  });
}

function switchView(view) {
  $$('.bn-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.v27-view').forEach(p => p.classList.toggle('active', p.dataset.view === view));
  if (view === 'people') loadPeopleView();
  if (view === 'notifications') loadNotifications();
  if (view === 'me') loadMeView();
}

function updateNavBadges() {
  const chatsBadge = $('#bnChatsBadge'); if (chatsBadge) chatsBadge.hidden = unreadTotal === 0; if (chatsBadge) chatsBadge.textContent = unreadTotal > 9 ? '9+' : unreadTotal;
  const peopleBadge = $('#bnPeopleBadge'); if (peopleBadge) peopleBadge.hidden = incomingRequests.length === 0; if (peopleBadge) peopleBadge.textContent = incomingRequests.length;
  const notifBadge = $('#bnNotifBadge'); if (notifBadge) notifBadge.hidden = notifUnread === 0; if (notifBadge) notifBadge.textContent = notifUnread > 9 ? '9+' : notifUnread;
  updateTitleBadge();
}

// ---------- Bootstrap ----------

async function bootstrap() {
  try {
    const { user } = await api.get('/api/auth/me');
    me = user;
  } catch (err) {
    window.location.href = '/index.html';
    return;
  }

  initTheme();
  setupBottomNav();
  renderMyAvatar();
  $('#contactList').innerHTML = skeletonRows(5);
  $('#feedListV27').innerHTML = skeletonPosts(3);
  connectSocket();

  setupTabs();
  setupNewChatModal();
  setupProfileModal();
  setupSettingsModal();
  setupForwardModal();
  setupProfileViewModal();
  setupSharedMediaModal();
  setupReportModal();
  setupChatSearch();
  setupDiscover();
  setupFeed();
  setupNotifications();
  setupMeView();
  setupSearchOverlay();
  setupLightbox();
  setupCommentsSheet();
  setupPostMenuSheet();

  await Promise.all([loadContacts(), loadRequests(), loadFeed(true)]);

  if (!me.onboarded) {
    startOnboarding();
  } else if (window.Notification && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission(), { once: true });
  }
}

function renderMyAvatar() {
  const a = avatarInner(me);
  ['#homeProfileShortcut', '#feedComposerAvatar', '#bnAvatar', '#commentComposerAvatar'].forEach((sel) => {
    const el = $(sel);
    if (el) { el.style = a.style; el.innerHTML = a.html; }
  });
}

function previewFor(message) {
  if (message.deleted_at) return 'This message was deleted';
  if (message.type === 'image') return 'Photo';
  if (message.type === 'video') return 'Video';
  if (message.type === 'voice') return 'Voice message';
  if (message.type === 'file') return 'File';
  return message.content;
}

function connectSocket() {
  socket = io({ withCredentials: true });
  socket.on('connect_error', (err) => { if (err && err.message === 'unauthorized') window.location.href = '/index.html'; });

  socket.on('online_snapshot', ({ userIds }) => {
    onlineSet = new Set(userIds);
    renderContacts($('#chatSearchInput').value.trim().toLowerCase());
  });

  socket.on('user_registered', (user) => {
    if (discoverCache.some(u => u.id === user.id)) return;
    discoverCache.unshift({ ...user, online: false, relationship: 'none' });
  });

  socket.on('contact_request_received', async () => { await loadRequests(); });
  socket.on('contact_request_accepted', async () => { await Promise.all([loadRequests(), loadContacts()]); });

  socket.on('notification', async () => {
    notifUnread += 1;
    updateNavBadges();
    if (document.querySelector('.v27-view[data-view="notifications"]').classList.contains('active')) loadNotifications();
  });

  socket.on('new_message', (message) => {
    const otherId = message.sender_id === me.id ? message.receiver_id : message.sender_id;
    const c = contactsCache.find(x => x.id === otherId);

    if (activeContact && activeContact.id === otherId) {
      appendMessage(message);
      scrollMessagesToBottom();
      socket.emit('mark_read', { contactId: otherId });
    } else if (message.sender_id !== me.id) {
      bumpUnread(otherId);
      notifyIncoming(c, previewFor(message));
    }
    if (c) updateContactPreview(otherId, previewFor(message), message.created_at);
    else loadContacts();
  });

  socket.on('message_edited', (message) => {
    const el = document.querySelector(`.msg-row[data-id="${message.id}"] .bubble-content`);
    if (el) el.textContent = message.content;
    const editedTag = document.querySelector(`.msg-row[data-id="${message.id}"] .bubble-edited`);
    if (editedTag) editedTag.hidden = false;
  });

  socket.on('message_deleted', ({ id }) => {
    const row = document.querySelector(`.msg-row[data-id="${id}"]`);
    if (row) {
      const bubble = row.querySelector('.bubble');
      bubble.classList.add('deleted');
      bubble.innerHTML = '<span class="bubble-content">This message was deleted</span>';
      const actions = row.querySelector('.msg-actions');
      if (actions) actions.remove();
    }
  });

  socket.on('messages_delivered', ({ ids }) => {
    ids.forEach((id) => { const t = document.querySelector(`.msg-row[data-id="${id}"] .ticks`); if (t) t.innerHTML = icon('checkCheck'); });
  });
  socket.on('messages_read', ({ ids }) => {
    ids.forEach((id) => { const t = document.querySelector(`.msg-row[data-id="${id}"] .ticks`); if (t) { t.innerHTML = icon('checkCheck'); t.classList.add('read'); } });
  });

  socket.on('reaction_updated', ({ messageId, userId, emoji }) => {
    upsertReactionInDom(messageId, userId, emoji);
  });
  socket.on('reaction_removed', ({ messageId, userId }) => {
    removeReactionInDom(messageId, userId);
  });
  socket.on('message_pinned', (pin) => {
    showPinnedBar(pin);
  });
  socket.on('message_unpinned', () => {
    $('#pinnedBar')?.classList.remove('visible');
  });

  socket.on('presence', ({ userId, online, lastSeen }) => {
    if (online) onlineSet.add(userId); else onlineSet.delete(userId);
    const dot = document.querySelector(`.contact-item[data-id="${userId}"] .presence-dot`);
    if (dot) dot.classList.toggle('online', online);
    const personDot = document.querySelector(`.person-card[data-id="${userId}"] .presence-dot`);
    if (personDot) personDot.classList.toggle('online', online);
    if (activeContact && activeContact.id === userId) {
      const statusEl = $('#convStatus');
      if (statusEl) {
        statusEl.classList.toggle('online', online);
        statusEl.innerHTML = online ? `<span class="dot"></span> Online` : `<span class="dot"></span> ${lastSeen ? 'Last seen ' + formatPreviewTime(lastSeen) : '@' + escapeHtml(activeContact.username)}`;
      }
    }
  });

  socket.on('typing', ({ fromUserId }) => {
    if (activeContact && activeContact.id === fromUserId) {
      const indicator = $('#typingIndicator');
      if (indicator) indicator.innerHTML = `<span class="typing-signature"><span class="typing-word">Typing<span class="bolt">${BOLT_SVG}</span>...</span></span>`;
    }
  });
  socket.on('stop_typing', ({ fromUserId }) => {
    if (activeContact && activeContact.id === fromUserId) { const indicator = $('#typingIndicator'); if (indicator) indicator.innerHTML = ''; }
  });
}

const BOLT_SVG = '<svg viewBox="0 0 100 100" fill="currentColor"><path d="M58 4 L18 54 L46 54 L40 96 L84 40 L54 40 Z"/></svg>';

// ---------- Contacts / Chat list ----------

async function loadContacts() {
  const { contacts } = await api.get('/api/users/contacts');
  contactsCache = contacts;
  renderContacts();
}

function renderContacts(filter = '') {
  const list = contactsCache.slice()
    .filter(c => !filter || c.display_name.toLowerCase().includes(filter) || c.username.toLowerCase().includes(filter))
    .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));

  unreadTotal = contactsCache.reduce((sum, c) => sum + (c.unread || 0), 0);
  updateNavBadges();

  const contactListEl = $('#contactList');
  if (!list.length) {
    contactListEl.innerHTML = `<div class="empty-contacts">${filter ? 'No chats match your search.' : 'No chats yet.<br>Find someone in People to start a conversation.'}</div>`;
    return;
  }
  contactListEl.innerHTML = '';
  list.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'contact-item' + (activeContact && activeContact.id === c.id ? ' active' : '');
    item.dataset.id = c.id;
    item.innerHTML = `
      ${renderAvatar(c)}
      <div class="contact-meta">
        <div class="contact-name-row">
          <div class="contact-name">${escapeHtml(c.display_name)}${badgeHtml(c.badge)}${c.muted ? ' 🔇' : ''}</div>
          <div class="contact-time">${c.lastMessageAt ? formatPreviewTime(c.lastMessageAt) : ''}</div>
        </div>
        <div class="contact-preview-row">
          <div class="contact-preview">${escapeHtml(c.lastMessage || 'Say hello \u2014 no messages yet')}</div>
          ${c.unread ? `<div class="unread-badge">${c.unread > 9 ? '9+' : c.unread}</div>` : ''}
        </div>
      </div>`;
    const avatarEl = item.querySelector('.avatar');
    const dotEl = document.createElement('span');
    dotEl.className = 'presence-dot' + (onlineSet.has(c.id) ? ' online' : '');
    avatarEl.appendChild(dotEl);
    item.addEventListener('click', () => openConversation(c));
    contactListEl.appendChild(item);
  });
}

function bumpUnread(contactId) {
  const c = contactsCache.find(x => x.id === contactId);
  if (c) c.unread = (c.unread || 0) + 1;
  renderContacts();
}
function updateContactPreview(contactId, content, createdAt) {
  const c = contactsCache.find(x => x.id === contactId);
  if (c) { c.lastMessage = content; c.lastMessageAt = createdAt; }
  renderContacts($('#chatSearchInput').value.trim().toLowerCase());
}
function setupChatSearch() {
  $('#chatSearchInput').addEventListener('input', (e) => renderContacts(e.target.value.trim().toLowerCase()));
}

// ---------- Contact requests ----------

async function loadRequests() {
  const { incoming, outgoing } = await api.get('/api/users/contacts/requests');
  incomingRequests = incoming; outgoingRequests = outgoing;
  updateNavBadges();
  renderRequests();
}

function renderRequests() {
  const requestsListEl = $('#requestsList');
  if (!requestsListEl) return;
  if (!incomingRequests.length && !outgoingRequests.length) {
    requestsListEl.innerHTML = `<div class="empty-state"><h3>No requests</h3><p>Friend requests you send or receive will show up here.</p></div>`;
    return;
  }
  requestsListEl.innerHTML = '';
  incomingRequests.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'person-card';
    row.innerHTML = `${renderAvatar(r)}<div class="person-meta"><div class="person-name">${escapeHtml(r.display_name)}${badgeHtml(r.badge)}</div><div class="request-tag">@${escapeHtml(r.username)} wants to connect</div></div>
      <div class="request-actions"><button class="btn-accept" data-id="${r.request_id}">Accept</button><button class="btn-decline" data-id="${r.request_id}">Decline</button></div>`;
    row.querySelector('.btn-accept').addEventListener('click', () => respondToRequest(r.request_id, 'accept'));
    row.querySelector('.btn-decline').addEventListener('click', () => respondToRequest(r.request_id, 'decline'));
    requestsListEl.appendChild(row);
  });
  outgoingRequests.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'person-card';
    row.innerHTML = `${renderAvatar(r)}<div class="person-meta"><div class="person-name">${escapeHtml(r.display_name)}</div><div class="request-tag">Request sent \u2014 waiting</div></div>`;
    requestsListEl.appendChild(row);
  });
}
async function respondToRequest(requestId, action) {
  try {
    await api.post(`/api/users/contacts/requests/${requestId}/${action}`);
    await Promise.all([loadRequests(), loadContacts()]);
  } catch (err) { alert(err.message); }
}

// ---------- People screen ----------

function setupTabs() {
  $$('.people-subtab[data-subtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.people-subtab[data-subtab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sub = btn.dataset.subtab;
      $('#discoverPanel').hidden = sub !== 'suggested';
      $('#requestsList').hidden = sub !== 'requests';
      $('#onlinePeopleList').hidden = sub !== 'online';
      if (sub === 'online') renderOnlinePeople();
    });
  });
}

function loadPeopleView() {
  if (!discoverCache.length) loadDiscover();
}

function setupDiscover() {
  $('#peopleSearchInput').addEventListener('input', debounce(() => loadDiscover(), 300));
}

async function loadDiscover() {
  const q = $('#peopleSearchInput').value.trim();
  const discoverListEl = $('#discoverList');
  discoverListEl.innerHTML = skeletonRows(4);
  try {
    const { users } = await api.get(`/api/users/discover?sort=recent&q=${encodeURIComponent(q)}`);
    discoverCache = users;
    renderDiscover();
  } catch (err) { discoverListEl.innerHTML = `<div class="no-results">${escapeHtml(err.message)}</div>`; }
}

function renderDiscover() {
  const discoverListEl = $('#discoverList');
  if (!discoverCache.length) {
    discoverListEl.innerHTML = `<div class="empty-state"><h3>No one to show yet</h3><p>Check back soon, or invite friends to join Wirely.</p></div>`;
    return;
  }
  discoverListEl.innerHTML = '<div class="people-section-title">Suggested for you</div>';
  discoverCache.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'person-card';
    row.dataset.id = u.id;
    let actionHtml = '';
    if (u.relationship === 'accepted') actionHtml = `<button class="person-action action-message">Message</button>`;
    else if (u.relationship === 'pending_sent') actionHtml = `<button class="person-action action-pending" disabled>Pending</button>`;
    else if (u.relationship === 'pending_received') actionHtml = `<button class="person-action action-add">Accept</button>`;
    else actionHtml = `<button class="person-action action-add">Add Friend</button>`;

    row.innerHTML = `
      ${renderAvatar(u)}
      <div class="person-meta">
        <div class="person-name-row"><div class="person-name">${escapeHtml(u.display_name)}${badgeHtml(u.badge)}</div></div>
        <div class="person-username">@${escapeHtml(u.username)}</div>
        ${u.bio ? `<div class="person-bio">${escapeHtml(u.bio)}</div>` : ''}
      </div>${actionHtml}`;
    const avatarEl = row.querySelector('.avatar');
    const dotEl = document.createElement('span');
    dotEl.className = 'presence-dot' + (onlineSet.has(u.id) || u.online ? ' online' : '');
    avatarEl.appendChild(dotEl);
    row.querySelector('.person-meta').addEventListener('click', () => openProfileView(u.id));

    const btn = row.querySelector('button');
    if (btn && u.relationship === 'accepted') {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await loadContacts();
        const c = contactsCache.find(x => x.id === u.id);
        if (c) { switchView('chats'); openConversation(c); }
      });
    } else if (btn && u.relationship === 'none') {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api.post('/api/users/contacts/requests', { username: u.username });
          btn.textContent = 'Pending'; btn.disabled = true; btn.className = 'person-action action-pending';
          await loadRequests();
        } catch (err) { alert(err.message); }
      });
    } else if (btn && u.relationship === 'pending_received') {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api.post('/api/users/contacts/requests', { username: u.username });
          await Promise.all([loadRequests(), loadContacts()]);
          loadDiscover();
        } catch (err) { alert(err.message); }
      });
    }
    discoverListEl.appendChild(row);
  });
}

function renderOnlinePeople() {
  const list = $('#onlinePeopleList');
  const online = discoverCache.filter(u => onlineSet.has(u.id) || u.online);
  if (!online.length) { list.innerHTML = `<div class="empty-state"><h3>No one's online</h3><p>Check back later.</p></div>`; return; }
  list.innerHTML = '<div class="people-section-title">Online now</div>';
  online.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'person-card';
    row.innerHTML = `${renderAvatar(u)}<div class="person-meta"><div class="person-name">${escapeHtml(u.display_name)}${badgeHtml(u.badge)}</div><div class="request-tag">@${escapeHtml(u.username)}</div></div>`;
    const dotEl = document.createElement('span'); dotEl.className = 'presence-dot online';
    row.querySelector('.avatar').appendChild(dotEl);
    row.addEventListener('click', () => openProfileView(u.id));
    list.appendChild(row);
  });
}

// ---------- New chat modal ----------

function setupNewChatModal() {
  const modal = $('#newChatModal');
  const input = $('#userSearchInput');
  const results = $('#userSearchResults');
  let debounceTimer = null;
  $('#closeNewChatModal').innerHTML = icon('x');
  $('#closeNewChatModal').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    debounceTimer = setTimeout(async () => {
      try {
        const { users } = await api.get(`/api/users/search?q=${encodeURIComponent(q)}`);
        renderUserSearchResults(users, results, modal);
      } catch (err) { results.innerHTML = `<div class="no-results">${escapeHtml(err.message)}</div>`; }
    }, 300);
  });
}
function renderUserSearchResults(users, container, modal) {
  if (!users.length) { container.innerHTML = `<div class="no-results">No users found.</div>`; return; }
  container.innerHTML = '';
  users.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'search-result-item';
    let actionHtml = '';
    if (u.relationship === 'accepted') actionHtml = `<button class="search-result-action action-message">Message</button>`;
    else if (u.relationship === 'pending_sent') actionHtml = `<button class="search-result-action action-pending" disabled>Pending</button>`;
    else if (u.relationship === 'pending_received') actionHtml = `<button class="search-result-action action-add">Accept</button>`;
    else actionHtml = `<button class="search-result-action action-add">Add</button>`;
    row.innerHTML = `${renderAvatar(u)}<div class="search-result-meta"><div class="search-result-name">${escapeHtml(u.display_name)}${badgeHtml(u.badge)}</div><div class="search-result-username">@${escapeHtml(u.username)}</div></div>${actionHtml}`;
    const btn = row.querySelector('button');
    if (btn && u.relationship === 'accepted') {
      btn.addEventListener('click', async () => {
        modal.hidden = true; await loadContacts();
        const c = contactsCache.find(x => x.id === u.id);
        if (c) { switchView('chats'); openConversation(c); }
      });
    } else if (btn && u.relationship === 'none') {
      btn.addEventListener('click', async () => {
        try {
          await api.post('/api/users/contacts/requests', { username: u.username });
          btn.textContent = 'Pending'; btn.disabled = true; btn.className = 'search-result-action action-pending';
          await loadRequests();
        } catch (err) { alert(err.message); }
      });
    } else if (btn && u.relationship === 'pending_received') {
      btn.addEventListener('click', async () => {
        try {
          await api.post('/api/users/contacts/requests', { username: u.username });
          modal.hidden = true;
          await Promise.all([loadRequests(), loadContacts()]);
        } catch (err) { alert(err.message); }
      });
    }
    container.appendChild(row);
  });
}

// ---------- Edit Profile modal ----------

function setupProfileModal() {
  const modal = $('#profileModal');
  $('#editProfileBtn').addEventListener('click', () => openEditProfile());
  $('#closeProfileModal').innerHTML = icon('x');
  $('#closeProfileModal').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

  $('#avatarFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData(); formData.append('avatar', file);
    try {
      const { user } = await api.upload('/api/users/me/avatar', formData);
      me = user; renderMyAvatar();
      const preview = $('#profileAvatarPreview'); const a = avatarInner(me);
      preview.style = a.style; preview.innerHTML = a.html;
      renderContacts();
    } catch (err) { $('#profileError').textContent = err.message; $('#profileError').classList.add('visible'); }
  });

  $('#saveProfileBtn').addEventListener('click', async () => {
    const displayName = $('#profileDisplayName').value.trim();
    const bio = $('#profileBio').value.trim();
    try {
      const { user } = await api.patch('/api/users/me', { displayName, bio });
      me = user; renderMyAvatar();
      $('#profileModal').hidden = true;
      loadMeView();
    } catch (err) { $('#profileError').textContent = err.message; $('#profileError').classList.add('visible'); }
  });
}
function openEditProfile() {
  $('#profileDisplayName').value = me.display_name;
  $('#profileBio').value = me.bio || '';
  $('#profileUsernameHint').textContent = `@${me.username}`;
  const preview = $('#profileAvatarPreview'); const a = avatarInner(me);
  preview.style = a.style; preview.innerHTML = a.html;
  $('#profileError').classList.remove('visible');
  buildBadgeGrid();
  $('#profileModal').hidden = false;
}

// ---------- Settings modal ----------

function setupSettingsModal() {
  const modal = $('#settingsModal');
  $('#openSettingsBtn').innerHTML = icon('settings');
  $('#openSettingsBtn').addEventListener('click', () => {
    buildThemeGrid();
    buildWallpaperGrid();
    $('#privacyToggle').classList.toggle('on', me.privacy === 'private');
    $('#soundToggle').classList.toggle('on', soundEnabled);
    $('#browserNotifToggle').classList.toggle('on', browserNotifEnabled);
    modal.hidden = false;
  });
  $('#closeSettingsModal').innerHTML = icon('x');
  $('#closeSettingsModal').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

  $('#privacyToggle').addEventListener('click', async () => {
    const nowPrivate = !$('#privacyToggle').classList.contains('on');
    try {
      const { user } = await api.patch('/api/users/me/privacy', { privacy: nowPrivate ? 'private' : 'public' });
      me = user;
      $('#privacyToggle').classList.toggle('on', nowPrivate);
    } catch (err) { alert(err.message); }
  });
  $('#soundToggle').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('wirely-sound', soundEnabled ? 'on' : 'off');
    $('#soundToggle').classList.toggle('on', soundEnabled);
  });
  $('#browserNotifToggle').addEventListener('click', async () => {
    browserNotifEnabled = !browserNotifEnabled;
    localStorage.setItem('wirely-browser-notif', browserNotifEnabled ? 'on' : 'off');
    $('#browserNotifToggle').classList.toggle('on', browserNotifEnabled);
    if (browserNotifEnabled && window.Notification && Notification.permission === 'default') Notification.requestPermission();
  });
  $('#settingsLogoutBtn').addEventListener('click', async () => {
    try { await api.post('/api/auth/logout'); } catch (_) {}
    window.location.href = '/index.html';
  });
}

// ---------- Profile view modal ----------

function setupProfileViewModal() {
  const modal = $('#profileViewModal');
  $('#closeProfileViewModal').innerHTML = icon('x');
  $('#closeProfileViewModal').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
}

async function openProfileView(userId) {
  if (userId === me.id) { switchView('me'); return; }
  const modal = $('#profileViewModal');
  const body = $('#profileViewBody');
  body.innerHTML = `<div class="empty-contacts">Loading…</div>`;
  modal.hidden = false;
  try {
    const data = await api.get(`/api/users/${userId}/profile`);
    const u = data.user;
    body.innerHTML = `
      ${renderAvatar(u, 'avatar-lg')}
      <div class="profile-view-name">${escapeHtml(u.display_name)}${badgeHtml(u.badge)}</div>
      <div class="profile-view-username">@${escapeHtml(u.username)}</div>
      ${u.bio ? `<div class="profile-view-bio">${escapeHtml(u.bio)}</div>` : ''}
      <div class="profile-view-stats">
        <div class="profile-view-stat"><b>${data.friend_count}</b><span>Friends</span></div>
        <div class="profile-view-stat"><b>${data.follower_count}</b><span>Followers</span></div>
        <div class="profile-view-stat"><b>${data.post_count}</b><span>Posts</span></div>
      </div>
      ${data.mutual_friend_count > 0 ? `<div class="request-tag" style="text-align:center;margin-top:8px;">${data.mutual_friend_count} mutual friend${data.mutual_friend_count > 1 ? 's' : ''}</div>` : ''}
      <div class="profile-view-actions">
        <button class="btn-secondary" id="pvFollowBtn">${data.is_following ? 'Unfollow' : 'Follow'}</button>
        ${data.relationship === 'accepted' ? `<button class="btn-secondary" id="pvMessageBtn">Message</button>` : ''}
        <button class="icon-btn" id="pvMoreBtn"></button>
      </div>
    `;
    $('#pvMoreBtn').innerHTML = icon('more');
    $('#pvFollowBtn').addEventListener('click', async () => {
      try {
        const res = await api[data.is_following ? 'del' : 'post'](`/api/users/${userId}/follow`);
        openProfileView(userId);
      } catch (err) { alert(err.message); }
    });
    const msgBtn = $('#pvMessageBtn');
    if (msgBtn) msgBtn.addEventListener('click', async () => {
      modal.hidden = true;
      await loadContacts();
      const c = contactsCache.find(x => x.id === userId);
      if (c) { switchView('chats'); openConversation(c); }
    });
    $('#pvMoreBtn').addEventListener('click', () => {
      if (confirm('Report this user?')) openReportModal('user', userId);
      else if (confirm(data.is_blocked_by_me ? 'Unblock this user?' : 'Block this user?')) {
        api[data.is_blocked_by_me ? 'del' : 'post'](`/api/users/${userId}/block`).then(() => { loadContacts(); modal.hidden = true; });
      }
    });
  } catch (err) {
    body.innerHTML = `<div class="empty-contacts">${escapeHtml(err.message)}</div>`;
  }
}

// ---------- Report modal ----------

let reportTarget = null;
function setupReportModal() {
  const modal = $('#reportModal');
  $('#closeReportModal').innerHTML = icon('x');
  $('#closeReportModal').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  $('#submitReportBtn').addEventListener('click', async () => {
    if (!reportTarget) return;
    const reason = $('#reportReasonInput').value.trim();
    try {
      if (reportTarget.type === 'post') await api.post(`/api/posts/${reportTarget.id}/report`, { reason });
      else await api.post(`/api/users/${reportTarget.id}/report`, { reason });
      modal.hidden = true;
      $('#reportReasonInput').value = '';
      alert('Thanks — we\u2019ve received your report.');
    } catch (err) { alert(err.message); }
  });
}
function openReportModal(type, id) {
  reportTarget = { type, id };
  $('#reportModalTitle').textContent = type === 'post' ? 'Report post' : 'Report user';
  $('#reportModal').hidden = false;
}

// ---------- Forward modal ----------

let forwardingMessage = null;
function setupForwardModal() {
  const modal = $('#forwardModal');
  $('#closeForwardModal').innerHTML = icon('x');
  $('#closeForwardModal').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
}
function openForwardModal(message) {
  forwardingMessage = message;
  const modal = $('#forwardModal'); const list = $('#forwardContactList');
  list.innerHTML = '';
  contactsCache.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'search-result-item';
    row.innerHTML = `${renderAvatar(c)}<div class="search-result-meta"><div class="search-result-name">${escapeHtml(c.display_name)}</div><div class="search-result-username">@${escapeHtml(c.username)}</div></div><button class="search-result-action action-message">Send</button>`;
    row.querySelector('button').addEventListener('click', () => { forwardTo(c.id); modal.hidden = true; });
    list.appendChild(row);
  });
  modal.hidden = false;
}
function forwardTo(contactId) {
  if (!forwardingMessage) return;
  const payload = { toUserId: contactId, content: forwardingMessage.content, type: forwardingMessage.type, replyToId: null };
  if (forwardingMessage.type !== 'text') {
    payload.attachment = { url: forwardingMessage.attachment_path, name: forwardingMessage.attachment_name, mime: forwardingMessage.attachment_mime, size: forwardingMessage.attachment_size };
  }
  socket.emit('send_message', payload, (response) => {
    if (response && response.ok) {
      updateContactPreview(contactId, previewFor(response.message), response.message.created_at);
      if (activeContact && activeContact.id === contactId) { appendMessage(response.message); scrollMessagesToBottom(); }
    }
  });
}

// ---------- Shared media modal ----------

function setupSharedMediaModal() {
  const modal = $('#sharedMediaModal');
  $('#closeSharedMediaModal').innerHTML = icon('x');
  $('#closeSharedMediaModal').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  $$('.people-subtab[data-mtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.people-subtab[data-mtab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('#sharedMediaGrid').hidden = btn.dataset.mtab !== 'media';
      $('#sharedVoiceList').hidden = btn.dataset.mtab !== 'voice';
      $('#sharedLinksList').hidden = btn.dataset.mtab !== 'links';
    });
  });
}
async function openSharedMedia(contactId) {
  const modal = $('#sharedMediaModal');
  modal.hidden = false;
  $$('.people-subtab[data-mtab]')[0].click();
  const grid = $('#sharedMediaGrid'); const voiceList = $('#sharedVoiceList'); const linksList = $('#sharedLinksList');
  grid.innerHTML = `<div class="empty-contacts">Loading…</div>`;
  try {
    const [{ media }, { voice }, { links }] = await Promise.all([
      api.get(`/api/messages/${contactId}/media`),
      api.get(`/api/messages/${contactId}/voice`),
      api.get(`/api/messages/${contactId}/links`)
    ]);
    grid.innerHTML = media.length ? media.map((m) => m.type === 'image'
      ? `<img src="${escapeHtml(m.attachment_path)}" alt="" onclick="window.open('${escapeHtml(m.attachment_path)}','_blank')" />`
      : `<a class="media-file" href="${escapeHtml(m.attachment_path)}" target="_blank" rel="noopener">${icon('file')}<span>${escapeHtml(m.attachment_name || 'File')}</span></a>`
    ).join('') : `<div class="empty-contacts">No shared media yet.</div>`;

    voiceList.innerHTML = voice.length ? voice.map((v) => `
      <div class="search-result-item"><span style="width:32px;">${icon('mic')}</span><div class="search-result-meta">${fileSizeLabel(v.attachment_size)} \u2014 ${formatPreviewTime(v.created_at)}</div>
      <a class="search-result-action action-message" href="${escapeHtml(v.attachment_path)}" target="_blank" rel="noopener">Play</a></div>`).join('') : `<div class="empty-contacts">No voice notes yet.</div>`;

    linksList.innerHTML = links.length ? links.map((l) => `
      <div class="search-result-item">${icon('link')}<a class="search-result-meta" href="${escapeHtml(l.content.match(/https?:\/\/\S+/)?.[0] || '#')}" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all;">${escapeHtml(l.content)}</a></div>`).join('') : `<div class="empty-contacts">No links shared yet.</div>`;
  } catch (err) {
    grid.innerHTML = `<div class="empty-contacts">${escapeHtml(err.message)}</div>`;
  }
}

// ---------- Conversation ----------

async function openConversation(contact) {
  activeContact = contact;
  replyingTo = null;
  editingMessageId = null;
  renderContacts($('#chatSearchInput').value.trim().toLowerCase());

  const c = contactsCache.find(x => x.id === contact.id) || {};
  const isBlockedByMe = !!c.blockedByMe;
  const blockedMe = !!c.blockedMe;

  const conversationEl = $('#conversation');
  conversationEl.innerHTML = `
    <div class="conversation-header">
      <button class="icon-btn back-btn" id="backBtn">${icon('back')}</button>
      <div class="conversation-header-meta" id="convProfileTrigger" style="cursor:pointer;">${renderAvatar(contact)}</div>
      <div class="conversation-header-meta" id="convProfileTrigger2" style="display:flex;flex-direction:column;justify-content:center;cursor:pointer;">
        <div class="contact-name">${escapeHtml(contact.display_name)}${badgeHtml(contact.badge)}</div>
        <span class="status-pill" id="convStatus"><span class="dot"></span>@${escapeHtml(contact.username)}</span>
      </div>
      <div class="conversation-header-actions">
        <button class="icon-btn" id="convSearchBtn" title="Search in chat">${icon('search')}</button>
        <button class="icon-btn" id="moreMenuBtn" title="More" data-opens-menu>${icon('more')}</button>
      </div>
      <div class="more-menu" id="moreMenu">
        <button type="button" id="menuViewProfile">${icon('profile')} View Profile</button>
        <button type="button" id="menuSearch">${icon('search')} Search Messages</button>
        <button type="button" id="menuMedia">${icon('media')} Shared Media</button>
        <button type="button" id="menuMute">${icon('mute')} <span id="menuMuteLabel">Mute</span></button>
        <div class="more-menu-divider"></div>
        <button type="button" id="menuBlock" class="danger">${icon('block')} <span id="menuBlockLabel">Block</span></button>
        <button type="button" id="menuDeleteChat" class="danger">${icon('trash')} Delete Chat</button>
        <button type="button" id="menuRemoveFriend" class="danger">${icon('x')} Remove Friend</button>
      </div>
    </div>
    <div class="conv-search-bar" id="convSearchBar"><input type="text" id="convSearchInput" placeholder="Search messages…" /></div>
    <div class="pinned-bar" id="pinnedBar"><span class="icon">${icon('pin')}</span><span class="pinned-bar-text" id="pinnedBarText"></span><button id="unpinBtn">${icon('x')}</button></div>
    <div class="messages" id="messages" style="position:relative;">${skeletonRows(4)}</div>
    <div class="typing-indicator" id="typingIndicator"></div>
    <button class="jump-latest-btn" id="jumpLatestBtn">${icon('jumpDown')}</button>
    ${isBlockedByMe ? `
      <div class="blocked-banner">You blocked this user. <button id="unblockInlineBtn">Unblock</button></div>
    ` : blockedMe ? `
      <div class="blocked-banner" style="justify-content:center;">You can't send messages to this user.</div>
    ` : `
      <div class="reply-preview-bar" id="replyBar"><div class="reply-preview-content" id="replyBarContent"></div><button class="reply-preview-close" id="replyBarClose">${icon('x')}</button></div>
      <form class="composer" id="composerForm">
        <button type="button" class="composer-btn" id="attachBtn" title="Attach" data-opens-menu>${icon('paperclip')}</button>
        <div class="attach-menu" id="attachMenu">
          <button type="button" data-accept="image/*,video/*">${icon('camera')} Photo &amp; video</button>
          <button type="button" data-accept="">${icon('file')} Document</button>
        </div>
        <input type="file" id="fileInput" hidden />
        <button type="button" class="composer-btn" id="emojiBtn" title="Emoji" data-opens-menu>${icon('smile')}</button>
        <textarea id="messageInput" rows="1" placeholder="Message…" maxlength="4000"></textarea>
        <div class="composer-send-slot">
          <button type="button" class="composer-btn" id="voiceBtn" title="Record voice note">${icon('mic')}</button>
          <button type="submit" class="send-btn morph-hidden" id="sendBtn">${icon('send')}</button>
        </div>
      </form>
      <div class="emoji-picker" id="emojiPicker"></div>
    `}
  `;

  if (window.matchMedia('(max-width: 780px)').matches) {
    $('#sidebar').classList.add('hide-mobile');
    conversationEl.classList.add('show-mobile');
  }
  $('#backBtn').addEventListener('click', () => { $('#sidebar').classList.remove('hide-mobile'); conversationEl.classList.remove('show-mobile'); });

  const openProfile = () => openProfileView(contact.id);
  $('#convProfileTrigger').addEventListener('click', openProfile);
  $('#convProfileTrigger2').addEventListener('click', openProfile);

  setupMoreMenu(contact);
  applyWallpaper();

  const unblockBtn = $('#unblockInlineBtn');
  if (unblockBtn) unblockBtn.addEventListener('click', async () => {
    await api.del(`/api/users/${contact.id}/block`);
    await loadContacts();
    openConversation(contact);
  });

  $('#convSearchBtn').addEventListener('click', () => {
    const bar = $('#convSearchBar');
    bar.classList.toggle('visible');
    if (bar.classList.contains('visible')) $('#convSearchInput').focus();
    else loadConversationMessages(contact.id);
  });
  $('#convSearchInput').addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    if (!q) { loadConversationMessages(contact.id); return; }
    const { messages } = await api.get(`/api/messages/${contact.id}/search?q=${encodeURIComponent(q)}`);
    renderMessagesList(messages.reverse(), { highlight: q });
  }, 300));

  $('#unpinBtn').addEventListener('click', async () => {
    const pin = $('#pinnedBar').dataset.messageId;
    if (pin) socket.emit('unpin_message', { messageId: parseInt(pin, 10) });
  });

  if ($('#emojiPicker')) buildEmojiPicker();

  await loadConversationMessages(contact.id, { initial: true });
  socket.emit('mark_read', { contactId: contact.id });

  const cc = contactsCache.find(x => x.id === contact.id);
  if (cc) cc.unread = 0;
  renderContacts($('#chatSearchInput').value.trim().toLowerCase());

  if (!isBlockedByMe && !blockedMe) setupComposer(contact);

  $('#messages').addEventListener('scroll', () => {
    const el = $('#messages');
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    $('#jumpLatestBtn').classList.toggle('visible', !nearBottom);
  });
  $('#jumpLatestBtn').addEventListener('click', scrollMessagesToBottom);
}

async function loadConversationMessages(contactId, opts = {}) {
  const { messages, pinned } = await api.get(`/api/messages/${contactId}`);
  renderMessagesList(messages);
  if (opts.initial) scrollMessagesToBottom();
  if (pinned) showPinnedBar(pinned); else $('#pinnedBar')?.classList.remove('visible');
}

function showPinnedBar(pin) {
  const bar = $('#pinnedBar');
  if (!bar) return;
  bar.dataset.messageId = pin.message_id;
  const label = pin.type === 'text' ? pin.content : previewFor(pin);
  $('#pinnedBarText').textContent = `Pinned: ${label}`;
  bar.classList.add('visible');
  bar.onclick = (e) => {
    if (e.target.closest('#unpinBtn')) return;
    const target = document.querySelector(`.msg-row[data-id="${pin.message_id}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
}

function setupMoreMenu(contact) {
  const menu = $('#moreMenu');
  const c = contactsCache.find(x => x.id === contact.id) || {};
  $('#menuMuteLabel').textContent = c.muted ? 'Unmute' : 'Mute';
  $('#menuBlockLabel').textContent = c.blockedByMe ? 'Unblock' : 'Block';
  $('#moreMenuBtn').addEventListener('click', () => { closeAllPopovers(menu); menu.classList.toggle('visible'); });
  $('#menuViewProfile').addEventListener('click', () => { menu.classList.remove('visible'); openProfileView(contact.id); });
  $('#menuSearch').addEventListener('click', () => { menu.classList.remove('visible'); $('#convSearchBar').classList.add('visible'); $('#convSearchInput').focus(); });
  $('#menuMedia').addEventListener('click', () => { menu.classList.remove('visible'); openSharedMedia(contact.id); });
  $('#menuMute').addEventListener('click', async () => {
    menu.classList.remove('visible');
    const nowMuted = !c.muted;
    await api[nowMuted ? 'post' : 'del'](`/api/users/${contact.id}/mute`);
    await loadContacts();
  });
  $('#menuBlock').addEventListener('click', async () => {
    menu.classList.remove('visible');
    const nowBlocked = !c.blockedByMe;
    if (nowBlocked && !confirm(`Block ${contact.display_name}? They won't be able to message you.`)) return;
    await api[nowBlocked ? 'post' : 'del'](`/api/users/${contact.id}/block`);
    await loadContacts();
    openConversation(contact);
  });
  $('#menuDeleteChat').addEventListener('click', async () => {
    menu.classList.remove('visible');
    if (!confirm('Delete this chat? It will reappear if they message you again.')) return;
    await api.post(`/api/users/${contact.id}/clear-chat`);
    activeContact = null;
    $('#conversation').innerHTML = `<div class="no-conversation">Select a chat from the list, or find someone new in People.</div>`;
    await loadContacts();
  });
  $('#menuRemoveFriend').addEventListener('click', () => { menu.classList.remove('visible'); removeContact(contact.id); });
}

async function removeContact(contactId) {
  if (!confirm('Remove this contact? Your message history stays, but they will be removed from your chat list.')) return;
  try {
    await api.del(`/api/users/contacts/${contactId}`);
    activeContact = null;
    $('#conversation').innerHTML = `<div class="no-conversation">Select a chat from the list, or find someone new in People.</div>`;
    await loadContacts();
  } catch (err) { alert(err.message); }
}
function scrollMessagesToBottom() { const el = $('#messages'); if (el) el.scrollTop = el.scrollHeight; }

// ---------- Message rendering ----------

function renderMessagesList(messages, opts = {}) {
  const messagesEl = $('#messages');
  if (!messagesEl) return;
  messagesEl.innerHTML = '';
  let lastDateKey = null;
  let dividerPlaced = false;
  const firstUnreadIdx = messages.findIndex(m => m.sender_id !== me.id && !m.read_at && !m.deleted_at);

  messages.forEach((message, idx) => {
    const dateKey = toDate(message.created_at).toDateString();
    if (dateKey !== lastDateKey) {
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      sep.innerHTML = `<span>${formatDateHeading(message.created_at)}</span>`;
      messagesEl.appendChild(sep);
      lastDateKey = dateKey;
    }
    if (!dividerPlaced && idx === firstUnreadIdx && firstUnreadIdx > 0) {
      const div = document.createElement('div');
      div.className = 'unread-divider';
      div.innerHTML = `<span class="line"></span><span>Unread</span><span class="line"></span>`;
      messagesEl.appendChild(div);
      dividerPlaced = true;
    }
    appendMessage(message, { skipScroll: true, highlight: opts.highlight });
  });
}

function buildEmojiPicker() {
  const picker = $('#emojiPicker');
  picker.innerHTML = EMOJI_LIST.map(e => `<button type="button">${e}</button>`).join('');
  $('#emojiBtn').addEventListener('click', () => { closeAllPopovers(picker); picker.classList.toggle('visible'); });
  picker.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') { const input = $('#messageInput'); input.value += e.target.textContent; input.focus(); input.dispatchEvent(new Event('input')); }
  });
}

function highlightText(text, term) {
  if (!term) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const escapedTerm = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${escapedTerm})`, 'ig'), '<mark style="background:var(--accent);color:#0B0D0E;border-radius:3px;">$1</mark>');
}

function bubbleContentHtml(message, highlight) {
  if (message.deleted_at) return `<span class="bubble-content">This message was deleted</span>`;
  let replyHtml = '';
  if (message.reply_preview) {
    const senderLabel = message.reply_preview.sender_id === me.id ? 'You' : (activeContact ? activeContact.display_name : '');
    const snippet = message.reply_preview.type !== 'text' ? previewFor(message.reply_preview) : message.reply_preview.content;
    replyHtml = `<div class="bubble-reply"><span class="bubble-reply-sender">${escapeHtml(senderLabel)}</span>${escapeHtml(snippet).slice(0, 120)}</div>`;
  }
  let mediaHtml = '';
  if (message.type === 'image') {
    mediaHtml = `<img class="attachment-image" src="${escapeHtml(message.attachment_path)}" alt="Shared image" data-role="open-lightbox" />`;
  } else if (message.type === 'voice') {
    mediaHtml = `<div class="voice-player" data-role="voice-player" data-url="${escapeHtml(message.attachment_path)}" data-msg-id="${message.id}"></div>`;
  } else if (message.type === 'file') {
    const isVideo = (message.attachment_mime || '').startsWith('video/');
    mediaHtml = isVideo
      ? `<video class="attachment-video" controls src="${escapeHtml(message.attachment_path)}"></video>`
      : `<a class="attachment-file" href="${escapeHtml(message.attachment_path)}" target="_blank" rel="noopener"><span class="attachment-file-icon">${icon('file')}</span><span><span class="attachment-file-name">${escapeHtml(message.attachment_name || 'File')}</span><br><span class="attachment-file-size">${fileSizeLabel(message.attachment_size)}</span></span></a>`;
  }
  const textHtml = message.content ? `<span class="bubble-content">${highlightText(message.content, highlight)}</span>` : '';
  return replyHtml + mediaHtml + textHtml;
}

function renderTicksHtml(message) {
  if (message.sender_id !== me.id) return '';
  let cls = 'ticks'; let iconName = 'check';
  if (message.read_at) { iconName = 'checkCheck'; cls += ' read'; }
  else if (message.delivered_at) { iconName = 'checkCheck'; }
  return `<span class="${cls}">${icon(iconName)}</span>`;
}

function reactionsHtml(reactions) {
  if (!reactions || !reactions.length) return '';
  const grouped = {};
  reactions.forEach(r => { grouped[r.emoji] = grouped[r.emoji] || []; grouped[r.emoji].push(r.user_id); });
  return `<div class="msg-reactions">` + Object.entries(grouped).map(([emoji, users]) => `
    <span class="reaction-chip ${users.includes(me.id) ? 'mine' : ''}" data-emoji="${escapeHtml(emoji)}">${emoji} ${users.length > 1 ? users.length : ''}</span>
  `).join('') + `</div>`;
}

function appendMessage(message, opts = {}) {
  const messagesEl = $('#messages');
  if (!messagesEl) return;
  const mine = message.sender_id === me.id;
  const row = document.createElement('div');
  row.className = 'msg-row' + (mine ? ' mine' : '');
  row.dataset.id = message.id;

  const actionsHtml = message.deleted_at ? '' : `
    <div class="msg-actions">
      <button type="button" data-action="reply" title="Reply">${icon('reply')}</button>
      <button type="button" data-action="copy" title="Copy">${icon('copy')}</button>
      <button type="button" data-action="forward" title="Forward">${icon('forward')}</button>
      ${mine && message.type === 'text' ? `<button type="button" data-action="edit" title="Edit">${icon('edit')}</button>` : ''}
      ${mine ? `<button type="button" data-action="delete" title="Delete">${icon('trash')}</button>` : ''}
    </div>`;

  row.innerHTML = `
    <div class="bubble ${message.deleted_at ? 'deleted' : ''}">
    <div class="bubble-body">
        ${bubbleContentHtml(message, opts.highlight)}
    </div>

    <div class="bubble-footer">
        <span class="bubble-edited" ${message.edited_at ? '' : 'hidden'}>
            edited
        </span>

        <span class="bubble-time">
            ${formatTime(message.created_at)}
        </span>

        ${renderTicksHtml(message)}
    </div>
</div>
    </div>
    ${reactionsHtml(message.reactions)}
  `;

  row.querySelectorAll('.msg-actions button').forEach((btn) => btn.addEventListener('click', () => handleMessageAction(btn.dataset.action, message)));
  const replyEl = row.querySelector('.bubble-reply');
  if (replyEl) replyEl.addEventListener('click', () => {
    const target = document.querySelector(`.msg-row[data-id="${message.reply_preview.id}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  row.querySelectorAll('.reaction-chip').forEach((chip) => {
    chip.addEventListener('click', () => toggleMyReaction(message.id, chip.dataset.emoji));
  });
  const lightboxImg = row.querySelector('[data-role="open-lightbox"]');
  if (lightboxImg) lightboxImg.addEventListener('click', () => openLightboxForConversation(message.id));
  const voicePlayer = row.querySelector('[data-role="voice-player"]');
  if (voicePlayer) renderVoiceWaveform(voicePlayer, message.attachment_path, message.id);

  attachLongPressAndSwipe(row, message);

  messagesEl.appendChild(row);
  if (!opts.skipScroll) scrollMessagesToBottom();
}

function upsertReactionInDom(messageId, userId, emoji) {
  const row = document.querySelector(`.msg-row[data-id="${messageId}"]`);
  if (!row) return;
  // Simplest correct approach: re-render just the reactions block by asking
  // the row to track its own reaction list in a data attribute.
  const current = JSON.parse(row.dataset.reactions || '[]').filter(r => r.user_id !== userId);
  current.push({ user_id: userId, emoji });
  row.dataset.reactions = JSON.stringify(current);
  const existing = row.querySelector('.msg-reactions');
  const html = reactionsHtml(current);
  if (existing) existing.outerHTML = html; else row.insertAdjacentHTML('beforeend', html);
  row.querySelectorAll('.reaction-chip').forEach((chip) => {
    chip.addEventListener('click', () => toggleMyReaction(messageId, chip.dataset.emoji));
  });
}
function removeReactionInDom(messageId, userId) {
  const row = document.querySelector(`.msg-row[data-id="${messageId}"]`);
  if (!row) return;
  const current = JSON.parse(row.dataset.reactions || '[]').filter(r => r.user_id !== userId);
  row.dataset.reactions = JSON.stringify(current);
  const existing = row.querySelector('.msg-reactions');
  const html = reactionsHtml(current);
  if (existing) existing.outerHTML = html;
  row.querySelectorAll('.reaction-chip').forEach((chip) => {
    chip.addEventListener('click', () => toggleMyReaction(messageId, chip.dataset.emoji));
  });
}
function toggleMyReaction(messageId, emoji) {
  const row = document.querySelector(`.msg-row[data-id="${messageId}"]`);
  const current = row ? JSON.parse(row.dataset.reactions || '[]') : [];
  const mine = current.find(r => r.user_id === me.id);
  if (mine && mine.emoji === emoji) {
    socket.emit('remove_reaction', { messageId });
  } else {
    socket.emit('react_message', { messageId, emoji });
  }
  vibrate(15);
}

// ---------- Long-press menu (reactions + actions) ----------

function attachLongPressAndSwipe(row, message) {
  let pressTimer = null;
  const bubble = row.querySelector('.bubble');

  const openMenu = (clientX, clientY) => {
    vibrate(20);
    showLongPressMenu(message, clientX, clientY);
  };

  bubble.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY); });
  bubble.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    pressTimer = setTimeout(() => openMenu(touch.clientX, touch.clientY), 500);
  }, { passive: true });
  bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
  bubble.addEventListener('touchmove', () => clearTimeout(pressTimer));
}

function showLongPressMenu(message, x, y) {
  closeAllPopovers();
  let menu = $('#longPressMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'long-press-menu';
    menu.id = 'longPressMenu';
    document.body.appendChild(menu);
  }
  const mine = message.sender_id === me.id;
  const currentReaction = (JSON.parse(document.querySelector(`.msg-row[data-id="${message.id}"]`)?.dataset.reactions || '[]')).find(r => r.user_id === me.id);

  menu.innerHTML = `
    <div style="display:flex;gap:4px;padding:4px 4px 8px;border-bottom:1px dashed rgba(143,163,170,0.15);margin-bottom:4px;">
      ${REACTION_EMOJIS.map(e => `<button type="button" data-emoji="${e}" style="font-size:18px;flex:1;background:${currentReaction && currentReaction.emoji === e ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'none'};border:none;border-radius:8px;padding:4px;">${e}</button>`).join('')}
    </div>
    <button data-a="reply">${icon('reply')} Reply</button>
    <button data-a="forward">${icon('forward')} Forward</button>
    <button data-a="copy">${icon('copy')} Copy</button>
    <button data-a="pin">${icon('pin')} ${document.querySelector('#pinnedBar')?.dataset.messageId == message.id ? 'Unpin' : 'Pin'}</button>
    ${mine && message.type === 'text' ? `<button data-a="edit">${icon('edit')} Edit</button>` : ''}
    <button data-a="delete-me" class="danger">${icon('trash')} Delete for me</button>
    ${mine ? `<button data-a="delete-everyone" class="danger">${icon('trash')} Delete for everyone</button>` : `<button data-a="report" class="danger">${icon('flag')} Report</button>`}
  `;

  menu.querySelectorAll('[data-emoji]').forEach((btn) => btn.addEventListener('click', () => { toggleMyReaction(message.id, btn.dataset.emoji); menu.classList.remove('visible'); }));
  menu.querySelector('[data-a="reply"]').addEventListener('click', () => { startReply(message); menu.classList.remove('visible'); });
  menu.querySelector('[data-a="forward"]').addEventListener('click', () => { openForwardModal(message); menu.classList.remove('visible'); });
  menu.querySelector('[data-a="copy"]').addEventListener('click', () => {
    const text = message.type === 'text' ? message.content : previewFor(message);
    navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
    menu.classList.remove('visible');
  });
  menu.querySelector('[data-a="pin"]').addEventListener('click', () => {
    const isPinned = document.querySelector('#pinnedBar')?.dataset.messageId == message.id;
    socket.emit(isPinned ? 'unpin_message' : 'pin_message', { messageId: message.id });
    menu.classList.remove('visible');
  });
  const editBtn = menu.querySelector('[data-a="edit"]');
  if (editBtn) editBtn.addEventListener('click', () => { startEdit(message); menu.classList.remove('visible'); });
  menu.querySelector('[data-a="delete-me"]').addEventListener('click', () => {
    socket.emit('delete_for_me', { messageId: message.id }, (res) => {
      if (res && res.ok) document.querySelector(`.msg-row[data-id="${message.id}"]`)?.remove();
    });
    menu.classList.remove('visible');
  });
  const delEveryone = menu.querySelector('[data-a="delete-everyone"]');
  if (delEveryone) delEveryone.addEventListener('click', () => {
    if (confirm('Delete this message for everyone?')) socket.emit('delete_message', { messageId: message.id });
    menu.classList.remove('visible');
  });
  const reportBtn = menu.querySelector('[data-a="report"]');
  if (reportBtn) reportBtn.addEventListener('click', () => { menu.classList.remove('visible'); alert('Thanks — this message has been flagged for review.'); });

  const menuWidth = 210, menuHeight = 320;
  const left = Math.min(x, window.innerWidth - menuWidth - 10);
  const top = Math.min(y, window.innerHeight - menuHeight - 10);
  menu.style.left = Math.max(10, left) + 'px';
  menu.style.top = Math.max(10, top) + 'px';
  menu.classList.add('visible');
}

function handleMessageAction(action, message) {
  if (action === 'reply') startReply(message);
  else if (action === 'copy') { const text = message.type === 'text' ? message.content : previewFor(message); navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {}); }
  else if (action === 'forward') openForwardModal(message);
  else if (action === 'edit') startEdit(message);
  else if (action === 'delete') {
    if (confirm('Delete this message for everyone? (Choose Cancel for more options)')) {
      socket.emit('delete_message', { messageId: message.id }, (res) => { if (res && !res.ok) alert(res.error); });
    }
  }
}
function startReply(message) {
  replyingTo = message; editingMessageId = null;
  const bar = $('#replyBar'); if (!bar) return;
  bar.classList.add('visible');
  const senderLabel = message.sender_id === me.id ? 'You' : activeContact.display_name;
  $('#replyBarContent').innerHTML = `<b>${escapeHtml(senderLabel)}</b>${escapeHtml(message.type === 'text' ? message.content : previewFor(message)).slice(0, 100)}`;
  $('#messageInput').focus();
}
function startEdit(message) {
  editingMessageId = message.id; replyingTo = null;
  const bar = $('#replyBar'); if (!bar) return;
  bar.classList.add('visible');
  $('#replyBarContent').innerHTML = `<b>Editing message</b>${escapeHtml(message.content).slice(0, 100)}`;
  const input = $('#messageInput'); input.value = message.content; input.focus(); input.dispatchEvent(new Event('input'));
}
function cancelComposerContext() { replyingTo = null; editingMessageId = null; $('#replyBar')?.classList.remove('visible'); }

// ---------- Voice player (deterministic waveform + real playback/seek/speed) ----------

function seededBarHeights(seed, count) {
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return Array.from({ length: count }, () => 6 + Math.round(rand() * 18));
}

function renderVoiceWaveform(container, url, messageId) {
  const BAR_COUNT = 28;
  const heights = seededBarHeights(messageId, BAR_COUNT);
  container.innerHTML = `
    <button class="voice-play-btn" type="button">${icon('play')}</button>
    <div class="voice-waveform">${heights.map(h => `<span class="bar" style="height:${h}px"></span>`).join('')}</div>
    <div class="voice-meta"><span class="voice-time">0:00</span><button class="voice-speed-btn" type="button">1x</button></div>
  `;
  const playBtn = container.querySelector('.voice-play-btn');
  const waveform = container.querySelector('.voice-waveform');
  const bars = container.querySelectorAll('.bar');
  const timeEl = container.querySelector('.voice-time');
  const speedBtn = container.querySelector('.voice-speed-btn');

  let audio = voiceAudioEls[messageId];
  if (!audio) { audio = new Audio(url); voiceAudioEls[messageId] = audio; }

  const speeds = [1, 1.5, 2];
  let speedIdx = 0;

  function fmt(sec) { if (!isFinite(sec)) return '0:00'; const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return `${m}:${s.toString().padStart(2, '0')}`; }
  function updateProgress() {
    const pct = audio.duration ? audio.currentTime / audio.duration : 0;
    const activeCount = Math.floor(pct * BAR_COUNT);
    bars.forEach((b, i) => b.classList.toggle('played', i < activeCount));
    // Show elapsed time once playback has started, otherwise show total length.
    timeEl.textContent = fmt(audio.currentTime > 0 ? audio.currentTime : (audio.duration || 0));
  }

  playBtn.addEventListener('click', () => {
    if (audio.paused) { audio.play(); playBtn.innerHTML = icon('pause'); }
    else { audio.pause(); playBtn.innerHTML = icon('play'); }
  });
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', () => { timeEl.textContent = fmt(audio.duration); });
  audio.addEventListener('ended', () => { playBtn.innerHTML = icon('play'); bars.forEach(b => b.classList.remove('played')); timeEl.textContent = fmt(audio.duration); });

  waveform.addEventListener('click', (e) => {
    if (!audio.duration) return;
    const rect = waveform.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * audio.duration;
    updateProgress();
  });
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    audio.playbackRate = speeds[speedIdx];
    speedBtn.textContent = speeds[speedIdx] + 'x';
  });
}

// ---------- Composer ----------

function setupComposer(contact) {
  const composerForm = $('#composerForm');
  if (!composerForm) return;
  const messageInput = $('#messageInput');
  const fileInput = $('#fileInput');
  const attachBtn = $('#attachBtn');
  const attachMenu = $('#attachMenu');
  const voiceBtn = $('#voiceBtn');
  const sendBtn = $('#sendBtn');
  let typingActive = false;
  let typingStopTimer = null;

  function syncMorph() {
    const hasText = messageInput.value.trim().length > 0;
    voiceBtn.classList.toggle('morph-hidden', hasText);
    sendBtn.classList.toggle('morph-hidden', !hasText);
  }

  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    syncMorph();
    if (!typingActive) { typingActive = true; socket.emit('typing', { toUserId: contact.id }); }
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => { typingActive = false; socket.emit('stop_typing', { toUserId: contact.id }); }, 1500);
  });
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); composerForm.requestSubmit(); }
    if (e.key === 'Escape') cancelComposerContext();
  });
  $('#replyBarClose').addEventListener('click', cancelComposerContext);

  composerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const content = messageInput.value.trim();
    if (!content) return;
    if (editingMessageId) {
      socket.emit('edit_message', { messageId: editingMessageId, content }, (res) => { if (!res || !res.ok) alert((res && res.error) || 'Edit failed.'); });
      cancelComposerContext(); messageInput.value = ''; messageInput.style.height = 'auto'; syncMorph();
      return;
    }
    sendTextMessage(contact.id, content, replyingTo ? replyingTo.id : null);
    cancelComposerContext(); messageInput.value = ''; messageInput.style.height = 'auto'; syncMorph(); messageInput.focus();
  });

  attachBtn.addEventListener('click', () => { closeAllPopovers(attachMenu); attachMenu.classList.toggle('visible'); });
  attachMenu.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => { fileInput.accept = btn.dataset.accept; attachMenu.classList.remove('visible'); fileInput.click(); });
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; fileInput.value = '';
    if (!file) return;
    await sendAttachment(contact.id, file);
  });
  voiceBtn.addEventListener('click', () => toggleVoiceRecording(contact.id));
  syncMorph();
}

function sendTextMessage(toUserId, content, replyToId) {
  const sendBtn = $('#sendBtn');
  sendBtn.disabled = true;
  socket.emit('send_message', { toUserId, content, type: 'text', replyToId }, (response) => {
    sendBtn.disabled = false;
    if (!response || !response.ok) { alert((response && response.error) || 'Message failed to send.'); return; }
    appendMessage(response.message);
    updateContactPreview(toUserId, previewFor(response.message), response.message.created_at);
  });
}
async function sendAttachment(toUserId, file) {
  const formData = new FormData(); formData.append('file', file);
  try {
    const uploaded = await api.upload('/api/upload', formData);
    socket.emit('send_message', {
      toUserId, content: '', type: uploaded.kind,
      attachment: { url: uploaded.url, name: uploaded.name, mime: uploaded.mime, size: uploaded.size },
      replyToId: replyingTo ? replyingTo.id : null
    }, (response) => {
      if (!response || !response.ok) { alert((response && response.error) || 'Failed to send attachment.'); return; }
      appendMessage(response.message);
      updateContactPreview(toUserId, previewFor(response.message), response.message.created_at);
      cancelComposerContext();
    });
  } catch (err) { alert(err.message); }
}
async function toggleVoiceRecording(toUserId) {
  const btn = $('#voiceBtn');
  if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      btn.classList.remove('recording');
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      if (blob.size > 0) { const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' }); await sendAttachment(toUserId, file); }
    };
    mediaRecorder.start();
    btn.classList.add('recording');
  } catch (err) { alert('Microphone access is needed to record a voice note.'); }
}

// ---------- Lightbox (fullscreen image viewer: swipe/buttons, tap outside to close) ----------

function setupLightbox() {
  $('#lightboxClose').innerHTML = icon('x');
  $('#lightboxPrev').innerHTML = icon('chevronLeft');
  $('#lightboxNext').innerHTML = icon('chevronRight');
  $('#lightboxClose').addEventListener('click', closeLightbox);
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
  $('#lightboxPrev').addEventListener('click', () => moveLightbox(-1));
  $('#lightboxNext').addEventListener('click', () => moveLightbox(1));
  document.addEventListener('keydown', (e) => {
    if (!$('#lightbox').classList.contains('visible')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') moveLightbox(-1);
    if (e.key === 'ArrowRight') moveLightbox(1);
  });
  let touchStartX = null;
  $('#lightboxImg').addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  $('#lightboxImg').addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) moveLightbox(dx > 0 ? -1 : 1);
    touchStartX = null;
  });
}
function openLightbox(images, startIndex) {
  currentLightboxImages = images;
  currentLightboxIndex = startIndex;
  renderLightboxImage();
  $('#lightbox').classList.add('visible');
}
function openLightboxForConversation(messageId) {
  const images = $$('#messages .attachment-image').map(img => img.src);
  const clickedSrc = document.querySelector(`.msg-row[data-id="${messageId}"] .attachment-image`)?.src;
  const idx = Math.max(0, images.indexOf(clickedSrc));
  openLightbox(images, idx);
}
function moveLightbox(delta) {
  if (!currentLightboxImages.length) return;
  currentLightboxIndex = (currentLightboxIndex + delta + currentLightboxImages.length) % currentLightboxImages.length;
  renderLightboxImage();
}
function renderLightboxImage() {
  $('#lightboxImg').src = currentLightboxImages[currentLightboxIndex];
  const multi = currentLightboxImages.length > 1;
  $('#lightboxPrev').style.display = multi ? 'flex' : 'none';
  $('#lightboxNext').style.display = multi ? 'flex' : 'none';
  $('#lightboxCounter').textContent = multi ? `${currentLightboxIndex + 1} / ${currentLightboxImages.length}` : '';
}
function closeLightbox() { $('#lightbox').classList.remove('visible'); }

// ---------- Home Feed ----------

function setupFeed() {
  $('#postImageBtn').innerHTML = icon('image');
  $('#postFeelingBtn').innerHTML = icon('smile');
  $('#postLocationBtn').innerHTML = icon('location');
  $('#removePostImageBtn').innerHTML = icon('x');
  $('#postImageBtn').addEventListener('click', () => $('#postImageInput').click());

  $('#postImageInput').addEventListener('change', async () => {
    const file = $('#postImageInput').files[0];
    $('#postImageInput').value = '';
    if (!file) return;
    try {
      const formData = new FormData(); formData.append('file', file);
      const uploaded = await api.upload('/api/upload', formData);
      postImageUpload = uploaded;
      $('#postImagePreviewImg').src = uploaded.url;
      $('#postImagePreview').classList.add('visible');
      syncPostButton();
    } catch (err) { alert(err.message); }
  });
  $('#removePostImageBtn').addEventListener('click', () => { postImageUpload = null; $('#postImagePreview').classList.remove('visible'); syncPostButton(); });

  $('#postFeelingBtn').addEventListener('click', () => {
    const feelings = ['😊 happy', '😢 sad', '😍 loved', '😴 tired', '🎉 celebrating', '🤔 thoughtful', '😤 motivated'];
    const choice = prompt('Feeling…\n' + feelings.join('\n'), feelings[0]);
    if (choice) { postFeeling = choice; $('#postFeelingTag').innerHTML = `${icon('smile')} Feeling ${escapeHtml(choice.replace(/^\S+\s/, ''))}`; $('#postFeelingTag').classList.add('visible'); syncPostButton(); }
  });
  $('#postLocationBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('Location is not available in this browser.'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      postLocation = `${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`;
      $('#postLocationTag').innerHTML = `${icon('location')} ${escapeHtml(postLocation)}`;
      $('#postLocationTag').classList.add('visible');
      syncPostButton();
    }, () => alert('Could not get your location.'));
  });

  $('#postContentInput').addEventListener('input', () => {
    const el = $('#postContentInput');
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    syncPostButton();
  });
  $('#submitPostBtn').addEventListener('click', submitPost);

  const observer = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) loadFeed(false); }, { rootMargin: '200px' });
  observer.observe($('#feedSentinelV27'));
}
function syncPostButton() {
  const hasContent = $('#postContentInput').value.trim().length > 0 || !!postImageUpload || !!postFeeling || !!postLocation;
  $('#submitPostBtn').disabled = !hasContent;
}
async function submitPost() {
  let content = $('#postContentInput').value.trim();
  if (postFeeling) content = (content ? content + ' — ' : '') + postFeeling;
  if (postLocation) content = (content ? content + ' ' : '') + `📍 ${postLocation}`;
  const btn = $('#submitPostBtn');
  btn.disabled = true;
  try {
    const { post } = await api.post('/api/posts', { content, imagePath: postImageUpload ? postImageUpload.url : null });
    $('#postContentInput').value = ''; $('#postContentInput').style.height = 'auto';
    postImageUpload = null; postFeeling = null; postLocation = null;
    $('#postImagePreview').classList.remove('visible');
    $('#postFeelingTag').classList.remove('visible');
    $('#postLocationTag').classList.remove('visible');
    $('#feedListV27').insertAdjacentHTML('afterbegin', renderPostCard(post));
    wirePostCard(post.id);
    syncPostButton();
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; }
}
async function loadFeed(reset) {
  if (feedLoading || (feedDone && !reset)) return;
  feedLoading = true;
  if (reset) { feedCursor = null; feedDone = false; $('#feedEndV27').hidden = true; }
  try {
    const { posts, nextCursor } = await api.get(`/api/posts?limit=10${feedCursor ? '&cursor=' + feedCursor : ''}`);
    if (reset) $('#feedListV27').innerHTML = '';
    if (reset && !posts.length && !nextCursor) {
      $('#feedListV27').innerHTML = `<div class="empty-state">${icon('home')}<h3>Welcome to Wirely 👋</h3><p>Follow people and start posting to fill your feed.</p></div>`;
    } else {
      posts.forEach((post) => { $('#feedListV27').insertAdjacentHTML('beforeend', renderPostCard(post)); wirePostCard(post.id); });
    }
    feedCursor = nextCursor;
    if (!nextCursor) { feedDone = true; $('#feedEndV27').hidden = posts.length === 0 && reset; }
  } catch (err) {
    if (reset) $('#feedListV27').innerHTML = `<div class="empty-state"><h3>Couldn't load your feed</h3><p>${escapeHtml(err.message)}</p></div>`;
  } finally { feedLoading = false; }
}

function renderPostCard(post) {
  return `
    <div class="post-card-v27" data-id="${post.id}" data-author-id="${post.author.id}">
      <div class="post-card-v27-header">
        ${renderAvatar(post.author)}
        <div class="post-card-v27-meta" data-role="open-profile">
          <div class="post-card-v27-name-row">${escapeHtml(post.author.display_name)}${badgeHtml(post.author.badge)}</div>
          <div class="post-card-v27-sub">@${escapeHtml(post.author.username)} · ${formatRelativeTime(post.created_at)}${post.edited_at ? ' · edited' : ''}</div>
        </div>
        ${!post.is_own ? `<button class="post-follow-btn ${post.author.is_following ? 'following' : ''}" data-role="follow">${post.author.is_following ? 'Following' : 'Follow'}</button>` : ''}
        <button class="post-card-menu-btn" data-role="menu">${icon('more')}</button>
      </div>
      <div class="post-card-v27-content" data-role="content">${escapeHtml(post.content)}</div>
      ${post.image_path ? `
        <div class="post-card-v27-media">
          <img src="${escapeHtml(post.image_path)}" alt="" data-role="post-image" />
          <div class="like-burst" data-role="like-burst">${icon('heartFilled')}</div>
        </div>` : ''}
      <div class="post-card-v27-footer">
        <button class="post-action-v27 ${post.liked_by_me ? 'liked' : ''}" data-role="like">${icon(post.liked_by_me ? 'heartFilled' : 'heart')} <span data-role="like-count">${post.like_count}</span></button>
        <button class="post-action-v27" data-role="comment-toggle">${icon('comment')} <span data-role="comment-count">${post.comment_count}</span></button>
        <button class="post-action-v27" data-role="share">${icon('share')}</button>
        <button class="post-action-v27 push-right ${post.saved_by_me ? 'saved' : ''}" data-role="save">${icon(post.saved_by_me ? 'saveFilled' : 'save')}</button>
      </div>
    </div>`;
}

function wirePostCard(postId) {
  const card = document.querySelector(`.post-card-v27[data-id="${postId}"]`);
  if (!card || card.dataset.wired) return;
  card.dataset.wired = '1';
  const post = { id: postId };

  const likeBtn = card.querySelector('[data-role="like"]');
  const doLike = async () => {
    const liked = likeBtn.classList.contains('liked');
    likeBtn.classList.toggle('liked', !liked);
    likeBtn.querySelector('.icon').outerHTML = icon(!liked ? 'heartFilled' : 'heart');
    vibrate(15);
    try {
      const res = await api[liked ? 'del' : 'post'](`/api/posts/${postId}/like`);
      card.querySelector('[data-role="like-count"]').textContent = res.like_count;
    } catch (err) { likeBtn.classList.toggle('liked', liked); }
  };
  likeBtn.addEventListener('click', doLike);

  const saveBtn = card.querySelector('[data-role="save"]');
  saveBtn.addEventListener('click', async () => {
    const saved = saveBtn.classList.contains('saved');
    saveBtn.classList.toggle('saved', !saved);
    saveBtn.querySelector('.icon').outerHTML = icon(!saved ? 'saveFilled' : 'save');
    try { await api[saved ? 'del' : 'post'](`/api/posts/${postId}/save`); } catch (err) { saveBtn.classList.toggle('saved', saved); }
  });

  card.querySelector('[data-role="share"]').addEventListener('click', () => {
    const url = `${window.location.origin}/chat.html?post=${postId}`;
    if (navigator.share) navigator.share({ title: 'Wirely post', url }).catch(() => {});
    else { navigator.clipboard && navigator.clipboard.writeText(url); alert('Link copied to clipboard.'); }
  });

  const commentToggle = card.querySelector('[data-role="comment-toggle"]');
  commentToggle.addEventListener('click', () => openCommentsSheet(postId));

  const followBtn = card.querySelector('[data-role="follow"]');
  if (followBtn) followBtn.addEventListener('click', async () => {
    const following = followBtn.classList.contains('following');
    try {
      await api[following ? 'del' : 'post'](`/api/users/${postAuthorIdOf(card)}/follow`);
      followBtn.classList.toggle('following', !following);
      followBtn.textContent = !following ? 'Following' : 'Follow';
    } catch (err) { /* ignore */ }
  });

  const profileTrigger = card.querySelector('[data-role="open-profile"]');
  if (profileTrigger) profileTrigger.addEventListener('click', () => openProfileView(postAuthorIdOf(card)));

  const menuBtn = card.querySelector('[data-role="menu"]');
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); openPostMenu(postId, card); });

  const img = card.querySelector('[data-role="post-image"]');
  if (img) img.addEventListener('click', () => openLightbox([img.src], 0));
}
function postAuthorIdOf(card) {
  return parseInt(card.dataset.authorId, 10);
}

// ---------- Comments bottom sheet ----------

function setupCommentsSheet() {
  const overlay = $('#commentsSheetOverlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCommentsSheet(); });
  $('#commentSheetSend').innerHTML = icon('send');
  $('#commentSheetSend').addEventListener('click', submitSheetComment);
  $('#commentSheetInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitSheetComment(); });
}
async function openCommentsSheet(postId) {
  activePostForSheet = postId;
  $('#commentsSheetOverlay').classList.add('visible');
  if (me) { const el = $('#commentComposerAvatar'); const a = avatarInner(me); el.style = a.style; el.innerHTML = a.html; }
  $('#commentsSheetBody').innerHTML = skeletonRows(3);
  try {
    const { comments } = await api.get(`/api/posts/${postId}/comments`);
    renderSheetComments(comments);
  } catch (err) { $('#commentsSheetBody').innerHTML = `<div class="empty-contacts">${escapeHtml(err.message)}</div>`; }
}
function closeCommentsSheet() { $('#commentsSheetOverlay').classList.remove('visible'); activePostForSheet = null; }
function renderSheetComments(comments) {
  const body = $('#commentsSheetBody');
  if (!comments.length) { body.innerHTML = `<div class="empty-state" style="padding:30px 10px;"><p>No comments yet. Be the first to say something.</p></div>`; return; }
  body.innerHTML = comments.map(c => `
    <div class="sheet-comment-row">
      ${renderAvatar(c)}
      <div class="sheet-comment-bubble">
        <b>${escapeHtml(c.display_name)}${badgeHtml(c.badge)}</b>
        <div class="sheet-comment-text">${escapeHtml(c.content)}</div>
        <div class="sheet-comment-actions"><button data-role="like-comment">Like</button><span>${formatRelativeTime(c.created_at)}</span></div>
      </div>
    </div>`).join('');
}
async function submitSheetComment() {
  const input = $('#commentSheetInput');
  const content = input.value.trim();
  if (!content || !activePostForSheet) return;
  try {
    const res = await api.post(`/api/posts/${activePostForSheet}/comments`, { content });
    input.value = '';
    renderSheetComments(res.comments);
    const card = document.querySelector(`.post-card-v27[data-id="${activePostForSheet}"]`);
    if (card) card.querySelector('[data-role="comment-count"]').textContent = res.comment_count;
  } catch (err) { alert(err.message); }
}

// ---------- Post menu bottom sheet ----------

function setupPostMenuSheet() {
  const overlay = $('#postMenuOverlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('visible'); });
}
function openPostMenu(postId, card) {
  activePostForMenu = { id: postId, card };
  const overlay = $('#postMenuOverlay');
  const body = $('#postMenuBody');
  const isOwn = card.querySelector('.post-follow-btn') === null;
  const authorId = postAuthorIdOf(card);

  if (isOwn) {
    body.innerHTML = `
      <button class="menu-row" data-a="edit">${icon('edit')} Edit</button>
      <button class="menu-row danger" data-a="delete">${icon('trash')} Delete</button>
      <button class="menu-row" data-a="copy-link">${icon('link')} Copy Link</button>`;
  } else {
    body.innerHTML = `
      <button class="menu-row" data-a="add-friend">${icon('users')} Add Friend</button>
      <button class="menu-row" data-a="follow">${icon('follow')} Follow</button>
      <button class="menu-row" data-a="copy-link">${icon('link')} Copy Link</button>
      <button class="menu-row" data-a="share">${icon('share')} Share</button>
      <button class="menu-row" data-a="hide">${icon('eyeOff')} Hide Post</button>
      <button class="menu-row danger" data-a="report-post">${icon('flag')} Report Post</button>
      <button class="menu-row danger" data-a="report-user">${icon('flag')} Report User</button>
      <button class="menu-row danger" data-a="block">${icon('block')} Block User</button>`;
  }

  body.querySelectorAll('.menu-row').forEach((btn) => {
    btn.addEventListener('click', () => handlePostMenuAction(btn.dataset.a, postId, card, authorId));
  });
  overlay.classList.add('visible');
}
async function handlePostMenuAction(action, postId, card, authorId) {
  $('#postMenuOverlay').classList.remove('visible');
  if (action === 'edit') {
    const contentEl = card.querySelector('[data-role="content"]');
    const newText = prompt('Edit your post:', contentEl.textContent);
    if (newText !== null && newText.trim()) {
      try { const { post } = await api.patch(`/api/posts/${postId}`, { content: newText.trim() }); contentEl.textContent = post.content; } catch (err) { alert(err.message); }
    }
  } else if (action === 'delete') {
    if (confirm('Delete this post?')) { try { await api.del(`/api/posts/${postId}`); card.remove(); } catch (err) { alert(err.message); } }
  } else if (action === 'copy-link' || action === 'share') {
    const url = `${window.location.origin}/chat.html?post=${postId}`;
    if (action === 'share' && navigator.share) navigator.share({ title: 'Wirely post', url }).catch(() => {});
    else { navigator.clipboard && navigator.clipboard.writeText(url); alert('Link copied to clipboard.'); }
  } else if (action === 'add-friend') {
    try { await api.post('/api/users/contacts/requests', { username: (await api.get(`/api/users/${authorId}/profile`)).user.username }); await loadRequests(); alert('Friend request sent.'); } catch (err) { alert(err.message); }
  } else if (action === 'follow') {
    try { await api.post(`/api/users/${authorId}/follow`); alert('You are now following this user.'); } catch (err) { alert(err.message); }
  } else if (action === 'hide') {
    try { await api.post(`/api/posts/${postId}/hide`); card.remove(); } catch (err) { alert(err.message); }
  } else if (action === 'report-post') {
    openReportModal('post', postId);
  } else if (action === 'report-user') {
    openReportModal('user', authorId);
  } else if (action === 'block') {
    if (confirm('Block this user?')) { try { await api.post(`/api/users/${authorId}/block`); card.remove(); await loadContacts(); } catch (err) { alert(err.message); } }
  }
}

// ---------- Notifications ----------

function setupNotifications() {
  $('#clearAllNotifsBtn').addEventListener('click', async () => {
    if (!confirm('Clear all notifications?')) return;
    await api.post('/api/notifications/read');
    notifUnread = 0; notifCache = [];
    updateNavBadges();
    $('#notifList').innerHTML = `<div class="empty-state"><h3>All clear</h3><p>Nothing to see here right now.</p></div>`;
  });
  $$('#notifCategoryTabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#notifCategoryTabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      notifCategory = btn.dataset.cat;
      renderNotifications();
    });
  });
}
const NOTIF_ICON = { friend_request: 'users', friend_accept: 'follow', like: 'heartFilled', comment: 'comment', message: 'chat' };
async function loadNotifications() {
  try {
    const { notifications, unread } = await api.get('/api/notifications');
    notifCache = notifications;
    notifUnread = 0;
    updateNavBadges();
    renderNotifications();
    if (unread > 0) setTimeout(() => api.post('/api/notifications/read').then(() => { notifCache = notifCache.map(n => ({ ...n, read: true })); }), 1200);
  } catch (err) { /* ignore */ }
}
function renderNotifications() {
  const list = $('#notifList');
  const filtered = notifCategory === 'all' ? notifCache : notifCache.filter(n => n.type === notifCategory || (notifCategory === 'friend_request' && n.type === 'friend_accept'));
  if (!filtered.length) { list.innerHTML = `<div class="empty-state"><h3>No notifications</h3><p>Likes, comments, friend activity, and messages will show up here.</p></div>`; return; }
  list.innerHTML = filtered.map(n => `
    <div class="notif-card ${n.read ? '' : 'unread'}" data-id="${n.id}" data-type="${n.type}" data-post="${n.post_id || ''}" data-actor="${n.actor ? n.actor.id : ''}">
      ${n.actor ? renderAvatar(n.actor) : `<div class="notif-icon">${icon(NOTIF_ICON[n.type] || 'bell')}</div>`}
      <div><div class="notif-text">${escapeHtml(n.label)}</div><div class="notif-time">${formatRelativeTime(n.created_at)}</div></div>
    </div>`).join('');
  list.querySelectorAll('.notif-card').forEach((card) => {
    card.addEventListener('click', () => {
      const type = card.dataset.type;
      const postId = card.dataset.post;
      const actorId = card.dataset.actor;
      card.classList.remove('unread');
      if ((type === 'like' || type === 'comment') && postId) {
        switchView('home');
        setTimeout(() => document.querySelector(`.post-card-v27[data-id="${postId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
      } else if ((type === 'friend_request' || type === 'friend_accept') && actorId) {
        openProfileView(parseInt(actorId, 10));
      } else if (type === 'message') {
        switchView('chats');
      }
    });
  });
}

// ---------- Me / Profile screen ----------

function setupMeView() {
  $('#editCoverBtn').innerHTML = `${icon('camera')} Edit`;
  $('#editCoverBtn').addEventListener('click', () => $('#coverFileInput').click());
  $('#coverFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData(); formData.append('cover', file);
    try { const { user } = await api.upload('/api/users/me/cover', formData); me = user; renderMeView(); } catch (err) { alert(err.message); }
  });
  $('#copyProfileLinkBtn').innerHTML = icon('copy');
  $('#copyProfileLinkBtn').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText(`wirely.app/@${me.username}`);
    alert('Profile link copied.');
  });
  $('#shareProfileBtn').addEventListener('click', () => {
    const url = `wirely.app/@${me.username}`;
    if (navigator.share) navigator.share({ title: 'My Wirely profile', text: url }).catch(() => {});
    else { navigator.clipboard && navigator.clipboard.writeText(url); alert('Profile link copied.'); }
  });
  $$('.profile-tab[data-metab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.profile-tab[data-metab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      meActiveTab = btn.dataset.metab;
      renderMePostsGrid();
    });
  });
  $$('.profile-stats-row button[data-stat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stat = btn.dataset.stat;
      if (stat === 'friends') { switchView('people'); }
      else if (stat === 'posts') { meActiveTab = 'posts'; renderMeTabsLabel(); renderMePostsGrid(); }
    });
  });
  renderMeTabsLabel();
}
function renderMeTabsLabel() {
  const tabs = $$('.profile-tab[data-metab]');
  tabs[0].innerHTML = `${icon('grid')} Posts`;
  tabs[1].innerHTML = `${icon('save')} Saved`;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.metab === meActiveTab));
}
async function loadMeView() {
  try {
    const data = await api.get(`/api/users/${me.id}/profile`);
    $('#statFriends').textContent = data.friend_count;
    $('#statFollowers').textContent = data.follower_count;
    $('#statFollowing').textContent = data.following_count;
    $('#statPosts').textContent = data.post_count;
  } catch (err) { /* ignore */ }
  renderMeView();
  renderMePostsGrid();
}
function renderMeView() {
  const a = avatarInner(me);
  $('#meAvatarLg').style = a.style; $('#meAvatarLg').innerHTML = a.html;
  $('#meName').innerHTML = `${escapeHtml(me.display_name)}${badgeHtml(me.badge)}`;
  $('#meUsername').textContent = `@${me.username}`;
  $('#meBio').textContent = me.bio || '';
  $('#meBio').style.display = me.bio ? '' : 'none';
  $('#meProfileLink').textContent = `wirely.app/@${me.username}`;
  if (me.cover_path) $('#meCover').style.backgroundImage = `url('${me.cover_path}')`;
  renderMyAvatar();
}
async function renderMePostsGrid() {
  const grid = $('#mePostsGrid');
  grid.innerHTML = skeletonPosts(2);
  try {
    if (meActiveTab === 'posts') {
      const { posts } = await api.get(`/api/posts?limit=30`);
      mePosts = posts.filter(p => p.is_own);
      renderGrid(mePosts);
    } else {
      const { posts } = await api.get(`/api/posts/saved`);
      meSavedPosts = posts;
      renderGrid(meSavedPosts);
    }
  } catch (err) { grid.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`; }
}
function renderGrid(posts) {
  const grid = $('#mePostsGrid');
  if (!posts.length) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><h3>Nothing here yet</h3><p>${meActiveTab === 'posts' ? 'Posts you share will appear here.' : 'Posts you save will appear here.'}</p></div>`; return; }
  grid.innerHTML = posts.map(p => `
    <div class="grid-post" data-id="${p.id}">
      ${p.image_path ? `<img src="${escapeHtml(p.image_path)}" alt="" />` : `<div class="text-post-preview">${escapeHtml(p.content).slice(0, 120)}</div>`}
    </div>`).join('');
  grid.querySelectorAll('.grid-post').forEach((el) => {
    el.addEventListener('click', () => {
      switchView('home');
      setTimeout(() => document.querySelector(`.post-card-v27[data-id="${el.dataset.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
    });
  });
}

// ---------- Universal search overlay ----------

let searchTab = 'people';
function setupSearchOverlay() {
  $('#openMeShortcutBtn').addEventListener('click', () => switchView('me'));
  $('#openSearchBtn').innerHTML = icon('search');
  $('#openSearchBtn').addEventListener('click', () => { $('#searchOverlay').classList.add('visible'); $('#globalSearchInput').focus(); });
  $('#closeSearchBtn').innerHTML = icon('back');
  $('#closeSearchBtn').addEventListener('click', () => { $('#searchOverlay').classList.remove('visible'); $('#globalSearchInput').value = ''; $('#searchResults').innerHTML = ''; });
  $$('.search-tab[data-stab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.search-tab[data-stab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      searchTab = btn.dataset.stab;
      runGlobalSearch();
    });
  });
  $('#globalSearchInput').addEventListener('input', debounce(runGlobalSearch, 300));
}
async function runGlobalSearch() {
  const q = $('#globalSearchInput').value.trim();
  const results = $('#searchResults');
  if (!q) { results.innerHTML = ''; return; }
  results.innerHTML = skeletonRows(3);
  try {
    const { people, posts } = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
    if (searchTab === 'people') {
      results.innerHTML = people.length ? people.map(u => `
        <div class="search-result-item" data-id="${u.id}">
          ${renderAvatar(u)}
          <div class="search-result-meta"><div class="search-result-name">${escapeHtml(u.display_name)}${badgeHtml(u.badge)}</div><div class="search-result-username">@${escapeHtml(u.username)}</div></div>
        </div>`).join('') : `<div class="empty-state"><h3>No results</h3><p>Try a different search.</p></div>`;
      results.querySelectorAll('.search-result-item').forEach((el) => el.addEventListener('click', () => { openProfileView(parseInt(el.dataset.id, 10)); }));
    } else {
      results.innerHTML = posts.length ? posts.map(p => `
        <div class="search-result-item" data-id="${p.id}" style="align-items:flex-start;">
          ${renderAvatar(p.author)}
          <div class="search-result-meta"><div class="search-result-name">${escapeHtml(p.author.display_name)}${badgeHtml(p.author.badge)}</div><div style="font-size:12.5px;color:var(--text-muted);">${escapeHtml(p.content).slice(0, 100)}</div></div>
        </div>`).join('') : `<div class="empty-state"><h3>No posts found</h3><p>Try searching a different term or #hashtag.</p></div>`;
      results.querySelectorAll('.search-result-item').forEach((el) => el.addEventListener('click', () => {
        $('#searchOverlay').classList.remove('visible');
        switchView('home');
        setTimeout(() => document.querySelector(`.post-card-v27[data-id="${el.dataset.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
      }));
    }
  } catch (err) { results.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`; }
}

// ---------- Onboarding (first launch) ----------

let onboardingStep = 0;
let onboardingData = { displayName: '', bio: '', birthday: '', country: '', interests: [], privacy: 'public' };
const ONBOARDING_STEPS = 3;

function startOnboarding() {
  onboardingData.displayName = me.display_name;
  onboardingStep = 0;
  renderOnboardingStep();
  $('#onboardingOverlay').classList.add('visible');
  $('#onboardingNextBtn').addEventListener('click', onboardingNext);
  $('#onboardingBackBtn').addEventListener('click', onboardingBack);
}
function renderOnboardingProgress() {
  $('#onboardingProgress').innerHTML = Array.from({ length: ONBOARDING_STEPS }).map((_, i) => `<div class="step-dot ${i <= onboardingStep ? 'done' : ''}"></div>`).join('');
  $('#onboardingBackBtn').hidden = onboardingStep === 0;
  $('#onboardingNextBtn').textContent = onboardingStep === ONBOARDING_STEPS - 1 ? 'Finish' : 'Next';
}
function renderOnboardingStep() {
  renderOnboardingProgress();
  const body = $('#onboardingBody');
  if (onboardingStep === 0) {
    body.innerHTML = `
      <div class="onboarding-avatar-picker">${renderAvatar(me, 'avatar-lg')}</div>
      <h2>Welcome to Wirely, ${escapeHtml(me.display_name)} 👋</h2>
      <p class="sub">Let's set up your profile. You can change any of this later.</p>
      <div class="field"><label>Display name</label><input type="text" id="obDisplayName" value="${escapeHtml(onboardingData.displayName)}" maxlength="40" /></div>
      <div class="field"><label>Bio</label><textarea id="obBio" rows="3" maxlength="200" placeholder="Tell people a bit about yourself…">${escapeHtml(onboardingData.bio)}</textarea></div>
    `;
    $('#obDisplayName').addEventListener('input', (e) => onboardingData.displayName = e.target.value);
    $('#obBio').addEventListener('input', (e) => onboardingData.bio = e.target.value);
  } else if (onboardingStep === 1) {
    body.innerHTML = `
      <h2>A little more about you</h2>
      <p class="sub">Birthday and country help us personalize your experience.</p>
      <div class="field"><label>${icon('cake')} Birthday</label><input type="date" id="obBirthday" value="${escapeHtml(onboardingData.birthday)}" /></div>
      <div class="field"><label>${icon('globe')} Country</label><input type="text" id="obCountry" value="${escapeHtml(onboardingData.country)}" placeholder="e.g. United States" maxlength="60" /></div>
      <div class="field"><label>${icon('lock')} Privacy</label>
        <select id="obPrivacy" style="width:100%;padding:11px 12px;background:var(--ink);border:1px solid rgba(143,163,170,0.2);border-radius:8px;color:var(--text-primary);">
          <option value="public" ${onboardingData.privacy === 'public' ? 'selected' : ''}>Public account</option>
          <option value="private" ${onboardingData.privacy === 'private' ? 'selected' : ''}>Private account</option>
        </select>
      </div>
    `;
    $('#obBirthday').addEventListener('input', (e) => onboardingData.birthday = e.target.value);
    $('#obCountry').addEventListener('input', (e) => onboardingData.country = e.target.value);
    $('#obPrivacy').addEventListener('change', (e) => onboardingData.privacy = e.target.value);
  } else if (onboardingStep === 2) {
    body.innerHTML = `
      <h2>${icon('interests')} What are you into?</h2>
      <p class="sub">Pick a few interests — helps us suggest people and posts you'll like.</p>
      <div class="onboarding-interest-grid">${INTERESTS_LIST.map(i => `<button type="button" class="onboarding-interest-chip ${onboardingData.interests.includes(i) ? 'selected' : ''}" data-i="${i}">${i}</button>`).join('')}</div>
      <div class="settings-section-title">Theme</div>
      <div class="theme-grid" id="onboardingThemeGrid"></div>
    `;
    body.querySelectorAll('.onboarding-interest-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const val = chip.dataset.i;
        if (onboardingData.interests.includes(val)) onboardingData.interests = onboardingData.interests.filter(x => x !== val);
        else onboardingData.interests.push(val);
        chip.classList.toggle('selected');
      });
    });
    const grid = $('#onboardingThemeGrid');
    const current = document.documentElement.getAttribute('data-theme');
    grid.innerHTML = THEMES.map(t => `<button type="button" class="theme-swatch ${t.id === current ? 'active' : ''}" data-theme-id="${t.id}"><span class="theme-swatch-dot" style="background:${t.dot}"></span><span>${escapeHtml(t.label)}</span></button>`).join('');
    grid.querySelectorAll('.theme-swatch').forEach((btn) => btn.addEventListener('click', () => {
      document.documentElement.setAttribute('data-theme', btn.dataset.themeId);
      localStorage.setItem('wirely-theme', btn.dataset.themeId);
      grid.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }));
  }
}
function onboardingBack() { if (onboardingStep > 0) { onboardingStep--; renderOnboardingStep(); } }
async function onboardingNext() {
  if (onboardingStep < ONBOARDING_STEPS - 1) { onboardingStep++; renderOnboardingStep(); return; }
  try {
    await api.patch('/api/users/me', { displayName: onboardingData.displayName || me.display_name, bio: onboardingData.bio });
    const { user } = await api.post('/api/users/me/onboarding', {
      birthday: onboardingData.birthday, country: onboardingData.country, interests: onboardingData.interests, privacy: onboardingData.privacy
    });
    me = user;
    renderMyAvatar();
    $('#onboardingOverlay').classList.remove('visible');
    switchView('people');
    loadDiscover();
    if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
  } catch (err) { alert(err.message); }
}

bootstrap();
