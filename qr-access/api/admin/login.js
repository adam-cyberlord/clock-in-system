// POST /api/admin/login
// Body: { email, password }
// Returns: { token, admin }
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const supabase = require('../_db');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  const { data: admin, error } = await supabase
    .from('qr_admins')
    .select('id, email, full_name, password_hash, is_active')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !admin)
    return res.status(401).json({ error: 'Invalid email or password' });

  if (!admin.is_active)
    return res.status(403).json({ error: 'Account deactivated' });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid)
    return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign(
    { id: admin.id, email: admin.email, role: 'qr_admin' },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  return res.status(200).json({
    token,
    admin: { id: admin.id, email: admin.email, full_name: admin.full_name }
  });
};
