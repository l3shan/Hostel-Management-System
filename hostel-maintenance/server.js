// Express REST API + static front end. Three tiers: browser UI -> Express API -> SQLite.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, hash, verify, seed } = require('./db');

seed();
const app = express();
const PORT = process.env.PORT || 3000;
const DAY = 864e5;
const ST = ['SUBMITTED', 'UNDER_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const LBL = { SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed' };
const BY = { student: 'Student', admin: 'Admin', staff: 'Staff' };
const CATS = ['Plumbing', 'Electrical', 'Furniture', 'Other'];
const PRI = ['Low', 'Medium', 'High'];
const pad = (id) => '#' + String(id).padStart(3, '0');

/* ---------- helpers ---------- */
class Fail extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }
const need = (c, msg, code) => { if (!c) throw new Fail(msg, code); };
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const num = (v) => Number.isInteger(+v) ? +v : 0;

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
fs.mkdirSync(uploadDir, { recursive: true });
const secretFile = path.join(__dirname, 'data', '.secret');
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  try { SECRET = fs.readFileSync(secretFile, 'utf8'); } catch {
    SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, SECRET, { mode: 0o600 });
  }
}
const sign = (uid) => {
  const body = Buffer.from(JSON.stringify({ u: uid, exp: Date.now() + 8 * 3600e3 })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
};
function readToken(tok) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p.u : null; } catch { return null; }
}

const tell = (uid, text) => { if (uid) db.prepare('INSERT INTO notifications(user_id,text,created_at) VALUES (?,?,?)').run(uid, text, Date.now()); };
const say = (rid, by, text) => { if (text) db.prepare('INSERT INTO comments(request_id,by_role,text,created_at) VALUES (?,?,?,?)').run(rid, by, text, Date.now()); };
const touch = (id, status) => db.prepare("UPDATE requests SET status=?, updated_at=?, resolved_at=CASE ? WHEN 'RESOLVED' THEN ? WHEN 'CLOSED' THEN resolved_at ELSE NULL END WHERE id=?").run(status, Date.now(), status, Date.now(), id);
const hostelByName = (name) => db.prepare('SELECT * FROM hostels WHERE name=?').get(name);
const request = (id) => { const r = db.prepare('SELECT * FROM requests WHERE id=?').get(id); need(r, 'Request not found.', 404); return r; };

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, reg: u.reg || '', hostel: u.hostel || '', room: u.room || '' });
const USER_SQL = 'SELECT u.*, h.name AS hostel FROM users u LEFT JOIN hostels h ON h.id=u.hostel_id';

/* ---------- middleware ---------- */
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:",
  });
  next();
});
app.use(express.json({ limit: '4mb' }));

function auth(...roles) {
  return (req, res, next) => {
    const uid = readToken((req.get('Authorization') || '').replace(/^Bearer /, ''));
    const u = uid && db.prepare(USER_SQL + ' WHERE u.id=?').get(uid);
    need(u && u.active, 'Please sign in.', 401);
    need(!roles.length || roles.includes(u.role), 'You are not allowed to do that.', 403);
    req.user = u;
    next();
  };
}

const attempts = new Map();
function throttle(req) {
  const k = req.ip, now = Date.now(), a = (attempts.get(k) || []).filter((t) => now - t < 10 * 60e3);
  need(a.length < 10, 'Too many sign-in attempts. Wait a few minutes and try again.', 429);
  a.push(now); attempts.set(k, a);
}

/* ---------- auth ---------- */
app.post('/api/auth/login', (req, res) => {
  throttle(req);
  const id = str(req.body.id, 120).toLowerCase(), pw = String(req.body.pw ?? '');
  const u = db.prepare(USER_SQL + ' WHERE lower(u.email)=? OR lower(u.reg)=?').get(id, id);
  need(u && verify(pw, u.password_hash), 'Registration number, email or password is incorrect.', 401);
  need(u.active, 'This account is deactivated. Ask an administrator for access.', 403);
  res.json({ token: sign(u.id), user: publicUser(u) });
});

