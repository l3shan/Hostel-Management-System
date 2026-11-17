// SQLite layer: schema, password hashing and demo seed data (better-sqlite3).
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(process.env.DB_FILE || path.join(dataDir, 'hostel.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS hostels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  hostel_id INTEGER NOT NULL REFERENCES hostels(id),
  number TEXT NOT NULL,
  UNIQUE (hostel_id, number)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  reg TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','admin','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  hostel_id INTEGER REFERENCES hostels(id),
  room TEXT
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  hostel_id INTEGER NOT NULL REFERENCES hostels(id),
  room TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Plumbing','Electrical','Furniture','Other')),
  priority TEXT NOT NULL CHECK (priority IN ('Low','Medium','High')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED','UNDER_REVIEW','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED')),
  assigned_to INTEGER REFERENCES users(id),
  photo TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  by_role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_req_student ON requests(student_id);
CREATE INDEX IF NOT EXISTS idx_req_staff ON requests(assigned_to);
CREATE INDEX IF NOT EXISTS idx_req_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_comments_req ON comments(request_id);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notifications(user_id);
`);

function hash(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verify(pw, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const test = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  const real = Buffer.from(key, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}

// Demo data, only inserted into an empty database. Every demo password is "demo".
function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  if (process.env.SEED_DEMO_DATA === 'false') {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password || password.length < 16) {
      throw new Error('Production initialization requires ADMIN_EMAIL and an ADMIN_PASSWORD of at least 16 characters.');
    }

    db.transaction(() => {
      const addHostel = db.prepare('INSERT INTO hostels(name) VALUES (?)');
      const addRoom = db.prepare('INSERT INTO rooms(hostel_id, number) VALUES (?,?)');
      const hA = addHostel.run('Hostel A').lastInsertRowid, hB = addHostel.run('Hostel B').lastInsertRowid;
      for (let i = 1; i <= 24; i++) addRoom.run(hA, String(i));
      for (let i = 1; i <= 30; i++) addRoom.run(hB, String(i));
      db.prepare('INSERT INTO users(id,name,email,password_hash,role) VALUES (1,?,?,?,?)')
        .run('Administrator', email, hash(password), 'admin');
    })();
    return;
  }

  const D = 864e5, n = Date.now();
  db.transaction(() => {
    const addHostel = db.prepare('INSERT INTO hostels(name) VALUES (?)');
    const addRoom = db.prepare('INSERT INTO rooms(hostel_id, number) VALUES (?,?)');
    const hA = addHostel.run('Hostel A').lastInsertRowid, hB = addHostel.run('Hostel B').lastInsertRowid;
    for (let i = 1; i <= 24; i++) addRoom.run(hA, String(i));
    for (let i = 1; i <= 30; i++) addRoom.run(hB, String(i));

    const pw = hash('demo');
    const addUser = db.prepare('INSERT INTO users(id,name,email,reg,password_hash,role,hostel_id,room) VALUES (?,?,?,?,?,?,?,?)');
    addUser.run(1, 'Amina Wanjiru', 'student@hostel.test', 'S2026/001', pw, 'student', hA, '12');
    addUser.run(2, 'Mr. Otieno', 'admin@hostel.test', null, pw, 'admin', null, null);
    addUser.run(3, 'Peter Kamau', 'staff@hostel.test', null, pw, 'staff', null, null);
    addUser.run(4, 'Grace Achieng', 'grace@hostel.test', null, pw, 'staff', null, null);
    addUser.run(5, 'Brian Mutua', 'brian@hostel.test', 'S2026/002', pw, 'student', hB, '21');

    const addReq = db.prepare(`INSERT INTO requests(id,student_id,title,hostel_id,room,category,priority,description,status,assigned_to,photo,created_at,updated_at,resolved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`);
    const addCom = db.prepare('INSERT INTO comments(request_id,by_role,text,created_at) VALUES (?,?,?,?)');
    const q = (id, sid, title, h, room, cat, pri, desc, status, staff, ago, upd, comments) => {
      const done = status === 'RESOLVED' || status === 'CLOSED';
      addReq.run(id, sid, title, h, room, cat, pri, desc, status, staff, n - ago * D, n - upd * D, done ? n - upd * D : null);
      comments.forEach(([by, text], i) => addCom.run(id, by, text, n - (ago - i) * D));
    };
    q(87, 1, 'Flickering light', hA, '12', 'Electrical', 'Medium', 'The ceiling light flickers and switches off by itself.', 'RESOLVED', 4, 12, 10, [['Admin', 'Assigned to maintenance staff.'], ['Staff', 'Replaced the fitting.']]);
    q(98, 1, 'Broken desk chair', hA, '12', 'Furniture', 'Low', 'The study chair has a broken leg.', 'ASSIGNED', 4, 5, 1, [['Admin', 'Assigned to maintenance staff.']]);
    q(99, 5, 'Replace bulb, Corridor B', hB, 'Corridor B', 'Electrical', 'Low', 'The corridor bulb outside Room 20 is out.', 'ASSIGNED', 3, 3, 2, [['Admin', 'Assigned to maintenance staff.']]);
    q(101, 1, 'Leaking tap', hA, '12', 'Plumbing', 'High', 'The tap in the room basin has been leaking since Sunday and the floor is wet.', 'IN_PROGRESS', 3, 7, 0, [['Admin', 'Assigned to plumbing staff.'], ['Staff', 'Pipe fitting ordered, fixing tomorrow morning.']]);
    q(102, 5, 'Cracked window', hA, '3', 'Other', 'Medium', 'The window pane is cracked from corner to corner.', 'SUBMITTED', null, 2, 2, []);
    q(103, 5, 'Socket sparking', hA, '7', 'Electrical', 'High', 'The socket by the bed sparks when I plug in a charger.', 'SUBMITTED', null, 1, 1, []);
    q(104, 5, 'No hot water, Block A', hB, '21', 'Plumbing', 'High', 'There has been no hot water in the whole block since Monday.', 'SUBMITTED', null, 1, 1, []);

    const addNote = db.prepare('INSERT INTO notifications(user_id,text,read,created_at) VALUES (?,?,?,?)');
    addNote.run(1, 'Your request #101 is now In progress.', 0, n);
    addNote.run(1, 'Your request #087 was marked Resolved. Please confirm the fix.', 0, n - 10 * D);
    addNote.run(1, 'Your request #098 was assigned to maintenance staff.', 1, n - 1 * D);
  })();
}

module.exports = { db, hash, verify, seed };
