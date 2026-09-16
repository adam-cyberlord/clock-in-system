require('dotenv').config();
const bcrypt   = require('bcryptjs');
const supabase = require('./db/supabase');
const fs       = require('fs');

async function run() {
  const NEW_PASSWORD  = 'Admin@2026';
  const hash = await bcrypt.hash(NEW_PASSWORD, 12);

  const { data, error } = await supabase
    .from('admins')
    .update({ password_hash: hash })
    .eq('email', 'admin@op.com')
    .select('id, full_name, email')
    .single();

  if (error) {
    fs.writeFileSync('reset-admin-result.txt', 'ERROR: ' + JSON.stringify(error));
  } else {
    fs.writeFileSync('reset-admin-result.txt',
      `✅ Password reset!\n\nEmail:    ${data.email}\nPassword: ${NEW_PASSWORD}\nName:     ${data.full_name}`);
  }
  console.log('Done');
  process.exit(0);
}

run().catch(e => { fs.writeFileSync('reset-admin-result.txt', 'FATAL: '+e.message); process.exit(1); });
