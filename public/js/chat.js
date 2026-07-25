let me = null;
let socket = null;
let activeContact = null;
let contactsCache = [];
let incomingRequests = [];
let outgoingRequests = [];
let replyingTo = null;
let editingMessageId = null;
let unreadTotal = 0;
let mediaRecorder = null;
let recordedChunks = [];
let recordStartedAt = null;
let onlineSet = new Set();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const sidebarEl = $('#sidebar');
const conversationEl = $('#conversation');
const contactListEl = $('#contactList');
const requestsListEl = $('#requestsList');
const requestBadge = $('#requestBadge');

// ---------- Small helpers ----------

function initials(name) {
  return (name || '?').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

function avatarInner(user) {
  if (user && user.avatar_path) {
    return { style: `background-image:url('${escapeHtml(user.avatar_path)}')`, html: '' };
  }
  return { style: '', html: `<span>${escapeHtml(initials(user ? user.display_name : ''))}</span>` };
}

function renderAvatar(user, extraClass = '') {
  const a = avatarInner(user);
  return `<div class="avatar ${extraClass}" style="${a.style}">${a.html}</div>`;
}

function toDate(iso) {
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z');
}

function formatTime(iso) {
  return toDate(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatPreviewTime(iso) {
  const d = toDate(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDateHeading(iso) {
  const d = toDate(iso);
  const now = new Date();
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
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (_) { /* audio not available */ }
}

function updateTitleBadge() {
  document.title = unreadTotal > 0 ? `(${unreadTotal > 99 ? '99+' : unreadTotal}) Wire` : 'Wire';
}

function notifyIncoming(senderName, content) {
  if (document.visibilityState === 'visible' && activeContact) return;
  playNotifySound();
  if (window.Notification && Notification.permission === 'granted') {
    try { new Notification(senderName, { body: content, tag: 'wire-message' }); } catch (_) {}
  }
}

// ---------- Theme ----------

function initTheme() {
  const saved = localStorage.getItem('wire-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  $('#themeToggleBtn').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('wire-theme', next);
  });
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
  renderMyAvatar();
  connectSocket();
  await Promise.all([loadContacts(), loadRequests()]);
  setupTabs();
  setupNewChatModal();
  setupProfileModal();
  setupForwardModal();
  setupChatSearch();

  if (window.Notification && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission(), { once: true });
  }
}

function renderMyAvatar() {
  const el = $('#myAvatar');
  const a = avatarInner(me);
  el.style = a.style;
  el.innerHTML = a.html;
}

function connectSocket() {
  socket = io({ withCredentials: true });

  socket.on('connect_error', (err) => {
    if (err && err.message === 'unauthorized') window.location.href = '/index.html';
  });

  socket.on('new_message', (message) => {
    const otherId = message.sender_id === me.id ? message.receiver_id : message.sender_id;

    if (activeContact && activeContact.id === otherId) {
      appendMessage(message);
      scrollMessagesToBottom();
      socket.emit('mark_read', { contactId: otherId });
    } else if (message.sender_id !== me.id) {
      bumpUnread(otherId);
      const c = contactsCache.find(x => x.id === otherId);
      notifyIncoming(c ? c.display_name : 'New message', previewFor(message));
    }
    updateContactPreview(otherId, previewFor(message), message.created_at);
  });

  socket.on('message_edited', (message) => {
    const el = document.querySelector(`.msg-row[data-id="${message.id}"] .bubble-content`);
    if (el) el.textContent = message.content;
    const editedTag = document.querySelector(`.msg-row[data-id="${message.id}"] .bubble-edited`);
    if (editedTag) editedTag.hidden = false;
    if (activeContact && (message.sender_id === activeContact.id || message.receiver_id === activeContact.id)) {
      updateContactPreview(activeContact.id, message.content, message.created_at);
    }
  });

  socket.on('message_deleted', ({ id }) => {
    const row = document.querySelector(`.msg-row[data-id="${id}"]`);
    if (row) {
      row.classList.add('deleted-row');
      const bubble = row.querySelector('.bubble');
      bubble.classList.add('deleted');
      bubble.innerHTML = '<span class="bubble-content">This message was deleted</span>';
      const actions = row.querySelector('.msg-actions');
      if (actions) actions.remove();
    }
  });

  socket.on('messages_delivered', ({ toUserId, ids }) => {
    ids.forEach((id) => {
      const tickEl = document.querySelector(`.msg-row[data-id="${id}"] .ticks`);
      if (tickEl) tickEl.textContent = '✓✓';
    });
  });

  socket.on('messages_read', ({ byUserId, ids }) => {
    ids.forEach((id) => {
      const tickEl = document.querySelector(`.msg-row[data-id="${id}"] .ticks`);
      if (tickEl) { tickEl.textContent = '✓✓'; tickEl.classList.add('read'); }
    });
  });

  socket.on('presence', ({ userId, online, lastSeen }) => {
    if (online) onlineSet.add(userId); else onlineSet.delete(userId);
    const dot = document.querySelector(`.contact-item[data-id="${userId}"] .presence-dot`);
    if (dot) dot.classList.toggle('online', online);
    if (activeContact && activeContact.id === userId) {
      const statusEl = $('#convStatus');
      if (statusEl) statusEl.textContent = online ? 'Online' : (lastSeen ? `Last seen ${formatPreviewTime(lastSeen)}` : 'Offline');
    }
  });

  socket.on('typing', ({ fromUserId }) => {
    if (activeContact && activeContact.id === fromUserId) {
      const indicator = $('#typingIndicator');
      if (!indicator) return;
      indicator.textContent = `${activeContact.display_name} is typing…`;
    }
  });

  socket.on('stop_typing', ({ fromUserId }) => {
    if (activeContact && activeContact.id === fromUserId) {
      const indicator = $('#typingIndicator');
      if (indicator) indicator.textContent = '';
    }
  });
}

function previewFor(message) {
  if (message.deleted_at) return 'This message was deleted';
  if (message.type === 'image') return 'Photo';
  if (message.type === 'voice') return 'Voice message';
  if (message.type === 'file') return 'File';
  return message.content;
}

// ---------- Tabs ----------

function setupTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      contactListEl.hidden = tab !== 'chats';
      requestsListEl.hidden = tab !== 'requests';
    });
  });
}

