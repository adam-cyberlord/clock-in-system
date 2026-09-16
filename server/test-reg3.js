require('dotenv').config();
const supabase = require('./db/supabase');
const bcrypt   = require('bcryptjs');
const { generateClockInId } = require('./utils/tokenHelper');
const fs = require('fs');

async function run() {
  const log = [];
  const ts  = Date.now();
  const clock_in_id   = generateClockInId();
  const password_hash = await bcrypt.hash(clock_in_id + ts, 10);

  // Test exactly what the fixed controller does — no device_address
  const { data, error } = await supabase
    .from('students')
    .insert({
      full_name:          'Fix Test',
      student_number:     'STU-FIX-' + ts,
      email:              'fix' + ts + '@oasis.com',
      phone:              null,
      password_hash,
      clock_in_id,
      registered_ip:      '127.0.0.1',
      registered_mac:     null,
      device_fingerprint: 'test-fp-fix'
    })
    .select('id, full_name, email, student_number, clock_in_id, created_at')
    .single();

  if (error) {
    log.push('❌ Error: ' + JSON.stringify(error, null, 2));
  } else {
    log.push('✅ clock_in_id = ' + data.clock_in_id);
    log.push(JSON.stringify(data, null, 2));
  }

  // Also get the admin credentials from DB
  log.push('\n--- Admin accounts ---');
  const { data: admins } = await supabase
    .from('admins')
    .select('id, full_name, email, created_at');
  log.push(JSON.stringify(admins, null, 2));

  fs.writeFileSync('test-reg3-result.txt', log.join('\n'));
  console.log('Done');
  process.exit(0);
}

run().catch(e => { fs.writeFileSync('test-reg3-result.txt', 'FATAL: '+e.message); process.exit(1); });
