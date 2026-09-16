// GET /api/qr/list
// Admin only. Returns all QR codes with status.
const { requireAdmin } = require('../_auth');
const supabase = require('../_db');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { data, error } = await supabase
    .from('qr_invites')
    .select('id, code, label, expires_at, one_time_use, max_uses, use_count, is_active, redirect_to, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch QR codes' });

  const now = new Date();
  const invites = (data || []).map(inv => ({
    ...inv,
    // Compute derived status so frontend doesn't need to
    status: !inv.is_active          ? 'revoked'
          : new Date(inv.expires_at) < now ? 'expired'
          : inv.use_count >= inv.max_uses  ? 'used_up'
          : 'active'
  }));

  return res.status(200).json({ invites });
};
