/* Hostel Maintenance Management System - front end (plain HTML/CSS/JS).
   Talks to the Express + SQLite API in server.js. All permission checks are enforced
   on the server; the UI only hides actions a role cannot use. */

const ST = ['SUBMITTED', 'UNDER_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const LBL = { SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed' };
const CLS = { SUBMITTED: 's1', UNDER_REVIEW: 's2', ASSIGNED: 's3', IN_PROGRESS: 's4', RESOLVED: 's5', CLOSED: 's6' };
const ROLE = { student: 'Student', admin: 'Administrator', staff: 'Maintenance staff' };
const BY = { student: 'Student', admin: 'Admin', staff: 'Staff' };
const CATS = ['Plumbing', 'Electrical', 'Furniture', 'Other'];
const PRI = ['Low', 'Medium', 'High'];
const DAY = 864e5;

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const val = (id) => (($('#' + id) || {}).value || '').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (id) => '#' + String(id).padStart(3, '0');
const short = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const rel = (t) => { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(t); b.setHours(0, 0, 0, 0); const n = Math.round((a - b) / DAY); return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : short(t); };
const U = (d, id) => d.users.find((x) => x.id === id);
const store = (fn) => { try { return fn(); } catch { return null; } };

/* ---------- API (talks to the Express server) ---------- */
async function api(path, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let res, data = {};
  try { res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw Error('Cannot reach the server. Check that it is running.'); }
  try { data = await res.json(); } catch {}
  if (res.status === 401 && S.user) { signOut(); throw Error('Your session expired. Sign in again.'); }
  if (!res.ok) throw Error(data.error || 'Something went wrong. Try again.');
  return data;
}
const post = (p, b) => api(p, 'POST', b);
async function refresh() { S.D = await api('/api/bootstrap'); S.user = S.D.me; S.hostels = S.D.hostels; }
function startSession(r) { S.token = r.token; S.user = r.user; store(() => sessionStorage.setItem('token', r.token)); }
function signOut() { store(() => sessionStorage.removeItem('token')); Object.assign(S, { token: null, user: null, D: null, edit: null, sel: null, rid: null }); go('login'); }
const fileData = (f) => new Promise((ok, no) => { if (!f) return ok(''); const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(Error('Could not read the photo.')); r.readAsDataURL(f); });

/* ---------- state ---------- */
const S = { token: null, user: null, D: null, hostels: [], view: 'login', sel: null, rid: null, edit: null, fh: 'All hostels', fp: 'Last 30 days' };
const HOME = { student: 'my', admin: 'dash', staff: 'tasks' };
const NAV = {
  student: [['my', 'My requests'], ['new', 'New request'], ['notes', 'Notifications']],
  admin: [['dash', 'Dashboard'], ['reqs', 'Requests'], ['reports', 'Reports'], ['hostels', 'Hostels'], ['users', 'Users']],
  staff: [['tasks', 'My tasks']],
};

/* ---------- view helpers ---------- */
const badge = (s) => `<span class="b ${CLS[s]}">${LBL[s]}</span>`;
const prio = (p) => (p === 'High' ? '<span class="hi">High</span>' : p);
const issue = (r) => `${esc(r.title)}${/room/i.test(r.title) || r.room.startsWith('Corridor') ? '' : ', Room ' + esc(r.room)}`;
const steps = (s) => { const i = ST.indexOf(s); return `<div class="steps">${ST.map((k, n) => `<div class="st${n <= i ? ' d' : ''}"><i></i>${LBL[k]}</div>`).join('')}</div>`; };
const opts = (list, sel) => list.map((o) => `<option${o === sel ? ' selected' : ''}>${esc(o)}</option>`).join('');
const mine = (d) => d.requests.filter((r) => S.user.role === 'admin' || (S.user.role === 'student' ? r.studentId === S.user.id : r.assignedTo === S.user.id)).sort((a, b) => b.updatedAt - a.updatedAt);
const staffList = (d) => d.users.filter((x) => x.role === 'staff' && x.active);
const staffOpts = (d, ph) => `<option value="">${ph}</option>${staffList(d).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}`;
const page = (body, o = {}) => `<div class="app"><div class="nav"><span class="brand">Hostel Maintenance</span><span>${o.nav || ''}</span></div>${body}</div>`;

