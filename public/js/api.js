// Small fetch wrapper. Cookies (the auth token) are sent automatically
// because they're httpOnly and same-origin — we never touch them from JS.
// The CSRF token cookie is intentionally readable so we can echo it back
// as a header on state-changing requests (double-submit cookie pattern).
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

const api = {
  async request(method, url, body) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    const csrf = getCookie('csrf_token');
    if (csrf && !['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrf;

    const res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    });

    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }

    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  patch(url, body) { return this.request('PATCH', url, body); },
  del(url) { return this.request('DELETE', url); },

  async upload(url, formData) {
    const csrf = getCookie('csrf_token');
    const res = await fetch(url, {
      method: 'POST',
      headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
      credentials: 'same-origin',
      body: formData
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      throw new Error((data && data.error) || `Upload failed (${res.status})`);
    }
    return data;
  }
};

// Escapes text before it's ever inserted as HTML, preventing stored/DOM XSS
// from message content, display names, or usernames.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