// ---------- Contacts / Chat list ----------

async function loadContacts() {
  const { contacts } = await api.get('/api/users/contacts');
  contactsCache = contacts;
  contacts.forEach(c => { if (c.last_seen) {} });
  renderContacts();
}

function renderContacts(filter = '') {
  const list = contactsCache
    .slice()
    .filter(c => !filter || c.display_name.toLowerCase().includes(filter) || c.username.toLowerCase().includes(filter))
    .sort((a, b) => new Date(b.lastMessageAt || b.created_at || 0) - new Date(a.lastMessageAt || a.created_at || 0));

  unreadTotal = contactsCache.reduce((sum, c) => sum + (c.unread || 0), 0);
  updateTitleBadge();

  if (!list.length) {
    contactListEl.innerHTML = `<div class="empty-contacts">${
      filter ? 'No chats match your search.' : 'No chats yet.<br>Tap the + button to add someone by username.'
    }</div>`;
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
          <div class="contact-name">${escapeHtml(c.display_name)}</div>
          <div class="contact-time">${c.lastMessageAt ? formatPreviewTime(c.lastMessageAt) : ''}</div>
        </div>
        <div class="contact-preview-row">
          <div class="contact-preview">${escapeHtml(c.lastMessage || 'Say hello \u2014 no messages yet')}</div>
          ${c.unread ? `<div class="unread-badge">${c.unread > 9 ? '9+' : c.unread}</div>` : ''}
        </div>
      </div>
    `;
    const dot = item.querySelector('.avatar');
    const dotEl = document.createElement('span');
    dotEl.className = 'presence-dot' + (onlineSet.has(c.id) ? ' online' : '');
    dot.appendChild(dotEl);
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
  $('#chatSearchInput').addEventListener('input', (e) => {
    renderContacts(e.target.value.trim().toLowerCase());
  });
}

// ---------- Contact requests ----------

async function loadRequests() {
  const { incoming, outgoing } = await api.get('/api/users/contacts/requests');
  incomingRequests = incoming;
  outgoingRequests = outgoing;
  requestBadge.hidden = incoming.length === 0;
  requestBadge.textContent = incoming.length;
  renderRequests();
}

function renderRequests() {
  if (!incomingRequests.length && !outgoingRequests.length) {
    requestsListEl.innerHTML = `<div class="empty-contacts">No pending requests.</div>`;
    return;
  }
  requestsListEl.innerHTML = '';
  incomingRequests.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'request-item';
    row.innerHTML = `
      ${renderAvatar(r)}
      <div class="contact-meta">
        <div class="contact-name">${escapeHtml(r.display_name)}</div>
        <div class="request-tag">@${escapeHtml(r.username)} wants to connect</div>
      </div>
      <div class="request-actions">
        <button class="btn-accept" data-id="${r.request_id}">Accept</button>
        <button class="btn-decline" data-id="${r.request_id}">Decline</button>
      </div>
    `;
    row.querySelector('.btn-accept').addEventListener('click', () => respondToRequest(r.request_id, 'accept'));
    row.querySelector('.btn-decline').addEventListener('click', () => respondToRequest(r.request_id, 'decline'));
    requestsListEl.appendChild(row);
  });
  outgoingRequests.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'request-item';
    row.innerHTML = `
      ${renderAvatar(r)}
      <div class="contact-meta">
        <div class="contact-name">${escapeHtml(r.display_name)}</div>
        <div class="request-tag">Request sent \u2014 waiting</div>
      </div>
    `;
    requestsListEl.appendChild(row);
  });
}

async function respondToRequest(requestId, action) {
  try {
    await api.post(`/api/users/contacts/requests/${requestId}/${action}`);
    await Promise.all([loadRequests(), loadContacts()]);
  } catch (err) {
    alert(err.message);
  }
}

// ---------- New chat modal (search users) ----------

function setupNewChatModal() {
  const modal = $('#newChatModal');
  const input = $('#userSearchInput');
  const results = $('#userSearchResults');
  let debounceTimer = null;

  $('#newChatFab').addEventListener('click', () => {
    modal.hidden = false;
    input.value = '';
    results.innerHTML = '';
    input.focus();
  });
  $('#closeNewChatModal').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    debounceTimer = setTimeout(async () => {
      try {
        const { users } = await api.get(`/api/users/search?q=${encodeURIComponent(q)}`);
        renderUserSearchResults(users, results);
      } catch (err) {
        results.innerHTML = `<div class="no-results">${escapeHtml(err.message)}</div>`;
      }
    }, 300);
  });
}

function renderUserSearchResults(users, container) {
  if (!users.length) {
    container.innerHTML = `<div class="no-results">No users found.</div>`;
    return;
  }
  container.innerHTML = '';
  users.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'search-result-item';
    let actionHtml = '';
    if (u.relationship === 'accepted') actionHtml = `<button class="search-result-action action-message">Message</button>`;
    else if (u.relationship === 'pending_sent') actionHtml = `<button class="search-result-action action-pending" disabled>Pending</button>`;
    else if (u.relationship === 'pending_received') actionHtml = `<button class="search-result-action action-add">Accept</button>`;
    else actionHtml = `<button class="search-result-action action-add">Add</button>`;

    row.innerHTML = `
      ${renderAvatar(u)}
      <div class="search-result-meta">
        <div class="search-result-name">${escapeHtml(u.display_name)}</div>
        <div class="search-result-username">@${escapeHtml(u.username)}</div>
      </div>
      ${actionHtml}
    `;
    const btn = row.querySelector('button');
    if (btn && u.relationship === 'accepted') {
      btn.addEventListener('click', async () => {
        $('#newChatModal').hidden = true;
        await loadContacts();
        const c = contactsCache.find(x => x.id === u.id);
        if (c) openConversation(c);
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
          $('#newChatModal').hidden = true;
          await Promise.all([loadRequests(), loadContacts()]);
        } catch (err) { alert(err.message); }
      });
    }
    container.appendChild(row);
  });
}

// ---------- Profile modal ----------

function setupProfileModal() {
  const modal = $('#profileModal');
  $('#openProfileBtn').addEventListener('click', () => {
    $('#profileDisplayName').value = me.display_name;
    $('#profileBio').value = me.bio || '';
    $('#profileUsernameHint').textContent = `@${me.username}`;
    const preview = $('#profileAvatarPreview');
    const a = avatarInner(me);
    preview.style = a.style;
    preview.innerHTML = a.html;
    $('#profileError').classList.remove('visible');
    modal.hidden = false;
  });
  $('#closeProfileModal').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

  $('#avatarFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('avatar', file);
    try {
      const { user } = await api.upload('/api/users/me/avatar', formData);
      me = user;
      renderMyAvatar();
      const preview = $('#profileAvatarPreview');
      const a = avatarInner(me);
      preview.style = a.style;
      preview.innerHTML = a.html;
      renderContacts();
    } catch (err) {
      $('#profileError').textContent = err.message;
      $('#profileError').classList.add('visible');
    }
  });

  $('#saveProfileBtn').addEventListener('click', async () => {
    const displayName = $('#profileDisplayName').value.trim();
    const bio = $('#profileBio').value.trim();
    try {
      const { user } = await api.patch('/api/users/me', { displayName, bio });
      me = user;
      renderMyAvatar();
      modal.hidden = true;
    } catch (err) {
      $('#profileError').textContent = err.message;
      $('#profileError').classList.add('visible');
    }
  });
}

// ---------- Forward modal ----------

let forwardingMessage = null;

function setupForwardModal() {
  const modal = $('#forwardModal');
  $('#closeForwardModal').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
}

function openForwardModal(message) {
  forwardingMessage = message;
  const modal = $('#forwardModal');
  const list = $('#forwardContactList');
  list.innerHTML = '';
  contactsCache.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'search-result-item';
    row.innerHTML = `
      ${renderAvatar(c)}
      <div class="search-result-meta">
        <div class="search-result-name">${escapeHtml(c.display_name)}</div>
        <div class="search-result-username">@${escapeHtml(c.username)}</div>
      </div>
      <button class="search-result-action action-message">Send</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      forwardTo(c.id);
      modal.hidden = true;
    });
    list.appendChild(row);
  });
  modal.hidden = false;
}

