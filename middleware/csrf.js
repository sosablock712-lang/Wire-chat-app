const crypto = require('crypto');

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

// Double-submit cookie pattern. The token itself carries no secret server
// state (no session store needed), so it works fine without Redis.
// It's readable by JS on purpose (it has to be, to echo back as a header) —
// what makes it safe is that a cross-site page can't read *our* cookie to
// steal the value, it can only cause the browser to send it, and it can't
// also forge the matching header value.
function ensureCsrfCookie(req, res, next) {
  if (!req.cookies || !req.cookies[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    req.cookies = req.cookies || {};
    req.cookies[CSRF_COOKIE] = token;
  }
  next();
}

function verifyCsrf(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  const cookieToken = req.cookies ? req.cookies[CSRF_COOKIE] : null;
  const headerToken = req.headers[CSRF_HEADER];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }
  next();
}

module.exports = { CSRF_COOKIE, CSRF_HEADER, ensureCsrfCookie, verifyCsrf };
