// Admin JWT middleware helper
const jwt = require('jsonwebtoken');

function requireAdmin(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'qr_admin') {
      res.status(403).json({ error: 'Admin access required' });
      return null;
    }
    return payload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

module.exports = { requireAdmin };