function forwardTo(contactId) {
  if (!forwardingMessage) return;
  const payload = {
    toUserId: contactId,
    content: forwardingMessage.content,
    type: forwardingMessage.type,
    replyToId: null
  };
  if (forwardingMessage.type !== 'text') {
    payload.attachment = {
      url: forwardingMessage.attachment_path,
      name: forwardingMessage.attachment_name,
      mime: forwardingMessage.attachment_mime,
      size: forwardingMessage.attachment_size
    };
  }
  socket.emit('send_message', payload, (response) => {
    if (response && response.ok) {
      updateContactPreview(contactId, previewFor(response.message), response.message.created_at);
      if (activeContact && activeContact.id === contactId) {
        appendMessage(response.message);
        scrollMessagesToBottom();
      }
    }
  });
}

// ---------- Conversation ----------

async function openConversation(contact) {
  activeContact = contact;
  replyingTo = null;
  editingMessageId = null;
  renderContacts($('#chatSearchInput').value.trim().toLowerCase());

  if (window.matchMedia('(max-width: 780px)').matches) {
    sidebarEl.classList.add('hide-mobile');
    conversationEl.classList.add('show-mobile');
  }

  conversationEl.innerHTML = `
    <div class="conversation-header">
      <button class="icon-btn back-btn" id="backBtn">&#8592;</button>
      <div class="conversation-header-meta">
        ${renderAvatar(contact)}
      </div>
      <div class="conversation-header-meta" style="display:flex;flex-direction:column;justify-content:center;">
        <div class="contact-name">${escapeHtml(contact.display_name)}</div>
        <div class="conversation-status" id="convStatus">${onlineSet.has(contact.id) ? 'Online' : '@' + escapeHtml(contact.username)}</div>
      </div>
      <div class="conversation-header-actions">
        <button class="icon-btn" id="convSearchBtn" title="Search in chat">&#128269;</button>
        <button class="icon-btn" id="removeContactBtn" title="Remove contact">&#128465;</button>
      </div>
    </div>
    <div class="conv-search-bar" id="convSearchBar">
      <input type="text" id="convSearchInput" placeholder="Search messages…" />
    </div>
    <div class="messages" id="messages"></div>
    <div class="typing-indicator" id="typingIndicator"></div>
    <div class="reply-preview-bar" id="replyBar">
      <div class="reply-preview-content" id="replyBarContent"></div>
      <button class="reply-preview-close" id="replyBarClose">&times;</button>
    </div>
    <form class="composer" id="composerForm">
      <button type="button" class="composer-btn" id="attachBtn" title="Attach">&#128206;</button>
      <input type="file" id="fileInput" hidden />
      <button type="button" class="composer-btn" id="emojiBtn" title="Emoji">&#128512;</button>
      <textarea id="messageInput" rows="1" placeholder="Write a message…" maxlength="4000"></textarea>
      <button type="button" class="composer-btn" id="voiceBtn" title="Record voice note">&#127908;</button>
      <button type="submit" class="send-btn" id="sendBtn">&#10148;</button>
    </form>
    <div class="emoji-picker" id="emojiPicker"></div>
  `;

  $('#backBtn').addEventListener('click', () => {
    sidebarEl.classList.remove('hide-mobile');
    conversationEl.classList.remove('show-mobile');
  });
  $('#removeContactBtn').addEventListener('click', () => removeContact(contact.id));
  $('#convSearchBtn').addEventListener('click', () => {
    const bar = $('#convSearchBar');
    bar.classList.toggle('visible');
    if (bar.classList.contains('visible')) $('#convSearchInput').focus();
  });
  $('#convSearchInput').addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    if (!q) { renderMessagesList(await api.get(`/api/messages/${contact.id}`).then(r => r.messages)); return; }
    const { messages } = await api.get(`/api/messages/${contact.id}/search?q=${encodeURIComponent(q)}`);
    renderMessagesList(messages.reverse(), { highlight: q });
  }, 300));

  buildEmojiPicker();

  const { messages } = await api.get(`/api/messages/${contact.id}`);
  renderMessagesList(messages);
  scrollMessagesToBottom();
  socket.emit('mark_read', { contactId: contact.id });

  const c = contactsCache.find(x => x.id === contact.id);
  if (c) c.unread = 0;
  renderContacts($('#chatSearchInput').value.trim().toLowerCase());

  setupComposer(contact);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function renderMessagesList(messages, opts = {}) {
  const messagesEl = $('#messages');
  if (!messagesEl) return;
  messagesEl.innerHTML = '';
  let lastDateKey = null;
  messages.forEach((message) => {
    const dateKey = toDate(message.created_at).toDateString();
    if (dateKey !== lastDateKey) {
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      sep.innerHTML = `<span>${formatDateHeading(message.created_at)}</span>`;
      messagesEl.appendChild(sep);
      lastDateKey = dateKey;
    }
    appendMessage(message, { skipScroll: true });
  });
}

