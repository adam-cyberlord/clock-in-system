// ── QR Access Control — shared client config ─────────────────────
const QR_CONFIG = (function () {
  const isLocal =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '';

  return {
    // All API calls go to /api/... (same origin, works locally + on Vercel)
    apiBase: '/api',
    appBase: location.origin,

    // Parse and return the JWT payload stored in sessionStorage.
    // Returns null if missing, expired, or tampered.
    parseSession(token) {
      if (!token) return null;
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (!payload.granted) return null;
        if (payload.exp * 1000 < Date.now()) return null;
        return payload;
      } catch {
        return null;
      }
    },

    // Check if visitor has a live QR session.
    // Redirects to gate.html if not; returns payload if yes.
    requireSession() {
      const token   = sessionStorage.getItem('qr_session');
      const payload = this.parseSession(token);
      if (!payload) {
        location.href = 'gate.html';
        return null;
      }
      return payload;
    }
  };
})();
