const roleTabs = [...document.querySelectorAll('.role-tab')];
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const registerDialog = document.querySelector('#register-dialog');
const setupDialog = document.querySelector('#setup-dialog');
let selectedRole = 'member';

if (JSON.parse(sessionStorage.getItem('wesporth_session') || 'null')?.token) {
  window.location.replace('dashboard.html');
}

function setBusy(form, busy) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = busy;
  button.dataset.label ||= button.textContent;
  button.textContent = busy ? '请稍候…' : button.dataset.label;
}

function showError(element, error) {
  element.textContent = error instanceof Error ? error.message : String(error);
  element.hidden = false;
}

function saveSession(data) {
  sessionStorage.setItem('wesporth_session', JSON.stringify({ token: data.token, expiresAt: data.expiresAt, account: data.account }));
  window.location.href = 'dashboard.html';
}

roleTabs.forEach((tab) => tab.addEventListener('click', () => {
  selectedRole = tab.dataset.role;
  roleTabs.forEach((item) => {
    const active = item === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  document.querySelector('#register-trigger').hidden = selectedRole !== 'member';
  document.querySelector('#setup-trigger').hidden = selectedRole !== 'admin';
  loginError.hidden = true;
}));

document.querySelector('#toggle-password').addEventListener('click', (event) => {
  const field = document.querySelector('#password');
  const visible = field.type === 'text';
  field.type = visible ? 'password' : 'text';
  event.currentTarget.textContent = visible ? '显示' : '隐藏';
  event.currentTarget.setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  const data = new FormData(loginForm);
  setBusy(loginForm, true);
  try {
    saveSession(await WesportAPI.post('/api/auth/login', {
      username: data.get('username'), password: data.get('password'), role: selectedRole
    }));
  } catch (error) {
    showError(loginError, error);
    setBusy(loginForm, false);
  }
});

document.querySelector('#register-trigger').addEventListener('click', () => {
  registerDialog.hidden = false;
  document.querySelector('#reg-name').focus();
});

document.querySelector('#setup-trigger').addEventListener('click', () => {
  setupDialog.hidden = false;
  document.querySelector('#setup-name').focus();
});

document.querySelectorAll('.dialog-close').forEach((button) => button.addEventListener('click', () => {
  button.closest('.dialog').hidden = true;
}));

[registerDialog, setupDialog].forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.hidden = true;
}));

document.querySelector('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector('#register-error');
  errorElement.hidden = true;
  setBusy(form, true);
  try {
    saveSession(await WesportAPI.post('/api/auth/register', {
      name: document.querySelector('#reg-name').value.trim(),
      username: document.querySelector('#reg-username').value.trim(),
      password: document.querySelector('#reg-password').value
    }));
  } catch (error) {
    showError(errorElement, error);
    setBusy(form, false);
  }
});

document.querySelector('#setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector('#setup-error');
  errorElement.hidden = true;
  setBusy(form, true);
  try {
    saveSession(await WesportAPI.post('/api/setup', {
      name: document.querySelector('#setup-name').value.trim(),
      username: document.querySelector('#setup-username').value.trim(),
      password: document.querySelector('#setup-password').value,
      setupToken: document.querySelector('#setup-token').value
    }));
  } catch (error) {
    showError(errorElement, error);
    setBusy(form, false);
  }
});
