// POST /api/qr/validate
// Public endpoint. Body: { code }
// Returns: { valid, redirect_to, session_token } on success
// or { valid: false, reason } on failure.
const supabase = require('../_db');
const jwt      = require('jsonwebtoken');

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ valid: false, reason: 'No code provided' });

  const ip        = getIP(req);
  const userAgent = req.headers['user-agent'] || '';

  // Fetch invite
  const { data: invite, error } = await supabase
    .from('qr_invites')
    .select('id, code, expires_at, one_time_use, max_uses, use_count, is_active, redirect_to')
    .eq('code', code.trim())
    .maybeSingle();

  // ── Invalid code ────────────────────────────────────────────
  if (error || !invite) {
    await _log(null, code, ip, userAgent, 'invalid');
    return res.status(200).json({ valid: false, reason: 'invalid' });
  }

  // ── Revoked ─────────────────────────────────────────────────
  if (!invite.is_active) {
    await _log(invite.id, code, ip, userAgent, 'revoked');
    return res.status(200).json({ valid: false, reason: 'revoked' });
  }

  // ── Expired ─────────────────────────────────────────────────
  if (new Date(invite.expires_at) < new Date()) {
    await _log(invite.id, code, ip, userAgent, 'expired');
    return res.status(200).json({ valid: false, reason: 'expired' });
  }

  // ── Used up ─────────────────────────────────────────────────
  if (invite.use_count >= invite.max_uses) {
    await _log(invite.id, code, ip, userAgent, 'used_up');
    return res.status(200).json({ valid: false, reason: 'used_up' });
  }

  // ── GRANT ACCESS ─────────────────────────────────────────────
  // Increment use_count; revoke if one-time and now exhausted
  const newCount  = invite.use_count + 1;
  const exhausted = newCount >= invite.max_uses;
  await supabase.from('qr_invites')
    .update({ use_count: newCount, is_active: !exhausted || !invite.one_time_use ? invite.is_active : false })
    .eq('id', invite.id);

  await _log(invite.id, code, ip, userAgent, 'granted');

  // Issue a short-lived session token so the frontend can prove it passed the gate
  const sessionToken = jwt.sign(
    { invite_id: invite.id, redirect_to: invite.redirect_to, granted: true },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }  // visitor has 15 min to complete registration/login
  );

  return res.status(200).json({
    valid:         true,
    redirect_to:   invite.redirect_to,   // 'register' | 'login'
    session_token: sessionToken
  });
};

async function _log(invite_id, code, ip, user_agent, result) {
  await supabase.from('qr_access_log').insert({
    invite_id: invite_id || null,
    code,
    ip_address: ip,
    user_agent,
    result
  }).catch(() => {}); // non-blocking
}
