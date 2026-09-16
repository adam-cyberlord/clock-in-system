// POST /api/qr/create
// Admin only. Body: { label, expires_in_hours, one_time_use, max_uses, redirect_to }
const { requireAdmin } = require('../_auth');
const supabase = require('../_db');
const { nanoid } = require('nanoid');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = requireAdmin(req, res);
  if (!admin) return;

  const {
    label         = '',
    expires_in_hours = 24,
    one_time_use  = true,
    max_uses      = 1,
    redirect_to   = 'register'
  } = req.body || {};

  if (!['register', 'login'].includes(redirect_to))
    return res.status(400).json({ error: 'redirect_to must be "register" or "login"' });

  const hours = Math.min(Math.max(1, Number(expires_in_hours) || 24), 8760); // 1h–1yr
  const code  = nanoid(48); // 48-char URL-safe token
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();

  const { data, error } = await supabase.from('qr_invites').insert({
    code,
    label:        label.trim() || null,
    created_by:   admin.id,
    expires_at:   expiresAt,
    one_time_use: Boolean(one_time_use),
    max_uses:     Math.max(1, Number(max_uses) || 1),
    redirect_to,
    is_active:    true,
    use_count:    0
  }).select().single();

  if (error) return res.status(500).json({ error: 'Failed to create QR code: ' + error.message });

  // Build the full validation URL (host comes from env or request header)
  const host = process.env.APP_URL ||
    `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  const validateUrl = `${host}/validate.html?code=${code}`;

  return res.status(201).json({ invite: data, validate_url: validateUrl });
};
