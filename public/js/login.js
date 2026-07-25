const form = document.getElementById('loginForm');
const errorBox = document.getElementById('formError');
const submitBtn = document.getElementById('submitBtn');

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add('visible');
}
function hideError() {
  errorBox.classList.remove('visible');
}

// If already signed in, skip straight to chat.
api.get('/api/auth/me').then(() => {
  window.location.href = '/chat.html';
}).catch(() => { /* not signed in, stay here */ });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    await api.post('/api/auth/login', { username, password });
    window.location.href = '/chat.html';
  } catch (err) {
    showError(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';
  }
});
