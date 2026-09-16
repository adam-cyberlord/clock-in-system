/**
 * QR Access Control routes
 * Mounted at /api/qr in index.js
 *
 * Public:
 *   POST /api/qr/validate   — verify a QR code, return session token
 *
 * Admin only (requires qr_admin JWT):
 *   POST  /api/qr/create    — generate a new invite code
 *   GET   /api/qr/list      — list all codes with status
 *   PATCH /api/qr/revoke    — revoke a code by id
 */
const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const supabase = require('../db/supabase');
const { nanoid } = require('nanoid');

// ── helpers ─────────────────────────────────────────────────────
function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
}

function requireQRAdmin(req, res) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return null; }
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    if (p.role !== 'qr_admin') { res.status(403).json({ error: 'QR admin access required' }); return null; }
    return p;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

async function logScan(invite_id, code, ip, user_agent, result) {
  await supabase.from('qr_access_log')
    .insert({ invite_id: invite_id || null, code, ip_address: ip, user_agent, result })
    .catch(() => {});
}

// ── POST /api/qr/validate  (public) ─────────────────────────────
router.post('/validate', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ valid: false, reason: 'no_code' });

  const ip = getIP(req);
  const ua = req.headers['user-agent'] || '';

  const { data: invite } = await supabase
    .from('qr_invites')
    .select('id, code, expires_at, one_time_use, max_uses, use_count, is_active, redirect_to')
    .eq('code', code.trim())
    .maybeSingle();

  if (!invite)                               { await logScan(null, code, ip, ua, 'invalid');  return res.json({ valid: false, reason: 'invalid'  }); }
  if (!invite.is_active)                     { await logScan(invite.id, code, ip, ua, 'revoked');  return res.json({ valid: false, reason: 'revoked'  }); }
  if (new Date(invite.expires_at) < new Date()) { await logScan(invite.id, code, ip, ua, 'expired'); return res.json({ valid: false, reason: 'expired'  }); }
  if (invite.use_count >= invite.max_uses)   { await logScan(invite.id, code, ip, ua, 'used_up'); return res.json({ valid: false, reason: 'used_up'  }); }

  // Grant access — increment use count, revoke if exhausted
  const newCount  = invite.use_count + 1;
  const exhausted = newCount >= invite.max_uses && invite.one_time_use;
  await supabase.from('qr_invites')
    .update({ use_count: newCount, is_active: !exhausted })
    .eq('id', invite.id);

  await logScan(invite.id, code, ip, ua, 'granted');

  // Issue a 15-min session token so the frontend can prove access
  const sessionToken = jwt.sign(
    { invite_id: invite.id, redirect_to: invite.redirect_to, granted: true },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  return res.json({ valid: true, redirect_to: invite.redirect_to, session_token: sessionToken });
});

// ── POST /api/qr/create  (admin) ────────────────────────────────
router.post('/create', async (req, res) => {
  const admin = requireQRAdmin(req, res); if (!admin) return;

  const {
    label = '', expires_in_hours = 24,
    one_time_use = true, max_uses = 1, redirect_to = 'register'
  } = req.body || {};

  if (!['register', 'login'].includes(redirect_to))
    return res.status(400).json({ error: 'redirect_to must be "register" or "login"' });

  const hours     = Math.min(Math.max(1, Number(expires_in_hours) || 24), 8760);
  const code      = nanoid(48);
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();

  const { data, error } = await supabase.from('qr_invites').insert({
    code, label: label.trim() || null,
    created_by: admin.id, expires_at: expiresAt,
    one_time_use: Boolean(one_time_use),
    max_uses: Math.max(1, Number(max_uses) || 1),
    redirect_to, is_active: true, use_count: 0
  }).select().single();

  if (error) return res.status(500).json({ error: 'Failed to create QR code: ' + error.message });

  const host         = process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`;
  const validate_url = `${host}/gate/validate.html?code=${code}`;

  return res.status(201).json({ invite: data, validate_url });
});

// ── GET /api/qr/list  (admin) ────────────────────────────────────
router.get('/list', async (req, res) => {
  const admin = requireQRAdmin(req, res); if (!admin) return;

  const { data, error } = await supabase
    .from('qr_invites')
    .select('id,code,label,expires_at,one_time_use,max_uses,use_count,is_active,redirect_to,created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch codes' });

  const now     = new Date();
  const invites = (data || []).map(inv => ({
    ...inv,
    status: !inv.is_active               ? 'revoked'
          : new Date(inv.expires_at) < now ? 'expired'
          : inv.use_count >= inv.max_uses  ? 'used_up'
          : 'active'
  }));

  return res.json({ invites });
});

// ── PATCH /api/qr/revoke  (admin) ───────────────────────────────
router.patch('/revoke', async (req, res) => {
  const admin = requireQRAdmin(req, res); if (!admin) return;
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  const { data, error } = await supabase
    .from('qr_invites').update({ is_active: false }).eq('id', id)
    .select('id,label,is_active').single();

  if (error) return res.status(500).json({ error: 'Failed to revoke' });
  return res.json({ message: 'QR code revoked', invite: data });
});

module.exports = router;
