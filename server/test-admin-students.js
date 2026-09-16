require('dotenv').config();
const http = require('http');
const fs   = require('fs');

function req(method, path, body, token) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 3001, path: '/api' + path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(d) }); } catch { resolve({ s: res.statusCode, b: d }); } });
    });
    r.on('error', e => resolve({ s: 0, b: e.message }));
    if (payload) r.write(payload);
    r.end();
  });
}

async function run() {
  const log = [];

  // 1. Login
  const lr = await req('POST', '/auth/admin/login', { email: 'admin@op.com', password: 'Admin@2026' });
  log.push(`Login: ${lr.s}`);
  if (lr.s !== 200) { log.push('FAIL: ' + JSON.stringify(lr.b)); fs.writeFileSync('test-admin-students.txt', log.join('\n')); return; }
  const token = lr.b.token;
  log.push('Token: ' + token.substring(0, 30) + '...');

  // 2. Get all students
  const sr = await req('GET', '/admin/students?limit=20', null, token);
  log.push(`\nStudents API: ${sr.s}`);
  if (sr.s === 200) {
    log.push(`Total: ${sr.b.total}`);
    (sr.b.students || []).forEach(s => {
      log.push(`  - ${s.full_name} | ${s.student_number} | ${s.clock_in_id} | active:${s.is_active}`);
    });
  } else {
    log.push('ERROR: ' + JSON.stringify(sr.b));
  }

  // 3. Test stats for first student
  if (sr.b.students && sr.b.students.length > 0) {
    const sid = sr.b.students[0].id;
    const stat = await req('GET', `/attendance/stats/${sid}`, null, token);
    log.push(`\nStats for ${sr.b.students[0].full_name}: ${stat.s}`);
    log.push(JSON.stringify({ present: stat.b.present, late: stat.b.late, absent: stat.b.absent }));
  }

  fs.writeFileSync('test-admin-students.txt', log.join('\n'));
  console.log('Done — see test-admin-students.txt');
  process.exit(0);
}

run().catch(e => { fs.writeFileSync('test-admin-students.txt', 'FATAL: ' + e.message); process.exit(1); });