app.post('/api/auth/register', (req, res) => {
  const b = req.body, name = str(b.name, 80), reg = str(b.reg, 40), email = str(b.email, 120).toLowerCase(), room = str(b.room, 20), pw = String(b.pw ?? '');
  need(name && reg && email && room && pw, 'Fill in every field.');
  need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email address.');
  need(pw.length >= 4 && pw.length <= 100, 'Password must have at least 4 characters.');
  const h = hostelByName(str(b.hostel, 80));
  need(h, 'Choose a hostel from the list.');
  need(!db.prepare('SELECT 1 FROM users WHERE lower(email)=? OR lower(reg)=?').get(email, reg.toLowerCase()), 'An account with this email or registration number already exists.', 409);
  const id = db.prepare('INSERT INTO users(name,email,reg,password_hash,role,hostel_id,room) VALUES (?,?,?,?,?,?,?)').run(name, email, reg, hash(pw), 'student', h.id, room).lastInsertRowid;
  const u = db.prepare(USER_SQL + ' WHERE u.id=?').get(id);
  res.status(201).json({ token: sign(id), user: publicUser(u) });
});

app.get('/api/hostels', (req, res) => res.json({ hostels: listHostels() }));

function listHostels() {
  const rooms = db.prepare('SELECT hostel_id, number FROM rooms ORDER BY CAST(number AS INTEGER), number').all();
  return db.prepare('SELECT id, name FROM hostels ORDER BY name').all().map((h) => ({ ...h, rooms: rooms.filter((r) => r.hostel_id === h.id).map((r) => r.number) }));
}

/* ---------- bootstrap: everything the signed-in user may see ---------- */
app.get('/api/bootstrap', auth(), (req, res) => {
  const u = req.user, base = 'SELECT r.*, h.name AS hostel FROM requests r JOIN hostels h ON h.id=r.hostel_id';
  const rows = u.role === 'admin' ? db.prepare(base).all()
    : u.role === 'student' ? db.prepare(base + ' WHERE r.student_id=?').all(u.id)
    : db.prepare(base + ' WHERE r.assigned_to=?').all(u.id);
  const ids = rows.map((r) => r.id);
  const comments = ids.length ? db.prepare(`SELECT * FROM comments WHERE request_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, id`).all(...ids) : [];
  const requests = rows.map((r) => ({
    id: r.id, studentId: r.student_id, title: r.title, hostel: r.hostel, room: r.room, category: r.category, priority: r.priority,
    description: r.description, status: r.status, assignedTo: r.assigned_to, photo: r.photo || '',
    createdAt: r.created_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at,
    comments: comments.filter((c) => c.request_id === r.id).map((c) => ({ by: c.by_role, text: c.text, at: c.created_at })),
  }));
  let users;
  if (u.role === 'admin') users = db.prepare(USER_SQL + ' ORDER BY u.id').all();
  else {
    const want = [...new Set([u.id, ...rows.flatMap((r) => [r.student_id, r.assigned_to]).filter(Boolean)])];
    users = db.prepare(USER_SQL + ` WHERE u.id IN (${want.map(() => '?').join(',')})`).all(...want);
  }
  const notes = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 200').all(u.id)
    .map((n) => ({ id: n.id, userId: n.user_id, text: n.text, at: n.created_at, read: !!n.read }));
  res.json({ me: publicUser(u), hostels: listHostels(), users: users.map(publicUser), requests, notes });
});