function buildEmojiPicker() {
  const picker = $('#emojiPicker');
  picker.innerHTML = EMOJI_LIST.map(e => `<button type="button">${e}</button>`).join('');
  $('#emojiBtn').addEventListener('click', () => picker.classList.toggle('visible'));
  picker.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
      const input = $('#messageInput');
      input.value += e.target.textContent;
      input.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && e.target.id !== 'emojiBtn') picker.classList.remove('visible');
  });
}

function bubbleContentHtml(message) {
  if (message.deleted_at) return `<span class="bubble-content">This message was deleted</span>`;

  let replyHtml = '';
  if (message.reply_preview) {
    const senderLabel = message.reply_preview.sender_id === me.id ? 'You' : (activeContact ? activeContact.display_name : '');
    const snippet = message.reply_preview.type !== 'text' ? previewFor(message.reply_preview) : message.reply_preview.content;
    replyHtml = `<div class="bubble-reply"><span class="bubble-reply-sender">${escapeHtml(senderLabel)}</span>${escapeHtml(snippet).slice(0, 120)}</div>`;
  }

  let mediaHtml = '';
  if (message.type === 'image') {
    mediaHtml = `<img class="attachment-image" src="${escapeHtml(message.attachment_path)}" alt="Shared image" />`;
  } else if (message.type === 'voice') {
    mediaHtml = `<div class="attachment-voice"><audio controls src="${escapeHtml(message.attachment_path)}"></audio></div>`;
  } else if (message.type === 'file') {
    mediaHtml = `<a class="attachment-file" href="${escapeHtml(message.attachment_path)}" target="_blank" rel="noopener">
        <span class="attachment-file-icon">&#128196;</span>
        <span>
          <span class="attachment-file-name">${escapeHtml(message.attachment_name || 'File')}</span><br>
          <span class="attachment-file-size">${fileSizeLabel(message.attachment_size)}</span>
        </span>
      </a>`;
  }

  const textHtml = message.content ? `<span class="bubble-content">${escapeHtml(message.content)}</span>` : '';
  return replyHtml + mediaHtml + textHtml;
}

