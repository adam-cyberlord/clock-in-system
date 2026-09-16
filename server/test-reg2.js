require('dotenv').config();
const supabase = require('./db/supabase');
const bcrypt   = require('bcryptjs');
const { generateClockInId } = require('./utils/tokenHelper');
const fs = require('fs');

async function run() {
  const log = [];
  const ts  = Date.now();

  // Try the exact insert the controller does
  const clock_in_id   = generateClockInId();
  const password_hash = await bcrypt.hash(clock_in_id + ts, 10);

  log.push('Attempting insert with clock_in_id: ' + clock_in_id);

  const { data, error } = await supabase
    .from('students')
    .insert({
      full_name:          'Test Student',
      student_number:     'STU-TEST-' + ts,
      email:              'test' + ts + '@oasis.com',
      phone:              '+27000000000',
      password_hash,
      clock_in_id,
      registered_ip:      '127.0.0.1',
      device_fingerprint: 'test-fp',
      is_active:          true
    })
    .select('id, full_name, clock_in_id, email')
    .single();

  if (error) {
    log.push('❌ Supabase error:');
    log.push(JSON.stringify(error, null, 2));
  } else {
    log.push('✅ Success!');
    log.push('clock_in_id = ' + data.clock_in_id);
    log.push(JSON.stringify(data, null, 2));
  }

  fs.writeFileSync('test-reg2-result.txt', log.join('\n'));
  console.log('Done — see test-reg2-result.txt');
  process.exit(0);
}

run().catch(e => { fs.writeFileSync('test-reg2-result.txt', 'FATAL: ' + e.message); process.exit(1); });
