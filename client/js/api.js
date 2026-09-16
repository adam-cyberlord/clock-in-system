/**
 * api.js — Oasis Pulse HTTP Client + UI Helpers
 *
 * api.get(path)
 * api.post(path, body)
 * api.patch(path, body)
 * api.put(path, body)
 * api.del(path)
 *
 * showAlert(elementId, message, type)
 * clearAlert(elementId)
 * showToast(message, type, duration)
 * setLoading(btn, isLoading, loadText)
 * escapeHTML(str)
 * formatTime(iso)
 * formatDate(dateStr)
 * calcDuration(clockIn, clockOut)
 */

// ─── Base URL ─────────────────────────────────────────────────────
// Server always runs on port 3001 (set in server/.env  PORT=3001)
const API_BASE_URL = (function () {
  const { hostname, protocol } = window.location;
  // Opened through the server (localhost or 127.0.0.1)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//localhost:3001/api`;
  }
  // Production: same origin
  return `${protocol}//${window.location.host}/api`;
})();

// ─── Token helpers ────────────────────────────────────────────────
function _getToken() { return localStorage.getItem('tm_token') || ''; }

function _buildHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  const t = _getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

// ─── Core request ─────────────────────────────────────────────────
async function _request(method, path, body = null) {
  const url       = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const hadToken  = Boolean(_getToken());
  const options   = { method, headers: _buildHeaders() };
  if (body !== null) options.body = JSON.stringify(body);

  let response;
  try {
    response = await fetch(url, options);
  } catch {
    // Show offline banner if present
    const b = document.getElementById('server-offline-banner');
    if (b) b.style.display = 'flex';
    throw new Error(
      'Cannot reach the server.\n' +
      '→ Double-click start-server.bat to start it, then refresh.'
    );
  }

  // Hide offline banner on success
  const b = document.getElementById('server-offline-banner');
  if (b) b.style.display = 'none';

  // Expired session → redirect
  if (response.status === 401 && hadToken) {
    localStorage.removeItem('tm_token');
    localStorage.removeItem('tm_user');
    showToast('Session expired — please sign in again.', 'warning');
    setTimeout(() => { window.location.href = '/'; }, 1600);
    throw new Error('Session expired');
  }

  let data = {};
  try {
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await response.json();
  } catch { /* empty body */ }

  if (!response.ok) {
    const msg = data?.error || data?.message || `Request failed (${response.status})`;
    const err = new Error(msg);
    err.status = response.status;
    err.data   = data;
    throw err;
  }

  return data;
}

// ─── Public API ───────────────────────────────────────────────────
const api = {
  get:   (path)       => _request('GET',    path),
  post:  (path, body) => _request('POST',   path, body),
  patch: (path, body) => _request('PATCH',  path, body),
  put:   (path, body) => _request('PUT',    path, body),
  del:   (path)       => _request('DELETE', path),
};

// ─── Server time sync (non-blocking, fire and forget) ────────────
let _serverOffset = 0;
(function syncServerTime() {
  const t0 = Date.now();
  fetch(`${API_BASE_URL.replace('/api','')}/health`, { cache: 'no-store' })
    .then(r => r.json())
    .then(d => {
      const t1 = Date.now();
      _serverOffset = (t0 + (t1-t0)/2) - new Date(d.timestamp).getTime();
    })
    .catch(() => {}); // silent — offset stays 0
})();

/** Returns the current time adjusted to server clock. */
function getServerNow() {
  return new Date(Date.now() - _serverOffset);
}

// ─── Alert helper ─────────────────────────────────────────────────
function showAlert(elementId, message, type = 'error') {
  const el = document.getElementById(elementId);
  if (!el) return;
  const icons = { error: '✕', success: '✓', info: 'ℹ', warning: '⚠' };
  el.innerHTML = `<div class="alert-box alert-${type}">
    <span class="alert-icon">${icons[type] ?? 'ℹ'}</span>
    <span>${escapeHTML(message)}</span>
  </div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearAlert(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = '';
}

// ─── Toast ────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = Object.assign(document.createElement('div'), { id: 'toast-container' });
    container.style.cssText =
      'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;max-width:360px;';
    document.body.appendChild(container);
  }

  const palette = {
    success: { bg: '#059669', border: '#34d399' },
    error:   { bg: '#dc2626', border: '#f87171' },
    warning: { bg: '#d97706', border: '#fbbf24' },
    info:    { bg: '#2563eb', border: '#60a5fa' },
  };
  const { bg, border } = palette[type] ?? palette.info;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

  const t = document.createElement('div');
  t.setAttribute('role', 'status');
  t.style.cssText = `
    background:${bg};color:white;padding:.75rem 1rem;border-radius:10px;
    font-size:.84rem;font-weight:600;border-left:4px solid ${border};
    box-shadow:0 4px 20px rgba(0,0,0,.3);display:flex;align-items:center;gap:.6rem;
    animation:slideInToast .25s ease;
  `;
  t.innerHTML = `<span style="font-size:1rem;flex-shrink:0">${icons[type] ?? 'ℹ'}</span>
    <span style="flex:1">${escapeHTML(message)}</span>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:white;cursor:pointer;font-size:1rem;padding:0;line-height:1;opacity:.7">✕</button>`;
  container.appendChild(t);

  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(100%)';
    t.style.transition = 'opacity .3s,transform .3s';
    setTimeout(() => t.remove(), 320);
  }, duration);
}

if (!document.getElementById('toast-slide-style')) {
  const s = document.createElement('style');
  s.id = 'toast-slide-style';
  s.textContent = '@keyframes slideInToast{from{opacity:0;transform:translateX(100%)}to{opacity:1;transform:translateX(0)}}';
  document.head.appendChild(s);
}

// ─── Loading state ────────────────────────────────────────────────
function setLoading(btn, isLoading, loadText = 'Loading…') {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="btn-spinner"></span> ${escapeHTML(loadText)}`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.originalHtml ?? btn.innerHTML;
    btn.disabled = false;
  }
}

// ─── Utilities ────────────────────────────────────────────────────
function escapeHTML(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
}

function calcDuration(clockIn, clockOut) {
  if (!clockIn || !clockOut) return null;
  const ms = new Date(clockOut) - new Date(clockIn);
  if (ms <= 0) return null;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}