function renderTicksHtml(message) {
  if (message.sender_id !== me.id) return '';
  let mark = '✓';
  let cls = 'ticks';
  if (message.read_at) { mark = '✓✓'; cls += ' read'; }
  else if (message.delivered_at) { mark = '✓✓'; }
  return `<span class="${cls}">${mark}</span>`;
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
      <button type="button" data-action="reply" title="Reply">&#8617;</button>
      <button type="button" data-action="copy" title="Copy">&#128203;</button>
      <button type="button" data-action="forward" title="Forward">&#10148;</button>
      ${mine && message.type === 'text' ? `<button type="button" data-action="edit" title="Edit">&#9998;</button>` : ''}
      ${mine ? `<button type="button" data-action="delete" title="Delete">&#128465;</button>` : ''}
    </div>`;

  row.innerHTML = `
    <div class="msg-row-inner">
      ${actionsHtml}
      <div class="bubble ${message.deleted_at ? 'deleted' : ''}">
        ${bubbleContentHtml(message)}
        <div class="bubble-footer">
          <span class="bubble-edited" ${message.edited_at ? '' : 'hidden'}>edited</span>
          <span class="bubble-time">${formatTime(message.created_at)}</span>
          ${renderTicksHtml(message)}
        </div>
      </div>
    </div>
  `;

  row.querySelectorAll('.msg-actions button').forEach((btn) => {
    btn.addEventListener('click', () => handleMessageAction(btn.dataset.action, message));
  });

  const replyEl = row.querySelector('.bubble-reply');
  if (replyEl) {
    replyEl.addEventListener('click', () => {
      const target = document.querySelector(`.msg-row[data-id="${message.reply_preview.id}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  messagesEl.appendChild(row);
  if (!opts.skipScroll) scrollMessagesToBottom();
}

function handleMessageAction(action, message) {
  if (action === 'reply') startReply(message);
  else if (action === 'copy') {
    const text = message.type === 'text' ? message.content : previewFor(message);
    navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
  } else if (action === 'forward') openForwardModal(message);
  else if (action === 'edit') startEdit(message);
  else if (action === 'delete') {
    if (confirm('Delete this message?')) {
      socket.emit('delete_message', { messageId: message.id }, (res) => {
        if (res && !res.ok) alert(res.error);
      });
    }
  }
}

function startReply(message) {
  replyingTo = message;
  editingMessageId = null;
  const bar = $('#replyBar');
  bar.classList.add('visible');
  const senderLabel = message.sender_id === me.id ? 'You' : activeContact.display_name;
  $('#replyBarContent').innerHTML = `<b>${escapeHtml(senderLabel)}</b>${escapeHtml(message.type === 'text' ? message.content : previewFor(message)).slice(0, 100)}`;
  $('#messageInput').focus();
}

function startEdit(message) {
  editingMessageId = message.id;
  replyingTo = null;
  const bar = $('#replyBar');
  bar.classList.add('visible');
  $('#replyBarContent').innerHTML = `<b>Editing message</b>${escapeHtml(message.content).slice(0, 100)}`;
  const input = $('#messageInput');
  input.value = message.content;
  input.focus();
}

function cancelComposerContext() {
  replyingTo = null;
  editingMessageId = null;
  $('#replyBar').classList.remove('visible');
}

function scrollMessagesToBottom() {
  const messagesEl = $('#messages');
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function removeContact(contactId) {
  if (!confirm('Remove this contact? Your message history stays, but they will be removed from your chat list.')) return;
  try {
    await api.del(`/api/users/contacts/${contactId}`);
    activeContact = null;
    conversationEl.innerHTML = `<div class="no-conversation">Select a chat, or tap the + button to start a new conversation.</div>`;
    await loadContacts();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Composer: text, typing, attachments, voice ----------

function setupComposer(contact) {
  const composerForm = $('#composerForm');
  const messageInput = $('#messageInput');
  const fileInput = $('#fileInput');
  let typingActive = false;
  let typingStopTimer = null;

  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';

    if (!typingActive) {
      typingActive = true;
      socket.emit('typing', { toUserId: contact.id });
    }
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => {
      typingActive = false;
      socket.emit('stop_typing', { toUserId: contact.id });
    }, 1500);
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composerForm.requestSubmit();
    }
    if (e.key === 'Escape') cancelComposerContext();
  });

  $('#replyBarClose').addEventListener('click', cancelComposerContext);

  composerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const content = messageInput.value.trim();
    if (!content) return;

    if (editingMessageId) {
      socket.emit('edit_message', { messageId: editingMessageId, content }, (res) => {
        if (!res || !res.ok) alert((res && res.error) || 'Edit failed.');
      });
      cancelComposerContext();
      messageInput.value = '';
      messageInput.style.height = 'auto';
      return;
    }

    sendTextMessage(contact.id, content, replyingTo ? replyingTo.id : null);
    cancelComposerContext();
    messageInput.value = '';
    messageInput.style.height = 'auto';
    messageInput.focus();
  });

  $('#attachBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    await sendAttachment(contact.id, file);
  });

  $('#voiceBtn').addEventListener('click', () => toggleVoiceRecording(contact.id));
}

