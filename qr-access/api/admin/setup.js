// POST /api/admin/setup
// One-time endpoint to create the first admin account.
// Body: { email, password, full_name, setup_key }
const bcrypt   = require('bcryptjs');
const supabase = require('../_db');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
  const { data, error } = await supabase
    .from('qr_admins')
    .insert({ email: email.toLowerCase().trim(), password_hash: hash, full_name })
    .select('id, email, full_name')
    .single();

  if (error) return res.status(500).json({ error: 'Failed to create admin: ' + error.message });

  return res.status(201).json({ message: 'Admin created successfully', admin: data });
};