/* ---------- requests ---------- */
app.post('/api/requests', auth('student'), (req, res) => {
  const b = req.body, title = str(b.title, 120), room = str(b.room, 20), desc = str(b.desc, 2000);
  const h = hostelByName(str(b.hostel, 80));
  need(h && room && title && desc, 'Fill in hostel, room, issue title and description.');
  need(CATS.includes(b.category) && PRI.includes(b.priority), 'Choose a category and priority.');
  let photo = null;
  if (b.photoData) {
    const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photoData));
    need(m, 'The photo must be a PNG, JPEG, WebP or GIF image.');
    const buf = Buffer.from(m[2], 'base64');
    need(buf.length <= 2.5 * 1024 * 1024, 'The photo must be smaller than 2.5 MB.');
    photo = crypto.randomBytes(12).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    fs.writeFileSync(path.join(uploadDir, photo), buf);
  }
  const now = Date.now();
  const id = db.transaction(() => {
    const rid = db.prepare(`INSERT INTO requests(student_id,title,hostel_id,room,category,priority,description,photo,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(req.user.id, title, h.id, room, b.category, b.priority, desc, photo, now, now).lastInsertRowid;
    db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").all().forEach((a) => tell(a.id, `New request ${pad(rid)}: ${title}.`));
    return rid;
  })();
  res.status(201).json({ id });
});

app.post('/api/requests/:id/review', auth('admin'), (req, res) => {
  const r = request(num(req.params.id));
  need(r.status === 'SUBMITTED', 'This request is already under review.', 409);
  db.transaction(() => { touch(r.id, 'UNDER_REVIEW'); say(r.id, 'Admin', str(req.body.note, 500) || 'Request is under review.'); tell(r.student_id, `Your request ${pad(r.id)} is now Under review.`); })();
  res.json({ ok: true });
});

app.post('/api/requests/:id/assign', auth('admin'), (req, res) => {
  const r = request(num(req.params.id)), b = req.body;
  need(r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW', 'This request can no longer be assigned.', 409);
  const s = db.prepare("SELECT * FROM users WHERE id=? AND role='staff' AND active=1").get(num(b.staffId));
  need(s, 'Choose a maintenance staff member.');
  const cat = CATS.includes(b.category) ? b.category : r.category, pri = PRI.includes(b.priority) ? b.priority : r.priority, note = str(b.note, 500);
  db.transaction(() => {
    db.prepare('UPDATE requests SET category=?, priority=?, assigned_to=? WHERE id=?').run(cat, pri, s.id, r.id);
    touch(r.id, 'ASSIGNED');
    say(r.id, 'Admin', `Assigned to ${s.name}.${note ? ' ' + note : ''}`);
    tell(r.student_id, `Your request ${pad(r.id)} was assigned to maintenance staff.`);
    tell(s.id, `New task ${pad(r.id)}: ${r.title}.`);
  })();
  res.json({ ok: true });
});

app.post('/api/requests/:id/reject', auth('admin'), (req, res) => {
  const r = request(num(req.params.id)), note = str(req.body.note, 500);
  need(r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW', 'This request can no longer be rejected.', 409);
  db.transaction(() => { touch(r.id, 'CLOSED'); say(r.id, 'Admin', 'Rejected or marked as duplicate.' + (note ? ' ' + note : '')); tell(r.student_id, `Your request ${pad(r.id)} was closed by the administrator.`); })();
  res.json({ ok: true });
});

app.post('/api/requests/:id/update', auth('staff'), (req, res) => {
  const r = request(num(req.params.id)), status = req.body.status, text = str(req.body.text, 1000);
  need(r.assigned_to === req.user.id, 'This task is not assigned to you.', 403);
  need(r.status === 'ASSIGNED' || r.status === 'IN_PROGRESS', 'This task is already finished.', 409);
  need(status === 'IN_PROGRESS' || status === 'RESOLVED', 'Choose In progress or Resolved.');
  need(status === r.status || ST.indexOf(status) === ST.indexOf(r.status) + 1, 'A task moves one step at a time: Assigned, In progress, Resolved.', 409);
  db.transaction(() => {
    touch(r.id, status);
    say(r.id, 'Staff', text || `Marked ${LBL[status]}.`);
    tell(r.student_id, status === 'RESOLVED' ? `Your request ${pad(r.id)} was marked Resolved. Please confirm the fix.` : `Your request ${pad(r.id)} is now ${LBL[status]}.`);
  })();
  res.json({ ok: true });
});

app.post('/api/requests/:id/comments', auth(), (req, res) => {
  const r = request(num(req.params.id)), u = req.user, text = str(req.body.text, 1000);
  need(u.role === 'admin' || r.student_id === u.id || r.assigned_to === u.id, 'You are not allowed to comment on this request.', 403);
  need(text, 'Write a comment first.');
  db.transaction(() => {
    say(r.id, BY[u.role], text);
    db.prepare('UPDATE requests SET updated_at=? WHERE id=?').run(Date.now(), r.id);
    tell(u.role === 'student' ? r.assigned_to : r.student_id, `New comment on ${pad(r.id)}.`);
  })();
  res.json({ ok: true });
});

function studentConfirm(ok) {
  return (req, res) => {
    const r = request(num(req.params.id));
    need(r.student_id === req.user.id, 'You can only change your own requests.', 403);
    need(r.status === 'RESOLVED', 'Only resolved requests can be confirmed or reopened.', 409);
    db.transaction(() => {
      touch(r.id, ok ? 'CLOSED' : 'IN_PROGRESS');
      say(r.id, 'Student', ok ? 'Confirmed fixed.' : 'Not fixed, request reopened.');
      if (!ok) tell(r.assigned_to, `Request ${pad(r.id)} was reopened by the student.`);
    })();
    res.json({ ok: true });
  };
}
app.post('/api/requests/:id/confirm', auth('student'), studentConfirm(true));
app.post('/api/requests/:id/reopen', auth('student'), studentConfirm(false));

/* ---------- notifications, hostels, users ---------- */
app.post('/api/notifications/read-all', auth(), (req, res) => { db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });

app.post('/api/hostels', auth('admin'), (req, res) => {
  const name = str(req.body.name, 80), room = str(req.body.room, 20);
  need(name, 'Enter a hostel name.');
  db.transaction(() => {
    let h = db.prepare('SELECT * FROM hostels WHERE lower(name)=lower(?)').get(name);
    if (!h) h = { id: db.prepare('INSERT INTO hostels(name) VALUES (?)').run(name).lastInsertRowid };
    if (room) {
      need(!db.prepare('SELECT 1 FROM rooms WHERE hostel_id=? AND number=?').get(h.id, room), 'That room already exists.', 409);
      db.prepare('INSERT INTO rooms(hostel_id, number) VALUES (?,?)').run(h.id, room);
    }
  })();
  res.status(201).json({ ok: true });
});

app.patch('/api/hostels/:id', auth('admin'), (req, res) => {
  const name = str(req.body.name, 80), id = num(req.params.id);
  need(name, 'Enter a hostel name.');
  need(db.prepare('SELECT 1 FROM hostels WHERE id=?').get(id), 'Hostel not found.', 404);
  need(!db.prepare('SELECT 1 FROM hostels WHERE lower(name)=lower(?) AND id<>?').get(name, id), 'A hostel with that name already exists.', 409);
  db.prepare('UPDATE hostels SET name=? WHERE id=?').run(name, id);
  res.json({ ok: true });
});

app.post('/api/users', auth('admin'), (req, res) => {
  const b = req.body, name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), pw = String(b.pw ?? '');
  need(name && email && pw, 'Fill in every field.');
  need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email address.');
  need(pw.length >= 4 && pw.length <= 100, 'Password must have at least 4 characters.');
  need(b.role === 'staff' || b.role === 'admin', 'Choose a role.');
  need(!db.prepare('SELECT 1 FROM users WHERE lower(email)=?').get(email), 'An account with this email already exists.', 409);
  db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)').run(name, email, hash(pw), b.role);
  res.status(201).json({ ok: true });
});

app.post('/api/users/:id/toggle', auth('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(num(req.params.id));
  need(u && u.role !== 'student', 'User not found.', 404);
  const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1").get().c;
  need(!(u.role === 'admin' && u.active && admins <= 1), 'Keep at least one active administrator.', 409);
  db.prepare('UPDATE users SET active=? WHERE id=?').run(u.active ? 0 : 1, u.id);
  res.json({ ok: true });
});

/* ---------- static files and errors ---------- */
app.use('/uploads', express.static(uploadDir, { index: false, dotfiles: 'deny' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid request.' });
  if (!(err instanceof Fail)) console.error(err);
  res.status(err.code || 500).json({ error: err instanceof Fail ? err.message : 'Something went wrong on the server.' });
});

if (require.main === module) app.listen(PORT, () => console.log(`Hostel Maintenance System running at http://localhost:${PORT}`));
module.exports = app;
