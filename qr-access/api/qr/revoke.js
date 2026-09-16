// PATCH /api/qr/revoke
// Admin only. Body: { id }  — sets is_active = false.
const { requireAdmin } = require('../_auth');
const supabase = require('../_db');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  const { data, error } = await supabase
    .from('qr_invites')
    .update({ is_active: false })
    .eq('id', id)
    .select('id, label, is_active')
    .single();

  if (error) return res.status(500).json({ error: 'Failed to revoke QR code' });

  return res.status(200).json({ message: 'QR code revoked', invite: data });
};
