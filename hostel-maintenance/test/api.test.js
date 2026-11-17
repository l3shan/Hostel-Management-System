// Run with: npm test  (uses a temporary database, never touches data/hostel.db)
process.env.DB_FILE = require('path').join(require('os').tmpdir(), 'hostel-test-' + Date.now() + '.db');
const assert = require('assert');
const app = require('../server');

(async () => {
  const srv = app.listen(0), base = 'http://localhost:' + srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const login = async (id) => (await call('/api/auth/login', 'POST', { id, pw: 'demo' })).body.token;
  let n = 0; const ok = (c, m) => { assert.ok(c, m); console.log('PASS', m); n++; };

  const stu = await login('student@hostel.test'), adm = await login('admin@hostel.test'), stf = await login('staff@hostel.test'), grace = await login('grace@hostel.test');
  ok((await call('/api/auth/login', 'POST', { id: 'student@hostel.test', pw: 'wrong' })).status === 401, 'wrong password rejected');
  ok((await call('/api/auth/login', 'POST', { id: 'S2026/001', pw: 'demo' })).status === 200, 'login by registration number');
  ok((await call('/api/bootstrap')).status === 401, 'bootstrap needs a token');

  const b = (await call('/api/bootstrap', 'GET', null, stu)).body;
  ok(b.requests.length === 3 && b.requests.every((r) => r.studentId === b.me.id), 'student sees only own requests');
  ok(!JSON.stringify(b).includes('password'), 'no password data leaves the server');

  // student submits a request with a photo
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const c = await call('/api/requests', 'POST', { hostel: 'Hostel A', room: '12', category: 'Plumbing', priority: 'High', title: 'Blocked drain', desc: 'Water is not draining.', photoData: png }, stu);
  ok(c.status === 201, 'student creates a request');
  const id = c.body.id;
  ok((await call('/api/requests', 'POST', { hostel: 'Hostel A', room: '1', category: 'Plumbing', priority: 'High', title: 'x', desc: 'y' }, adm)).status === 403, 'admin cannot submit as a student');
  ok((await call('/api/requests', 'POST', { hostel: 'Hostel A', room: '1', category: 'Plumbing', priority: 'High', title: 'x', desc: 'y', photoData: 'data:text/html;base64,PGI+' }, stu)).status === 400, 'non-image upload rejected');

  // lifecycle and permission rules
  ok((await call(`/api/requests/${id}/assign`, 'POST', { staffId: 3 }, stu)).status === 403, 'student cannot assign');
  ok((await call(`/api/requests/${id}/assign`, 'POST', { staffId: 99 }, adm)).status === 400, 'assigning needs real staff');
  ok((await call(`/api/requests/${id}/review`, 'POST', {}, adm)).status === 200, 'admin starts review');
  ok((await call(`/api/requests/${id}/assign`, 'POST', { staffId: 3, priority: 'Medium', note: 'Bring a plunger.' }, adm)).status === 200, 'admin assigns to staff');
  ok((await call(`/api/requests/${id}/update`, 'POST', { status: 'RESOLVED' }, grace)).status === 403, 'other staff cannot update the task');
  ok((await call(`/api/requests/${id}/update`, 'POST', { status: 'RESOLVED' }, stf)).status === 409, 'cannot skip In progress');
  ok((await call(`/api/requests/${id}/update`, 'POST', { status: 'IN_PROGRESS', text: 'On my way.' }, stf)).status === 200, 'staff starts work');
  ok((await call(`/api/requests/${id}/update`, 'POST', { status: 'RESOLVED', text: 'Cleared the pipe.' }, stf)).status === 200, 'staff resolves');
  ok((await call(`/api/requests/${id}/reopen`, 'POST', {}, stu)).status === 200, 'student reopens an unfixed request');
  ok((await call(`/api/requests/${id}/update`, 'POST', { status: 'RESOLVED' }, stf)).status === 200, 'staff resolves again');
  ok((await call(`/api/requests/${id}/confirm`, 'POST', {}, stu)).status === 200, 'student confirms the fix');
  const after = (await call('/api/bootstrap', 'GET', null, stu)).body.requests.find((r) => r.id === id);
  ok(after.status === 'CLOSED' && after.resolvedAt, 'closed request keeps its resolved time');
  ok(after.comments.length >= 5 && after.photo.endsWith('.png'), 'comments logged and photo stored');
  ok((await fetch(base + '/uploads/' + after.photo)).status === 200, 'uploaded photo is served');

  // notifications
  const sn = (await call('/api/bootstrap', 'GET', null, stu)).body.notes;
  ok(sn.some((x) => x.text.includes('Resolved')), 'student was notified');
  await call('/api/notifications/read-all', 'POST', {}, stu);
  ok((await call('/api/bootstrap', 'GET', null, stu)).body.notes.every((x) => x.read), 'mark all as read');

  // staff and admin scoping
  ok((await call('/api/bootstrap', 'GET', null, stf)).body.requests.every((r) => r.assignedTo === 3), 'staff sees only assigned tasks');
  ok((await call('/api/bootstrap', 'GET', null, adm)).body.requests.length >= 8, 'admin sees every request');

  // admin management
  ok((await call('/api/hostels', 'POST', { name: 'Hostel C', room: '1' }, adm)).status === 201, 'admin adds hostel and room');
  ok((await call('/api/hostels', 'POST', { name: 'Hostel C', room: '1' }, adm)).status === 409, 'duplicate room rejected');
  ok((await call('/api/hostels', 'POST', { name: 'X' }, stu)).status === 403, 'student cannot manage hostels');
  const hs = (await call('/api/hostels')).body.hostels, hc = hs.find((h) => h.name === 'Hostel C');
  ok((await call('/api/hostels/' + hc.id, 'PATCH', { name: 'Hostel Cedar' }, adm)).status === 200, 'admin renames hostel');
  ok((await call('/api/users', 'POST', { name: 'New Staff', email: 'new@hostel.test', role: 'staff', pw: 'abcd' }, adm)).status === 201, 'admin creates staff account');
  ok((await call('/api/users', 'POST', { name: 'Dup', email: 'new@hostel.test', role: 'staff', pw: 'abcd' }, adm)).status === 409, 'duplicate email rejected');
  const newTok = await call('/api/auth/login', 'POST', { id: 'new@hostel.test', pw: 'abcd' });
  ok(newTok.status === 200, 'new account can sign in');
  const nu = (await call('/api/bootstrap', 'GET', null, adm)).body.users.find((u) => u.email === 'new@hostel.test');
  await call(`/api/users/${nu.id}/toggle`, 'POST', {}, adm);
  ok((await call('/api/bootstrap', 'GET', null, newTok.body.token)).status === 401, 'deactivated account is locked out');
  ok((await call('/api/users/2/toggle', 'POST', {}, adm)).status === 409, 'last administrator cannot be deactivated');

  // registration
  const reg = await call('/api/auth/register', 'POST', { name: 'Test Student', reg: 'S2026/900', email: 'test@hostel.test', hostel: 'Hostel B', room: '5', pw: 'secret1' });
  ok(reg.status === 201 && reg.body.user.role === 'student', 'student can register');
  ok((await call('/api/auth/register', 'POST', { name: 'Again', reg: 's2026/900', email: 'again@hostel.test', hostel: 'Hostel B', room: '5', pw: 'secret1' })).status === 409, 'duplicate registration number rejected');
  ok((await call('/api/requests', 'POST', { hostel: 'Hostel B', room: '5', category: "'; DROP TABLE users;--", priority: 'High', title: 't', desc: 'd' }, reg.body.token)).status === 400, 'invalid category rejected');
  ok((await call('/api/auth/login', 'POST', { id: "' OR 1=1 --", pw: 'x' })).status === 401, 'SQL injection attempt fails safely');

  console.log(`\n${n} checks passed`);
  srv.close(); process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