function navLinks(d) {
  const u = S.user, un = d.notes.filter((n) => n.userId === u.id && !n.read).length;
  return NAV[u.role].map(([v, t]) => `<a data-v="${v}"${S.view === v ? ' class="on"' : ''}>${t}${v === 'notes' && un ? ` (${un})` : ''}</a>`).join('') + `<a><b>${ROLE[u.role]}</b></a><a data-act="out">Sign out</a>`;
}

const tableReqs = (rs, extra) => `<table><tr><th>ID</th><th>Issue</th><th>Category</th><th>Priority</th><th>Status</th><th>Updated</th>${extra ? '<th></th>' : ''}</tr>${rs.map((r) => `<tr class="${S.sel === r.id ? 'sel' : ''}"><td>${pad(r.id)}</td><td><a class="lnk" data-act="pick" data-id="${r.id}">${issue(r)}</a></td><td>${esc(r.category)}</td><td>${prio(r.priority)}</td><td>${badge(r.status)}</td><td>${rel(r.updatedAt)}</td>${extra ? `<td><button class="btn btn2" data-v="review" data-id="${r.id}" style="padding:8px 14px">Review</button></td>` : ''}</tr>`).join('')}</table>`;

/* ---------- screens ---------- */
const V = {
  login() {
    return page(`<div class="main" style="max-width:960px;padding-top:64px"><div class="row" style="gap:40px"><div class="f"><h1 style="font-size:36px">Report it. Track it. See it fixed.</h1><p class="sub">One place for residents, administrators and maintenance staff to handle hostel repairs.</p>${steps('CLOSED')}</div>
    <form class="card f" id="login"><h2>Sign in</h2><div class="fld"><label for="u">Registration number or email</label><input id="u" autocomplete="username"></div><div class="fld"><label for="p">Password</label><input id="p" type="password" autocomplete="current-password"></div><button class="btn" style="width:100%">Sign in</button>
    <p style="margin:16px 0 0;font-size:14px">New student? <a class="lnk" data-v="register">Create an account</a></p>
    <p class="muted" style="margin:12px 0 0;font-size:13px">Demo accounts, password demo: student@hostel.test, admin@hostel.test, staff@hostel.test</p></form></div></div>`, { nav: '<a><b>Sign in</b></a>' });
  },
  register(d) {
    return page(`<div class="main" style="max-width:640px"><h1>Create your student account</h1><p class="sub">Use your registration number so requests link to your room.</p><form class="card" id="register">
    <div class="fld"><label for="n">Full name</label><input id="n"></div>
    <div class="row"><div class="f fld"><label for="rn">Registration number</label><input id="rn"></div><div class="f fld"><label for="e">Email</label><input id="e" type="email"></div></div>
    <div class="row"><div class="f fld"><label for="h">Hostel</label><select id="h"><option value="">Select hostel</option>${opts(d.hostels.map((h) => h.name))}</select></div><div class="f fld"><label for="r">Room number</label><input id="r"></div></div>
    <div class="row"><div class="f fld"><label for="pw">Password</label><input id="pw" type="password" autocomplete="new-password"></div><div class="f fld"><label for="pw2">Confirm password</label><input id="pw2" type="password" autocomplete="new-password"></div></div>
    <button class="btn" style="width:100%">Create account</button><p style="margin:16px 0 0;font-size:14px">Already registered? <a class="lnk" data-v="login">Sign in</a></p></form></div>`, { nav: '<a><b>Register</b></a>' });
  },
  my(d) {
    const rs = mine(d), cur = rs.find((r) => r.id === S.sel) || rs[0];
    const last = cur && cur.comments[cur.comments.length - 1];
    return page(`<div class="main"><h1>My requests</h1><p class="sub">Live status of everything you have reported.</p>${rs.length ? `<div class="card sc" style="margin-bottom:20px">${tableReqs(rs)}</div>
    <div class="card"><h2>${pad(cur.id)} ${issue(cur)}</h2>${steps(cur.status)}${last ? `<p style="margin:20px 0 0;font-size:14px"><b>${last.by === 'Staff' ? 'Maintenance staff' : last.by}:</b> ${esc(last.text)}</p>` : ''}<p style="margin:16px 0 0"><button class="btn btn2" data-v="detail" data-id="${cur.id}">View full details</button></p></div>`
      : '<div class="card">You have not reported anything yet. Select New request to report a problem.</div>'}</div>`, { nav: navLinks(d) });
  },
  new(d) {
    const u = S.user;
    return page(`<div class="main"><h1>Report a maintenance issue</h1><p class="sub">Tell us what is wrong and where. You can follow progress from My requests.</p><div class="row"><form class="card f" style="flex:2" id="newreq">
    <div class="row"><div class="f fld"><label for="h">Hostel</label><select id="h"><option value="">Select hostel</option>${opts(d.hostels.map((h) => h.name), u.hostel)}</select></div><div class="f fld"><label for="r">Room number</label><input id="r" value="${esc(u.room)}"></div></div>
    <div class="row"><div class="f fld"><label for="c">Category</label><select id="c">${opts(CATS)}</select></div><div class="f fld"><label for="pr">Priority</label><select id="pr">${opts(PRI, 'Medium')}</select></div></div>
    <div class="fld"><label for="t">Issue title</label><input id="t"></div><div class="fld"><label for="d">Description</label><textarea id="d" rows="4"></textarea></div>
    <div class="fld"><label for="ph">Photo (optional)</label><input id="ph" type="file" accept="image/*"></div><button class="btn">Submit request</button></form>
    <div class="card f"><h2>What happens next</h2><p>1. An administrator reviews your request.</p><p>2. It is assigned to maintenance staff.</p><p>3. Staff post progress updates and comments.</p><p>4. You are notified when it is resolved.</p></div></div></div>`, { nav: navLinks(d) });
  },
  detail(d) {
    const r = d.requests.find((x) => x.id === S.rid); if (!r) return V[HOME[S.user.role]](d);
    const stu = U(d, r.studentId), u = S.user;
    return page(`<div class="main"><h1>${pad(r.id)} ${issue(r)} ${badge(r.status)}</h1><p class="sub">${esc(r.hostel)}, ${esc(r.category)}, ${prio(r.priority)} priority, submitted ${short(r.createdAt)}${u.role !== 'student' && stu ? ', by ' + esc(stu.name) : ''}</p>
    <div class="card" style="margin-bottom:20px">${steps(r.status)}</div>
    <div class="row"><div class="card f"><h2>Description</h2><p style="margin:0">${esc(r.description)}</p>${r.photo ? `<img class="photo" src="/uploads/${esc(r.photo)}" alt="Photo attached by student">` : ''}</div>
    <form class="card f" id="comment" data-id="${r.id}"><h2>Updates and comments</h2>${r.comments.length ? r.comments.map((c, i) => `<p style="margin:0 0 ${i === r.comments.length - 1 ? 16 : 12}px"><b>${c.by}:</b> ${esc(c.text)}</p>`).join('') : '<p class="muted" style="margin:0 0 16px">No updates yet.</p>'}
    <div class="fld"><label for="c">Add a comment</label><textarea id="c" rows="2"></textarea></div><button class="btn btn2">Post comment</button></form></div>
    ${u.role === 'student' && r.studentId === u.id ? `<div class="card" style="margin-top:20px"><h2>Once marked resolved</h2><button class="btn" data-act="confirm" data-id="${r.id}"${r.status === 'RESOLVED' ? '' : ' disabled'}>Confirm fixed</button><button class="btn btn2" data-act="reopen" data-id="${r.id}"${r.status === 'RESOLVED' ? '' : ' disabled'}>Not fixed, reopen</button></div>` : ''}</div>`, { nav: navLinks(d) });
  },
  notes(d) {
    const ns = d.notes.filter((n) => n.userId === S.user.id).sort((a, b) => b.at - a.at);
    return page(`<div class="main" style="max-width:800px"><h1>Notifications</h1><p class="sub">Updates on your requests appear here.</p>${ns.map((n) => `<div class="card note${n.read ? '' : ' un'}"><span${n.read ? '' : ' style="font-weight:600"'}>${esc(n.text)}</span><span class="muted">${rel(n.at)}</span></div>`).join('') || '<div class="card note">No notifications yet.</div>'}<button class="btn btn2" data-act="readall">Mark all as read</button></div>`, { nav: navLinks(d) });
  },
  dash(d) {
    const open = d.requests.filter((r) => r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW').sort((a, b) => PRI.indexOf(b.priority) - PRI.indexOf(a.priority) || b.id - a.id);
    const wk = d.requests.filter((r) => r.resolvedAt && r.resolvedAt > Date.now() - 7 * DAY).length;
    const cnt = CATS.map((c) => [c, d.requests.filter((r) => r.category === c).length]).sort((a, b) => b[1] - a[1]).slice(0, 3), max = Math.max(1, cnt[0][1]);
    return page(`<div class="main"><h1>Dashboard</h1><p class="sub">Review, prioritise and assign incoming requests.</p>
    <div class="row" style="margin-bottom:20px"><div class="card stat"><b>${open.length}</b>Awaiting review</div><div class="card stat"><b>${d.requests.filter((r) => r.status === 'ASSIGNED' || r.status === 'IN_PROGRESS').length}</b>In progress</div><div class="card stat"><b>${wk}</b>Resolved this week</div></div>
    <div class="row"><div class="card sc f" style="flex:3"><h2>Needs review</h2><table><tr><th>ID</th><th>Issue</th><th>Category</th><th>Priority</th><th>Assign to</th><th></th></tr>${open.map((r) => `<tr><td>${pad(r.id)}</td><td><a class="lnk" data-v="review" data-id="${r.id}">${issue(r)}</a></td><td>${esc(r.category)}</td><td>${prio(r.priority)}</td><td><select aria-label="Assign ${pad(r.id)}">${staffOpts(d, 'Choose staff')}</select></td><td><button class="btn" data-act="qassign" data-id="${r.id}" style="padding:8px 14px">Assign</button></td></tr>`).join('') || '<tr><td colspan="6">Nothing is waiting for review.</td></tr>'}</table></div>
    <div class="card f"><h2>Recurring issues</h2>${cnt.map(([c, n]) => `${c}<div class="bar" style="width:${Math.max(6, Math.round((n / max) * 90))}%"></div>`).join('')}</div></div></div>`, { nav: navLinks(d) });
  },
  reqs(d) {
    return page(`<div class="main"><h1>Requests</h1><p class="sub">Every request from every hostel. Open one to review it.</p><div class="card sc">${tableReqs(mine(d), true)}</div></div>`, { nav: navLinks(d) });
  },
  review(d) {
    const r = d.requests.find((x) => x.id === S.rid); if (!r) return V.reqs(d);
    const stu = U(d, r.studentId), openR = r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW';
    return page(`<div class="main"><h1>Review ${pad(r.id)} ${badge(r.status)}</h1><p class="sub">${issue(r)}. Reported by ${stu ? esc(stu.name) : 'a student'} in ${esc(r.hostel)}, Room ${esc(r.room)}.</p><div class="row">
    <div class="card f"><h2>Request</h2><p style="margin:0">${esc(r.description)}</p>${r.photo ? `<img class="photo" src="/uploads/${esc(r.photo)}" alt="Photo attached by student">` : ''}<p style="margin:12px 0 0;font-size:14px;color:#4A5A62">Category: ${esc(r.category)}. Priority set by student: ${prio(r.priority)}.</p></div>
    <div class="card f"><h2>Decision</h2>${openR ? `<div class="row"><div class="f fld"><label for="c">Category</label><select id="c">${opts(CATS, r.category)}</select></div><div class="f fld"><label for="pr">Priority</label><select id="pr">${opts(['High', 'Medium', 'Low'], r.priority)}</select></div></div>
    <div class="fld"><label for="a">Assign to</label><select id="a">${staffOpts(d, 'Choose maintenance staff')}</select></div><div class="fld"><label for="n">Note to staff and student</label><textarea id="n" rows="3"></textarea></div>
    <button class="btn" data-act="assign" data-id="${r.id}">Assign and notify</button><button class="btn btn2" data-act="review" data-id="${r.id}"${r.status === 'SUBMITTED' ? '' : ' disabled'}>Mark under review</button><button class="btn btn2" data-act="reject" data-id="${r.id}">Reject or mark duplicate</button>`
      : `<p style="margin:0 0 16px">This request is ${LBL[r.status].toLowerCase()}, so it no longer needs a decision.</p><button class="btn btn2" data-v="detail" data-id="${r.id}">View details</button>`}</div></div></div>`, { nav: navLinks(d) });
  },
  reports(d) {
    const days = { 'Last 7 days': 7, 'Last 30 days': 30, 'This semester': 1e4 }[S.fp], now = Date.now();
    const rs = d.requests.filter((r) => (S.fh === 'All hostels' || r.hostel === S.fh) && r.createdAt >= now - days * DAY), done = rs.filter((r) => r.resolvedAt);
    const avg = done.length ? (done.reduce((s, r) => s + (r.resolvedAt - r.createdAt) / DAY, 0) / done.length).toFixed(1) + ' days' : 'None yet';
    const isOpen = (r) => r.status !== 'RESOLVED' && r.status !== 'CLOSED';
    const rooms = {}; rs.forEach((r) => { const k = `${r.hostel}, Room ${r.room}`; rooms[k] = (rooms[k] || 0) + 1; });
    const rep = Object.entries(rooms).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return page(`<div class="main"><h1>Maintenance reports</h1><p class="sub">Spot patterns and unresolved work.</p>
    <div class="row" style="margin-bottom:20px"><div class="f fld"><label for="fh">Hostel</label><select id="fh">${opts(['All hostels', ...d.hostels.map((h) => h.name)], S.fh)}</select></div><div class="f fld"><label for="fp">Period</label><select id="fp">${opts(['Last 30 days', 'Last 7 days', 'This semester'], S.fp)}</select></div></div>
    <div class="row" style="margin-bottom:20px"><div class="card stat"><b>${rs.length}</b>Requests in period</div><div class="card stat"><b>${avg}</b>Average time to resolve</div><div class="card stat"><b>${rs.filter(isOpen).length}</b>Still unresolved</div></div>
    <div class="row"><div class="card sc f"><h2>By category</h2><table><tr><th>Category</th><th>Requests</th><th>Open</th></tr>${CATS.map((c) => `<tr><td>${c}</td><td>${rs.filter((r) => r.category === c).length}</td><td>${rs.filter((r) => r.category === c && isOpen(r)).length}</td></tr>`).join('')}</table></div>
    <div class="card sc f"><h2>Rooms with repeat issues</h2><table><tr><th>Room</th><th>Requests</th></tr>${rep.map(([k, n]) => `<tr><td>${esc(k)}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2">No requests in this period.</td></tr>'}</table></div></div></div>`, { nav: navLinks(d) });
  },
  hostels(d) {
    return page(`<div class="main"><h1>Hostels and rooms</h1><p class="sub">These feed the hostel and room choices on the student request form.</p><div class="row">
    <div class="card sc f" style="flex:2"><h2>Hostels</h2><table><tr><th>Hostel</th><th>Rooms</th><th></th></tr>${d.hostels.map((h) => `<tr><td>${esc(h.name)}</td><td>${h.rooms.length}</td><td><button class="btn btn2" data-act="edithostel" data-id="${h.id}">Edit</button></td></tr>`).join('')}</table></div>
    <form class="card f" id="hostelform"><h2>${S.edit ? 'Rename hostel' : 'Add hostel or room'}</h2><div class="fld"><label for="hn">Hostel name</label><input id="hn" value="${esc((d.hostels.find((h) => h.id === S.edit) || {}).name || '')}"></div>
    ${S.edit ? '' : '<div class="fld"><label for="rn">Room number</label><input id="rn"></div>'}<button class="btn">${S.edit ? 'Save name' : 'Add'}</button>${S.edit ? '<button type="button" class="btn btn2" data-act="canceledit">Cancel</button>' : ''}</form></div></div>`, { nav: navLinks(d) });
  },
  users(d) {
    return page(`<div class="main"><h1>User management</h1><p class="sub">Create staff and administrator accounts and control who has access.</p><div class="row">
    <div class="card sc f" style="flex:2"><h2>Staff and administrators</h2><table><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr>${d.users.filter((x) => x.role !== 'student').map((x) => `<tr><td>${esc(x.name)}</td><td>${ROLE[x.role]}</td><td>${x.active ? 'Active' : 'Deactivated'}</td><td><button class="btn btn2" data-act="toggle" data-id="${x.id}">${x.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('')}</table></div>
    <form class="card f" id="createuser"><h2>Create account</h2><div class="fld"><label for="n">Full name</label><input id="n"></div><div class="fld"><label for="e">Email</label><input id="e" type="email"></div>
    <div class="fld"><label for="r">Role</label><select id="r"><option value="staff">Maintenance staff</option><option value="admin">Administrator</option></select></div><div class="fld"><label for="p">Temporary password</label><input id="p" type="password" autocomplete="new-password"></div><button class="btn">Create account</button></form></div></div>`, { nav: navLinks(d) });
  },
  tasks(d) {
    const rs = mine(d), cur = rs.find((r) => r.id === S.sel) || rs.find((r) => r.status === 'IN_PROGRESS' || r.status === 'ASSIGNED') || rs[0];
    const can = cur && (cur.status === 'ASSIGNED' || cur.status === 'IN_PROGRESS');
    return page(`<div class="main"><h1>My assigned tasks</h1><p class="sub">Update progress as you work. Students see changes immediately.</p><div class="row"><div class="f">${rs.map((r) => `<div class="card" style="margin-bottom:16px${cur && cur.id === r.id ? ';border-color:#0F5F57' : ''}"><a class="lnk" data-act="pick" data-id="${r.id}" style="text-decoration:none;color:inherit"><b>${pad(r.id)} ${issue(r)}</b></a><p style="margin:8px 0 0">${badge(r.status)}</p></div>`).join('') || '<div class="card">No tasks are assigned to you right now.</div>'}</div>
    ${cur ? `<form class="card f" id="update" data-id="${cur.id}"><h2>Update ${pad(cur.id)}</h2>${can ? `<div class="fld"><label for="s">Status</label><select id="s"><option value="IN_PROGRESS"${cur.status === 'IN_PROGRESS' ? ' selected' : ''}>In progress</option><option value="RESOLVED">Resolved</option></select></div>
    <div class="fld"><label for="cm">Progress comment</label><textarea id="cm" rows="4"></textarea></div><button class="btn">Save update</button>` : `<p>This task is ${LBL[cur.status].toLowerCase()}, so there is nothing left to update.</p>`}<p style="margin:16px 0 0"><button type="button" class="btn btn2" data-v="detail" data-id="${cur.id}">View details</button></p></form>` : ''}</div></div>`, { nav: navLinks(d) });
  },
};

/* ---------- render + events ---------- */
function render() {
  const d = S.user && S.D ? S.D : { hostels: S.hostels, users: [], requests: [], notes: [] };
  $('#app').innerHTML = V[S.view](d);
}
const go = (v, x) => { S.view = v; Object.assign(S, x || {}); render(); window.scrollTo(0, 0); };
let tt;
function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.className = 'on' + (bad ? ' bad' : ''); clearTimeout(tt); tt = setTimeout(() => (t.className = ''), 2800); }
let busy = false;
const guard = (fn) => async (e) => {
  if (busy) return;
  busy = true;
  try { await fn(e); } catch (x) { toast(x.message, true); } finally { busy = false; }
};

document.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('[data-v],[data-act]'); if (!t) return;
  const D = t.dataset, id = +D.id;
  if (D.v) return go(D.v, D.id ? { rid: id, sel: id } : {});
  switch (D.act) {
    case 'out': return signOut();
    case 'pick': return go(S.view, { sel: id });
    case 'qassign': await post(`/api/requests/${id}/assign`, { staffId: +t.closest('tr').querySelector('select').value }); toast(pad(id) + ' assigned'); break;
    case 'assign': await post(`/api/requests/${id}/assign`, { staffId: +val('a'), category: val('c'), priority: val('pr'), note: val('n') }); toast(pad(id) + ' assigned'); await refresh(); return go('reqs');
    case 'review': await post(`/api/requests/${id}/review`, { note: val('n') }); toast(pad(id) + ' is under review'); break;
    case 'reject': await post(`/api/requests/${id}/reject`, { note: val('n') }); toast(pad(id) + ' closed'); await refresh(); return go('reqs');
    case 'confirm': await post(`/api/requests/${id}/confirm`); toast('Thanks for confirming'); break;
    case 'reopen': await post(`/api/requests/${id}/reopen`); toast('Request reopened'); break;
    case 'readall': await post('/api/notifications/read-all'); break;
    case 'edithostel': S.edit = id; return render();
    case 'canceledit': S.edit = null; return render();
    case 'toggle': await post(`/api/users/${id}/toggle`); break;
    default: return;
  }
  await refresh(); render();
}));

document.addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = e.target, id = +f.dataset.id;
  switch (f.id) {
    case 'login': startSession(await post('/api/auth/login', { id: val('u'), pw: $('#p').value })); await refresh(); return go(HOME[S.user.role]);
    case 'register': startSession(await post('/api/auth/register', { name: val('n'), reg: val('rn'), email: val('e'), hostel: val('h'), room: val('r'), pw: $('#pw').value })); await refresh(); return go('my');
    case 'newreq': {
      if ($('#pw2')) return;
      const photoData = await fileData($('#ph').files[0]);
      const r = await post('/api/requests', { hostel: val('h'), room: val('r'), category: val('c'), priority: val('pr'), title: val('t'), desc: val('d'), photoData });
      await refresh(); toast('Request ' + pad(r.id) + ' submitted'); return go('my', { sel: r.id });
    }
    case 'comment': await post(`/api/requests/${id}/comments`, { text: val('c') }); toast('Comment posted'); break;
    case 'update': await post(`/api/requests/${id}/update`, { status: val('s'), text: val('cm') }); toast('Update saved'); break;
    case 'hostelform':
      if (S.edit) { await api(`/api/hostels/${S.edit}`, 'PATCH', { name: val('hn') }); toast('Hostel renamed'); S.edit = null; }
      else { await post('/api/hostels', { name: val('hn'), room: val('rn') }); toast('Saved'); }
      break;
    case 'createuser': await post('/api/users', { name: val('n'), email: val('e'), role: val('r'), pw: $('#p').value }); toast('Account created'); break;
    default: return;
  }
  await refresh(); render();
}));

document.addEventListener('change', (e) => {
  if (e.target.id === 'fh') { S.fh = e.target.value; render(); }
  if (e.target.id === 'fp') { S.fp = e.target.value; render(); }
});

(async () => {
  try { S.hostels = (await api('/api/hostels')).hostels; } catch {}
  S.token = store(() => sessionStorage.getItem('token'));
  if (S.token) { try { await refresh(); S.view = HOME[S.user.role]; } catch { S.token = null; S.user = null; } }
  render();
})();
