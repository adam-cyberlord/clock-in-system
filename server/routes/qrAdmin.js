/**
 * QR Admin auth routes
 * Mounted at /api/qr-admin in index.js
 *
 *   POST /api/qr-admin/login    — sign in as qr_admin
 *   POST /api/qr-admin/setup    — create first qr_admin (one-time)
 *   GET  /api/qr-admin/session-today  — proxy to attendance session for today
 */
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const supabase = require('../db/supabase');

// ── POST /api/qr-admin/login ─────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  const { data: admin } = await supabase
    .from('qr_admins')
    .select('id,email,full_name,password_hash,is_active')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (!admin) return res.status(401).json({ error: 'Invalid email or password' });
  if (!admin.is_active) return res.status(403).json({ error: 'Account deactivated' });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign(
    { id: admin.id, email: admin.email, role: 'qr_admin' },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  return res.json({ token, admin: { id: admin.id, email: admin.email, full_name: admin.full_name } });
});

// ── POST /api/qr-admin/setup  (one-time) ────────────────────────
router.post('/setup', async (req, res) => {
  const { email, password, full_name, setup_key } = req.body || {};

  if (setup_key !== process.env.ADMIN_SETUP_KEY)
    return res.status(403).json({ error: 'Invalid setup key' });
  if (!email || !password || !full_name)
    return res.status(400).json({ error: 'email, password, and full_name are required' });

  const { data: existing } = await supabase
    .from('qr_admins').select('id').eq('email', email.toLowerCase()).maybeSingle();
  if (existing)
    return res.status(409).json({ error: 'Admin with this email already exists' });

  const hash = await bcrypt.hash(password, 12);
  const { data, error } = await supabase.from('qr_admins')
    .insert({ email: email.toLowerCase().trim(), password_hash: hash, full_name, is_active: true })
    .select('id,email,full_name').single();

  if (error) return res.status(500).json({ error: 'Failed to create admin: ' + error.message });
  return res.status(201).json({ message: 'QR admin created', admin: data });
});

// ── GET /api/qr-admin/session-today ─────────────────────────────
// Proxies to the attendance_sessions table — used by admin.html dashboard
router.get('/session-today', async (req, res) => {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Auth required' });
  try { jwt.verify(token, process.env.JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }

  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('*, locations(id,name,address,latitude,longitude,width_m,length_m)')
    .eq('session_date', today)
    .maybeSingle();

  if (error) return res.json({ session: null });
  return res.json({ session: data || null });
});

// ── GET /api/qr-admin/locations ─────────────────────────────────
// Returns active locations for session dropdown in admin.html
router.get('/locations', async (req, res) => {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Auth required' });
  try { jwt.verify(token, process.env.JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }

  const { data, error } = await supabase
    .from('locations').select('id,name,address').eq('is_active', true)
    .order('name', { ascending: true });

  if (error) return res.status(500).json({ error: 'Failed to fetch locations' });
  return res.json({ locations: data || [] });
});

module.exports = router;