function sendTextMessage(toUserId, content, replyToId) {
  const sendBtn = $('#sendBtn');
  sendBtn.disabled = true;
  socket.emit('send_message', { toUserId, content, type: 'text', replyToId }, (response) => {
    sendBtn.disabled = false;
    if (!response || !response.ok) {
      alert((response && response.error) || 'Message failed to send.');
      return;
    }
    appendMessage(response.message);
    updateContactPreview(toUserId, previewFor(response.message), response.message.created_at);
  });
}

async function sendAttachment(toUserId, file) {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const uploaded = await api.upload('/api/upload', formData);
    socket.emit('send_message', {
      toUserId,
      content: '',
      type: uploaded.kind,
      attachment: { url: uploaded.url, name: uploaded.name, mime: uploaded.mime, size: uploaded.size },
      replyToId: replyingTo ? replyingTo.id : null
    }, (response) => {
      if (!response || !response.ok) {
        alert((response && response.error) || 'Failed to send attachment.');
        return;
      }
      appendMessage(response.message);
      updateContactPreview(toUserId, previewFor(response.message), response.message.created_at);
      cancelComposerContext();
    });
  } catch (err) {
    alert(err.message);
  }
}

async function toggleVoiceRecording(toUserId) {
  const btn = $('#voiceBtn');
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      btn.classList.remove('recording');
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      if (blob.size > 0) {
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
        await sendAttachment(toUserId, file);
      }
    };
    mediaRecorder.start();
    btn.classList.add('recording');
  } catch (err) {
    alert('Microphone access is needed to record a voice note.');
  }
}

// ---------- Logout ----------

$('#logoutBtn').addEventListener('click', async () => {
  try { await api.post('/api/auth/logout'); } catch (_) {}
  window.location.href = '/index.html';
});

bootstrap();
