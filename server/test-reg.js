require('dotenv').config();
const http = require('http');
const fs   = require('fs');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost', port: 3001, path: '/api' + path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  const log = [];
  const out = msg => log.push(msg);

  // 1. Register a test student
  out('\n[1] Register test student');
  const rr = await request('POST', '/auth/register', {
    full_name: 'Test Student',
    student_number: 'STU-TEST-' + Date.now(),
    email: 'test' + Date.now() + '@oasis.com',
    phone: '+27000000000',
    fingerprint: 'test-fp-123'
  });
  out(`    Status: ${rr.status}`);
  out(`    Body: ${JSON.stringify(rr.body, null, 2)}`);

  if (rr.status === 201) {
    out(`\n    ✅ clock_in_id = ${rr.body?.student?.clock_in_id}`);
    out(`    token present: ${!!rr.body?.token}`);
  } else {
    out(`\n    ❌ Registration failed`);
  }

  fs.writeFileSync('test-reg-result.txt', log.join('\n'));
  console.log('Done — see test-reg-result.txt');
  process.exit(0);
}

run().catch(e => { fs.writeFileSync('test-reg-result.txt', 'FATAL: '+e.message); process.exit(1); });
