const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Client, GatewayIntentBits } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');

/* ─── CERTIFICATE IMAGE RENDERER ─── */
function renderCertImage(c) {
  const s=4, w=Math.round(700*s), h=Math.round(370*s); const canvas=createCanvas(w,h); const ctx=canvas.getContext('2d');
  const font = (sz,w) => `${w||'normal'} ${Math.round(sz*s)}px "Cairo",Arial,sans-serif`;
  const gold='#c9a84c', light='#fff9f0', muted='#5a6a7a';
  const S=(v)=>Math.round(v*s);

  ctx.fillStyle=light; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle=gold; ctx.lineWidth=S(4); ctx.strokeRect(S(12),S(12),w-S(24),h-S(24));
  ctx.lineWidth=S(2); ctx.strokeRect(S(18),S(18),w-S(36),h-S(36));

  const dc=(x,y,d1,d2)=>{ ctx.beginPath(); ctx.moveTo(S(x),S(y)); ctx.lineTo(S(x+d1),S(y)); ctx.moveTo(S(x),S(y)); ctx.lineTo(S(x),S(y+d2)); ctx.strokeStyle=gold; ctx.lineWidth=S(2); ctx.stroke(); };
  dc(22,22,24,0);dc(22,22,0,24);dc(w-S(22),S(22),-24,0);dc(w-S(22),S(22),0,24);
  dc(22,h-S(22),24,0);dc(22,h-S(22),0,-24);dc(w-S(22),h-S(22),-24,0);dc(w-S(22),h-S(22),0,-24);

  ctx.fillStyle='#1a3a5c'; ctx.font=font(16,'bold'); ctx.textAlign='center';
  const tls={'PROMOTION':'CERTIFICATE OF PROMOTION','TRAINING':'CERTIFICATE OF TRAINING','EXCELLENCE':'CERTIFICATE OF EXCELLENCE','GRADUATION':'CERTIFICATE OF GRADUATION'};
  ctx.fillText(tls[c.cert_type]||'CERTIFICATE', w/2, S(62));
  ctx.fillStyle='#8a7a4a'; ctx.font=font(10); ctx.fillText('LSPD — LOS SANTOS POLICE DEPARTMENT', w/2, S(82));

  ctx.strokeStyle=gold; ctx.lineWidth=S(1); ctx.beginPath(); ctx.moveTo(S(60),S(92)); ctx.lineTo(w-S(60),S(92)); ctx.stroke();
  ctx.font=font(28); ctx.fillStyle=gold; ctx.fillText('⭐', w/2, S(128));
  ctx.beginPath(); ctx.moveTo(S(60),S(138)); ctx.lineTo(w-S(60),S(138)); ctx.stroke();

  ctx.fillStyle=muted; ctx.font=font(9); ctx.fillText('THIS CERTIFIES THAT', w/2, S(158));
  ctx.fillStyle='#1a3a5c'; ctx.font=font(28,'bold'); ctx.fillText(c.officer_name.toUpperCase(), w/2, S(194));
  ctx.fillStyle=muted; ctx.font=font(10); ctx.fillText('has been awarded the rank of', w/2, S(216));
  ctx.fillStyle=gold; ctx.font=font(22,'bold'); ctx.fillText(c.rank_name, w/2, S(247));

  ctx.fillStyle=muted; ctx.font=font(9); ctx.textAlign='center';
  ctx.fillText('In recognition of outstanding performance and dedication', w/2, S(274));
  ctx.fillText('to the Los Santos Police Department.', w/2, S(288));

  ctx.strokeStyle='#e0d5b8'; ctx.lineWidth=S(1); ctx.beginPath(); ctx.moveTo(S(40),S(300)); ctx.lineTo(w-S(40),S(300)); ctx.stroke();
  ctx.font=font(20); ctx.fillStyle=gold; ctx.textAlign='center'; ctx.fillText('👑', w/2, S(328));

  ctx.fillStyle=muted; ctx.font=font(8); ctx.textAlign='left';
  ctx.fillText(`Awarded on: ${c.issue_date||'—'}`, S(50), S(338));
  ctx.fillStyle='#8a7a4a'; ctx.font=font(7); ctx.fillText(`ID: ${c.id||'—'}`, S(50), S(350));
  ctx.textAlign='right'; ctx.fillStyle=muted; ctx.font=font(8);
  ctx.fillText('Authorized by', w-S(50), S(328));
  ctx.fillStyle='#1a3a5c'; ctx.font=font(13,'bold'); ctx.fillText(c.issued_name||'Chief of Police', w-S(50), S(348));

  return canvas.toBuffer('image/png');
}

let botClient = null;
let botGuildId = '';
async function initBot() {
  if (botClient) { try { botClient.destroy(); } catch {} botClient = null; }
  const token = dbGet('SELECT value FROM settings WHERE key=?', ['bot_token']);
  const bg = dbGet('SELECT value FROM settings WHERE key=?', ['guild_id']);
  botGuildId = bg ? bg.value : '';
  if (!token || !token.value) return;
  botClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  botClient.on('clientReady', () => console.log('Bot online:', botClient.user.tag));
  botClient.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    const content = msg.content || '';
    if (!content) { msg.reply('⚠️ البوت مايقدر يقرأ الرسائل. تأكد من تفعيل **Message Content Intent** في Developer Portal').catch(()=>{}); return; }
    const prefixes = ['!طلب_اجازة', '!leave'];
    if (!prefixes.some(p => content.startsWith(p))) return;
    const matched = prefixes.find(p => content.startsWith(p));
    const raw = content.slice(matched.length).trim().split('\n').map(s => s.trim()).filter(Boolean);
    console.log('Bot: received:', matched, raw);
    const name = raw[0] || msg.author.displayName || msg.author.username;
    const days = parseInt(raw[1]);
    if (!days || days < 1) { msg.reply('⚠️ استخدم:\n`!طلب_اجازة`\n`الاسم`\n`عدد الأيام`\nمثال:\n`!طلب_اجازة`\n`أحمد`\n`7`'); return; }
    const today = new Date();
    const from_date = today.toISOString().slice(0,10);
    const end = new Date(today); end.setDate(end.getDate() + days);
    const to_date = end.toISOString().slice(0,10);
    const discord_tag = msg.author.tag;
    try {
      dbRun("INSERT INTO leave_requests (name, discord_tag, type, reason, from_date, to_date, source, created_by) VALUES (?,?,?,?,?,?,'discord',NULL)",
        [name, discord_tag, 'annual', 'إجازة ' + days + ' يوم', from_date, to_date]);
      msg.reply('✅ تم استلام طلب الإجازة! سيتم مراجعته من قبل المسؤولين.');
      const wh = getWebhookUrl('webhook_applications');
      if (wh) sendWebhook(wh, { content: `📩 **طلب إجازة جديد**\nالاسم: ${name}\nالمدة: ${days} يوم\nمن: ${from_date}\nإلى: ${to_date}` });
    } catch(e) {
      msg.reply('❌ حدث خطأ: ' + e.message);
    }
  });
  try { await botClient.login(token.value); } catch(e) { console.error('Bot login fail:', e.message); botClient = null; }
}
async function sendDiscordDM(tag, content) {
  if (!botClient || !botGuildId) return;
  const guild = botClient.guilds.cache.get(botGuildId);
  if (!guild) { console.error('Bot: guild not found'); return; }
  try { await guild.members.fetch(); } catch {}
  const member = guild.members.cache.find(m => m.user.tag === tag || m.user.username === tag || m.user.displayName === tag);
  if (!member) { console.error('Bot: member not found:', tag); return; }
  try { await member.send(content); console.log('Bot: DM sent to', tag); } catch(e) { console.error('Bot: DM fail:', e.message); }
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lspd-portal-secret-key-change-in-production';
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data.db');

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ─── FILE UPLOAD CONFIG ─── */
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images, PDFs, and text files allowed'));
  }
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PERMISSIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const PERM = {
  certificates: { OWNER:'full','FULL ACCESS':'full','FTO CHIEF':'full','FTO MEMBER':'full','IA CHIEF':'full','IA MEMBER':'full','WING COMMANDER':'full','WINGS':'full','APPLICANT VIEWER':'full','VISITOR':'full' },
  reports:      { OWNER:'full','FULL ACCESS':'full','FTO CHIEF':'full','FTO MEMBER':'create','IA CHIEF':'full','IA MEMBER':'full','WING COMMANDER':'full','WINGS':'full','APPLICANT VIEWER':'none','VISITOR':'none' },
  applications: { OWNER:'full','FULL ACCESS':'full','FTO CHIEF':'full','FTO MEMBER':'view','IA CHIEF':'full','IA MEMBER':'none','WING COMMANDER':'full','WINGS':'none','APPLICANT VIEWER':'view','VISITOR':'none' },
  logs:         { OWNER:'full','FULL ACCESS':'full','FTO CHIEF':'none','FTO MEMBER':'none','IA CHIEF':'none','IA MEMBER':'none','WING COMMANDER':'none','WINGS':'none','APPLICANT VIEWER':'none','VISITOR':'none' },
  accounts:     { OWNER:'full','FULL ACCESS':'full','FTO CHIEF':'none','FTO MEMBER':'none','IA CHIEF':'none','IA MEMBER':'none','WING COMMANDER':'none','WINGS':'none','APPLICANT VIEWER':'none','VISITOR':'none' },
  settings:     { OWNER:'full','FULL ACCESS':'full','FTO CHIEF':'full','FTO MEMBER':'none','IA CHIEF':'none','IA MEMBER':'none','WING COMMANDER':'none','WINGS':'none','APPLICANT VIEWER':'none','VISITOR':'none' },
  division_members:{ OWNER:'full','FULL ACCESS':'full','FTO CHIEF':'full','FTO MEMBER':'none','IA CHIEF':'full','IA MEMBER':'none','WING COMMANDER':'full','WINGS':'none','APPLICANT VIEWER':'none','VISITOR':'none' }
};

function hasPerm(user, feature, level = 'view') {
  if (user.is_owner) return true;
  const p = PERM[feature]?.[user.role] || 'none';
  if (level === 'view') return p === 'full' || p === 'view' || p === 'create';
  if (level === 'create') return p === 'full' || p === 'create';
  if (level === 'full') return p === 'full';
  return false;
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ DATABASE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
let db;

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function dbQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDB();
  const r = db.exec('SELECT last_insert_rowid() as id, changes() as changes');
  const row = r[0]?.values[0];
  return { lastInsertRowid: row ? row[0] : null, changes: row ? row[1] : 0 };
}

function dbGet(sql, params = []) {
  const rows = dbQuery(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    emoji TEXT DEFAULT 'ًں‘¤',
    role TEXT NOT NULL DEFAULT 'VISITOR',
    is_owner INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    date TEXT DEFAULT (date('now')),
    created_by INTEGER REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'application',
    name TEXT NOT NULL,
    discord TEXT NOT NULL,
    reason TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    date TEXT DEFAULT (date('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    date TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    user_id INTEGER,
    username TEXT,
    details TEXT DEFAULT '',
    date TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_name TEXT NOT NULL,
    cert_type TEXT NOT NULL,
    rank_name TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    issued_by INTEGER,
    issued_name TEXT,
    is_public INTEGER DEFAULT 1,
    date_created TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // Migrate old DB: add columns that might be missing
  try { db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'VISITOR'"); } catch(e) {}
  try { db.run("ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE applications ADD COLUMN type TEXT NOT NULL DEFAULT 'application'"); } catch(e) {}
  try { db.run("ALTER TABLE applications ADD COLUMN answers TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE applications ADD COLUMN current_department TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE public_reports ADD COLUMN rank TEXT NOT NULL DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE public_reports ADD COLUMN link TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE public_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"); } catch(e) {}
  try { db.run("ALTER TABLE users ADD COLUMN discord_id TEXT UNIQUE DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE users ADD COLUMN discord_avatar TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE users ADD COLUMN discord_tag TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE users ADD COLUMN last_seen TEXT DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE applications ADD COLUMN discord_id TEXT DEFAULT ''"); } catch(e) {}

  db.run(`CREATE TABLE IF NOT EXISTS public_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rank TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    link TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    date TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS division_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    division TEXT NOT NULL,
    name TEXT NOT NULL,
    points INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'clock_in',
    timestamp TEXT DEFAULT (datetime('now','localtime')),
    date TEXT DEFAULT (date('now')),
    note TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS uploaded_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    ref_type TEXT DEFAULT '',
    ref_id INTEGER DEFAULT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    discord_tag TEXT DEFAULT '',
    discord_id TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'annual',
    reason TEXT DEFAULT '',
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT 'portal',
    created_by INTEGER REFERENCES users(id),
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // Seed owner
  const owner = dbGet('SELECT id FROM users WHERE is_owner = 1');
  if (!owner) {
    const hash = bcrypt.hashSync('Klk98lkl', 10);
    db.run('INSERT INTO users (username,password,display_name,emoji,role,is_owner) VALUES (?,?,?,?,?,1)',
      ['the king', hash, 'The King', '👑', 'OWNER']);
  }

  // Seed default settings
  const settingsExist = dbGet("SELECT key FROM settings WHERE key='applications_open'");
  if (!settingsExist) {
    db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('applications_open', 'true')");
    db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('transfers_open', 'true')");
  }

  // Seed default announcements
  const annCount = dbGet('SELECT COUNT(*) as c FROM announcements');
  if (annCount.c === 0) {
    db.run('INSERT INTO announcements (title,body,date) VALUES (?,?,?)',
      ['ظپطھط­ ط¨ط§ط¨ ط§ظ„طھظ‚ط¯ظٹظ… ط§ظ„ط±ط³ظ…ظٹ', 'ظٹظڈط¹ظ„ظ† ظ‚ط³ظ… ط§ظ„ظ…ظˆط§ط±ط¯ ط§ظ„ط¨ط´ط±ظٹط© ظپظٹ ط´ط±ط·ط© ظ„ظˆط³ ط³ط§ظ†طھظˆط³ ط¹ظ† ظپطھط­ ط¨ط§ط¨ ط§ظ„طھظ‚ط¯ظٹظ… ط§ظ„ط±ط³ظ…ظٹ ظ„ظ„ظ…طھظ‚ط¯ظ…ظٹظ† ط§ظ„ط¬ط¯ط¯.', '2025-01-01']);
  }

  saveDB();
  console.log('âœ… Database initialized');
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ MIDDLEWARE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function logAction(action, user, details = '') {
  dbRun('INSERT INTO logs (action, user_id, username, details) VALUES (?,?,?,?)',
    [action, user?.id || null, user?.display_name || 'system', details]);
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ AUTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = dbGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Update last_seen
  dbRun("UPDATE users SET last_seen=datetime('now','localtime') WHERE id=?", [user.id]);

  const token = jwt.sign(
    { id: user.id, username: user.username, display_name: user.display_name, role: user.role, is_owner: !!user.is_owner, emoji: user.emoji, discord_id: user.discord_id || null },
    JWT_SECRET, { expiresIn: '24h' }
  );

  logAction('login', user);
  res.json({
    token,
    user: { id: user.id, username: user.username, display_name: user.display_name, emoji: user.emoji, role: user.role, is_owner: !!user.is_owner, discord_id: user.discord_id || null }
  });
});

app.get('/api/me', auth, (req, res) => {
  const user = dbGet('SELECT id, username, display_name, emoji, role, is_owner, discord_id, discord_avatar, discord_tag FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ...user, is_owner: !!user.is_owner });
});

/* USERS / ACCOUNTS (owner only) */
app.get('/api/users', auth, (req, res) => {
  if (!hasPerm(req.user, 'accounts', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const users = dbQuery('SELECT id, username, display_name, emoji, role, is_owner, discord_id, discord_avatar, discord_tag, last_seen, created_at FROM users ORDER BY is_owner DESC, id ASC');
  res.json(users.map(u => ({ ...u, is_owner: !!u.is_owner })));
});

app.post('/api/users', auth, (req, res) => {
  if (!hasPerm(req.user, 'accounts', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { username, password, display_name, emoji, role } = req.body;
  if (!username || !password || !display_name) return res.status(400).json({ error: 'Required fields missing' });

  const exists = dbGet('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (exists) return res.status(409).json({ error: 'Username already exists' });

  const validRoles = Object.keys(PERM.certificates);
  const finalRole = validRoles.includes(role) ? role : 'VISITOR';

  const hash = bcrypt.hashSync(password, 10);
  dbRun('INSERT INTO users (username,password,display_name,emoji,role) VALUES (?,?,?,?,?)',
    [username, hash, display_name, emoji || 'ًں‘¤', finalRole]);

  logAction('create_user', req.user, `Created user: ${username} (${finalRole})`);
  res.json({ success: true });
});

app.put('/api/users/:id', auth, (req, res) => {
  if (!hasPerm(req.user, 'accounts', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const userId = parseInt(req.params.id);
  const target = dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.is_owner) return res.status(403).json({ error: 'Cannot modify owner' });

  const { display_name, emoji, role, password } = req.body;
  if (display_name) dbRun('UPDATE users SET display_name=? WHERE id=?', [display_name, userId]);
  if (emoji) dbRun('UPDATE users SET emoji=? WHERE id=?', [emoji, userId]);
  if (role) {
    const validRoles = Object.keys(PERM.certificates);
    if (validRoles.includes(role)) dbRun('UPDATE users SET role=? WHERE id=?', [role, userId]);
  }
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    dbRun('UPDATE users SET password=? WHERE id=?', [hash, userId]);
  }
  logAction('update_user', req.user, `Updated user: ${target.username}`);
  res.json({ success: true });
});

app.delete('/api/users/:id', auth, (req, res) => {
  if (!hasPerm(req.user, 'accounts', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const target = dbGet('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.is_owner) return res.status(403).json({ error: 'Cannot delete owner' });

  dbRun('DELETE FROM users WHERE id = ?', [req.params.id]);
  logAction('delete_user', req.user, `Deleted user: ${target.username}`);
  res.json({ success: true });
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ANNOUNCEMENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.get('/api/announcements', (req, res) => {
  res.json(dbQuery('SELECT * FROM announcements ORDER BY id DESC'));
});

async function sendWebhook(url, payload) {
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) console.error('Webhook failed:', res.status, await res.text().catch(()=>''));
  } catch (e) {
    console.error('Webhook error:', e.message);
  }
}
async function sendWebhookCert(url, content, name, date, imgUrl) {
  if (!url) return;
  try {
    const res = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ content, embeds:[{ title:'🎓 شهادة رسمية - LSPD', description:`**${name}**\n📅 ${date||'—'}`, color:0xc9a84c, image:{ url:imgUrl }, footer:{ text:'LSPD Portal' } }] })
    });
    if (res.ok) console.log('Cert webhook sent');
    else console.error('Cert webhook fail:', res.status, await res.text().catch(()=>''));
  } catch(e) { console.error('Cert webhook err:', e.message); }
}
app.get('/api/certificates/:id/image', (req, res) => {
  const cert = dbGet('SELECT * FROM certificates WHERE id=?', [req.params.id]);
  if (!cert) return res.status(404).json({ error:'Not found' });
  try { const img = renderCertImage(cert); res.set('Content-Type','image/png'); res.set('Cache-Control','public,max-age=3600'); res.send(img); }
  catch(e) { console.error('Cert image error:', e.message); res.status(500).json({ error:'Failed to render certificate' }); }
});
function getWebhookUrl(key) { const r = dbGet('SELECT value FROM settings WHERE key=?', [key]); return r ? r.value : ''; }

app.post('/api/announcements', auth, (req, res) => {
  if (!hasPerm(req.user, 'reports', 'create')) return res.status(403).json({ error: 'Forbidden' });
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });

  dbRun("INSERT INTO announcements (title,body,date,created_by) VALUES (?,?,date('now'),?)", [title, body, req.user.id]);
  logAction('create_announcement', req.user, title);
  const wh = getWebhookUrl('webhook_announcements');
  if (wh) sendWebhook(wh, { username:'LSPD Portal', embeds:[{ title:'\u{1F4E2} إعلان جديد', description:body, color:0xf5c842, fields:[{name:'العنوان',value:title,inline:true},{name:'بواسطة',value:req.user.display_name,inline:true}], timestamp:new Date().toISOString() }] });
  res.json({ success: true });
});

app.delete('/api/announcements/:id', auth, (req, res) => {
  if (!hasPerm(req.user, 'reports', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const ann = dbGet('SELECT * FROM announcements WHERE id=?', [req.params.id]);
  if (!ann) return res.status(404).json({ error: 'Not found' });
  dbRun('DELETE FROM announcements WHERE id=?', [req.params.id]);
  logAction('delete_announcement', req.user, ann.title);
  res.json({ success: true });
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ APPLICATIONS & TRANSFERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.get('/api/settings', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const s = dbQuery('SELECT * FROM settings');
  const map = {};
  s.forEach(r => map[r.key] = r.value);
  res.json(map);
});

app.post('/api/test-webhook', auth, (req, res) => {
  if (!hasPerm(req.user, 'settings', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ content:'🔔 Webhook test — connection OK!' }) })
    .then(r => r.ok ? res.json({ success:true, status:r.status }) : r.text().then(t => res.json({ success:false, status:r.status, error:t })))
    .catch(e => res.json({ success:false, error:e.message }));
});

app.put('/api/settings', auth, (req, res) => {
  if (!hasPerm(req.user, 'settings', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { key, value } = req.body;
  // FTO CHIEF can only toggle applications_open
  if (req.user.role === 'FTO CHIEF' && key !== 'applications_open') return res.status(403).json({ error: 'Forbidden' });
  dbRun('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [key, value]);
  logAction('update_settings', req.user, `${key}=${value}`);
  if (key === 'bot_token' || key === 'guild_id') initBot();
  res.json({ success: true });
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ QUESTIONS (stored in settings) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.get('/api/questions/:type', (req, res) => {
  const setting = dbGet('SELECT value FROM settings WHERE key=?', ['questions_' + req.params.type]);
  res.json(setting ? JSON.parse(setting.value) : []);
});

app.put('/api/questions/:type', auth, (req, res) => {
  if (!hasPerm(req.user, 'settings', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { questions } = req.body;
  dbRun('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', ['questions_' + req.params.type, JSON.stringify(questions || [])]);
  logAction('update_questions', req.user, req.params.type);
  res.json({ success: true });
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PUBLIC REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.get('/api/public-reports', auth, (req, res) => {
  if (req.user.role !== 'OWNER' && req.user.role !== 'FULL ACCESS' && !req.user.is_owner) return res.status(403).json({ error: 'Forbidden' });
  res.json(dbQuery('SELECT * FROM public_reports ORDER BY id DESC'));
});

app.post('/api/public-reports', (req, res) => {
  const { name, rank, body, link } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'Name and body required' });
  dbRun('INSERT INTO public_reports (name, rank, body, link) VALUES (?,?,?,?)', [name, rank || '', body, link || '']);
  res.json({ success: true });
});

app.delete('/api/public-reports/:id', auth, (req, res) => {
  if (req.user.role !== 'OWNER' && req.user.role !== 'FULL ACCESS' && !req.user.is_owner) return res.status(403).json({ error: 'Forbidden' });
  dbRun('DELETE FROM public_reports WHERE id=?', [req.params.id]);
  logAction('delete_public_report', req.user);
  res.json({ success: true });
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ STATS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.get('/api/stats/members', auth, (req, res) => {
  if (!hasPerm(req.user, 'accounts', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const stats = dbQuery('SELECT role, COUNT(*) as count FROM users WHERE is_owner=0 GROUP BY role');
  const result = { total: 0 };
  stats.forEach(s => { result[s.role] = s.count; result.total += s.count; });
  res.json(result);
});

app.get('/api/applications', auth, (req, res) => {
  if (!hasPerm(req.user, 'applications', 'view')) return res.status(403).json({ error: 'Forbidden' });
  const type = req.query.type || '';
  let apps;
  if (type) {
    apps = dbQuery('SELECT * FROM applications WHERE type=? ORDER BY id DESC', [type]);
  } else {
    apps = dbQuery('SELECT * FROM applications ORDER BY id DESC');
  }
  res.json(apps);
});

app.post('/api/applications', (req, res) => {
  const { type, name, discord, reason } = req.body;
  if (!name || !discord) return res.status(400).json({ error: 'Name and Discord required' });
  const appType = type === 'transfer' ? 'transfer' : 'application';

  // Check if submissions are open
  const setting = dbGet('SELECT value FROM settings WHERE key=?', [appType + 's_open']);
  if (setting && setting.value === 'false') {
    return res.status(403).json({ error: (appType === 'transfer' ? 'ط§ظ„ظ†ظ‚ظ„' : 'ط§ظ„طھظ‚ط¯ظٹظ…') + ' ظ…ط؛ظ„ظ‚ ط­ط§ظ„ظٹط§ظ‹' });
  }

  dbRun('INSERT INTO applications (type,name,discord,reason) VALUES (?,?,?,?)', [appType, name, discord, reason || '']);
  res.json({ success: true, message: 'طھظ… ط§ظ„ط¥ط±ط³ط§ظ„ ط¨ظ†ط¬ط§ط­' });
});

app.put('/api/applications/:id/status', auth, (req, res) => {
  if (!hasPerm(req.user, 'applications', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { status } = req.body;
  if (!['pending','accepted','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const app = dbGet('SELECT * FROM applications WHERE id=?', [req.params.id]);
  if (!app) return res.status(404).json({ error: 'Not found' });
  dbRun('UPDATE applications SET status=? WHERE id=?', [status, req.params.id]);
  logAction('update_application', req.user, `${app.name} -> ${status}`);
  const wh = getWebhookUrl('webhook_applications');
  if (wh) sendWebhook(wh, { username:'FreeDom LSPD Portal', embeds:[{ title:status==='accepted'?'✅ قبول تقديم':'❌ رفض تقديم', color:status==='accepted'?0x22cc88:0xe74c3c, fields:[{name:'الاسم',value:app.name,inline:true},{name:'ديسكورد',value:app.discord,inline:true},{name:'نوع التقديم',value:app.type==='transfer'?'نقل':'انضمام',inline:true},{name:'بواسطة',value:req.user.display_name,inline:true}], timestamp:new Date().toISOString() }] });
  const statusMsg = status==='accepted'?'✅  تم قبول طلبك في  FreeDom LSPD':'❌ للأسف تم رفض طلبك في FreeDom LSPD';
  const typeMsg = app.type==='transfer'?'نقل':'انضمام';
  sendDiscordDM(app.discord, `**${statusMsg}**\n\`\`\`الاسم: ${app.name}\nالنوع: ${typeMsg}\`\`\`\nشكراً لتواصلك معنا.`);
  res.json({ success: true });
});

app.delete('/api/applications/:id', auth, (req, res) => {
  if (!hasPerm(req.user, 'applications', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const app = dbGet('SELECT * FROM applications WHERE id=?', [req.params.id]);
  if (!app) return res.status(404).json({ error: 'Not found' });
  dbRun('DELETE FROM applications WHERE id=?', [req.params.id]);
  logAction('delete_application', req.user, app.name);
  res.json({ success: true });
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.get('/api/reports', auth, (req, res) => {
  if (!hasPerm(req.user, 'reports', 'view')) return res.status(403).json({ error: 'Forbidden' });
  res.json(dbQuery('SELECT r.*, u.display_name as author_name FROM reports r LEFT JOIN users u ON r.created_by=u.id ORDER BY r.id DESC'));
});

app.post('/api/reports', auth, (req, res) => {
  if (!hasPerm(req.user, 'reports', 'create')) return res.status(403).json({ error: 'Forbidden' });
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
  dbRun('INSERT INTO reports (title,body,created_by) VALUES (?,?,?)', [title, body, req.user.id]);
  logAction('create_report', req.user, title);
  res.json({ success: true });
});

app.put('/api/reports/:id', auth, (req, res) => {
  if (!hasPerm(req.user, 'reports', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { title, body } = req.body;
  const r = dbGet('SELECT * FROM reports WHERE id=?', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (title) dbRun('UPDATE reports SET title=? WHERE id=?', [title, req.params.id]);
  if (body) dbRun('UPDATE reports SET body=? WHERE id=?', [body, req.params.id]);
  logAction('update_report', req.user, r.title);
  res.json({ success: true });
});

app.delete('/api/reports/:id', auth, (req, res) => {
  if (!hasPerm(req.user, 'reports', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const r = dbGet('SELECT * FROM reports WHERE id=?', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  dbRun('DELETE FROM reports WHERE id=?', [req.params.id]);
  logAction('delete_report', req.user, r.title);
  res.json({ success: true });
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ LOGS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.get('/api/logs', auth, (req, res) => {
  if (!hasPerm(req.user, 'logs', 'full')) return res.status(403).json({ error: 'Forbidden' });
  res.json(dbQuery('SELECT * FROM logs ORDER BY id DESC LIMIT 200'));
});

app.delete('/api/logs', auth, (req, res) => {
  if (!hasPerm(req.user, 'logs', 'full')) return res.status(403).json({ error: 'Forbidden' });
  dbRun('DELETE FROM logs');
  logAction('clear_logs', req.user);
  res.json({ success: true });
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ CERTIFICATES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.get('/api/certificates', (req, res) => {
  const publicOnly = req.query.public === 'true';
  if (publicOnly) {
    res.json(dbQuery("SELECT * FROM certificates WHERE is_public=1 ORDER BY id DESC"));
  } else {
    res.json(dbQuery('SELECT * FROM certificates ORDER BY id DESC'));
  }
});

app.post('/api/certificates', auth, async (req, res) => {
  if (!hasPerm(req.user, 'certificates', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { officer_name, cert_type, rank_name, issue_date } = req.body;
  if (!officer_name || !cert_type || !rank_name) return res.status(400).json({ error: 'Required fields missing' });
  const result = dbRun('INSERT INTO certificates (officer_name,cert_type,rank_name,issue_date,issued_by,issued_name) VALUES (?,?,?,?,?,?)',
    [officer_name, cert_type, rank_name, issue_date || new Date().toISOString().slice(0,10), req.user.id, req.user.display_name]);
  logAction('create_certificate', req.user, `${officer_name} - ${cert_type}`);
  const wh = getWebhookUrl('webhook_certificates');
  if (wh) {
    const base = `${req.protocol}://${req.get('host')}`;
    const imgUrl = `${base}/api/certificates/${result.lastInsertRowid}/image`;
    sendWebhookCert(wh, `🎓 **شهادة جديدة**`, officer_name, issue_date||'—', imgUrl);
  }
  res.json({ success: true });
});

app.delete('/api/certificates/:id', auth, (req, res) => {
  if (!hasPerm(req.user, 'certificates', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const c = dbGet('SELECT * FROM certificates WHERE id=?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });
  dbRun('DELETE FROM certificates WHERE id=?', [req.params.id]);
  logAction('delete_certificate', req.user, c.officer_name);
  res.json({ success: true });
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ DIVISION MEMBERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function canManageDivision(user, division) {
  if (user.is_owner || user.role === 'FULL ACCESS') return true;
  if (user.role === 'FTO CHIEF' && division === 'FTO') return true;
  if (user.role === 'IA CHIEF' && division === 'IA') return true;
  if (user.role === 'WING COMMANDER' && division === 'WINGS') return true;
  return false;
}

app.get('/api/division-members', auth, (req, res) => {
  if (!hasPerm(req.user, 'division_members', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { division } = req.query;
  if (division && !canManageDivision(req.user, division)) return res.status(403).json({ error: 'Forbidden' });
  let members;
  if (division) {
    members = dbQuery('SELECT * FROM division_members WHERE division=? ORDER BY id DESC', [division]);
  } else {
    members = dbQuery('SELECT * FROM division_members ORDER BY division, id DESC');
  }
  res.json(members);
});

app.post('/api/division-members', auth, (req, res) => {
  if (!hasPerm(req.user, 'division_members', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { division, name } = req.body;
  if (!division || !name) return res.status(400).json({ error: 'Division and name required' });
  if (!canManageDivision(req.user, division)) return res.status(403).json({ error: 'Forbidden' });
  dbRun('INSERT INTO division_members (division,name,created_by) VALUES (?,?,?)', [division, name, req.user.id]);
  logAction('add_division_member', req.user, `${name} -> ${division}`);
  res.json({ success: true });
});

app.put('/api/division-members/:id/points', auth, (req, res) => {
  if (!hasPerm(req.user, 'division_members', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const member = dbGet('SELECT * FROM division_members WHERE id=?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Not found' });
  if (!canManageDivision(req.user, member.division)) return res.status(403).json({ error: 'Forbidden' });
  const { points } = req.body;
  if (typeof points !== 'number') return res.status(400).json({ error: 'Points must be a number' });
  dbRun('UPDATE division_members SET points=? WHERE id=?', [member.points + points, member.id]);
  logAction('update_points', req.user, `${member.name}: ${points>0?'+':''}${points}`);
  res.json({ success: true });
});

app.put('/api/division-members/:id/notes', auth, (req, res) => {
  if (!hasPerm(req.user, 'division_members', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const member = dbGet('SELECT * FROM division_members WHERE id=?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Not found' });
  if (!canManageDivision(req.user, member.division)) return res.status(403).json({ error: 'Forbidden' });
  const { notes } = req.body;
  dbRun('UPDATE division_members SET notes=? WHERE id=?', [notes || '', member.id]);
  logAction('update_notes', req.user, member.name);
  res.json({ success: true });
});

app.delete('/api/division-members/:id', auth, (req, res) => {
  if (!hasPerm(req.user, 'division_members', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const member = dbGet('SELECT * FROM division_members WHERE id=?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Not found' });
  if (!canManageDivision(req.user, member.division)) return res.status(403).json({ error: 'Forbidden' });
  dbRun('DELETE FROM division_members WHERE id=?', [member.id]);
  logAction('delete_division_member', req.user, member.name);
  res.json({ success: true });
});

/* ATTENDANCE (clock in/out) */
app.get('/api/attendance', auth, (req, res) => {
  if (!hasPerm(req.user, 'reports', 'view') && req.user.role !== 'OWNER') return res.status(403).json({ error: 'Forbidden' });
  const { date, user_id } = req.query;
  let sql = 'SELECT a.*, u.discord_avatar FROM attendance a LEFT JOIN users u ON a.user_id=u.id';
  const params = [];
  const conds = [];
  if (date) { conds.push('a.date=?'); params.push(date); }
  if (user_id) { conds.push('a.user_id=?'); params.push(user_id); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY a.id DESC LIMIT 200';
  res.json(dbQuery(sql, params));
});

app.post('/api/attendance/clock', auth, (req, res) => {
  const { action, note } = req.body;
  if (!action || !['clock_in','clock_out'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const today = new Date().toISOString().slice(0,10);
  // Check if already clocked in today
  if (action === 'clock_in') {
    const existing = dbGet("SELECT id FROM attendance WHERE user_id=? AND date=? AND action='clock_in'", [req.user.id, today]);
    if (existing) return res.status(400).json({ error: 'تم تسجيل الحضور مسبقاً اليوم' });
  }
  if (action === 'clock_out') {
    const existing = dbGet("SELECT id FROM attendance WHERE user_id=? AND date=? AND action='clock_out'", [req.user.id, today]);
    if (existing) return res.status(400).json({ error: 'تم تسجيل الانصراف مسبقاً اليوم' });
  }
  dbRun("INSERT INTO attendance (user_id, username, display_name, action, note) VALUES (?,?,?,?,?)",
    [req.user.id, req.user.username, req.user.display_name, action, note || '']);
  logAction('attendance_' + action, req.user);
  const msg = action === 'clock_in' ? '✅ تم تسجيل الحضور' : '✅ تم تسجيل الانصراف';
  res.json({ success: true, message: msg });
});

app.get('/api/attendance/summary', auth, (req, res) => {
  if (!hasPerm(req.user, 'accounts', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { date } = req.query;
  const today = date || new Date().toISOString().slice(0,10);
  const clockedIn = dbQuery("SELECT DISTINCT user_id, display_name FROM attendance WHERE date=? AND action='clock_in'", [today]);
  const clockedOut = dbQuery("SELECT DISTINCT user_id, display_name FROM attendance WHERE date=? AND action='clock_out'", [today]);
  res.json({
    date: today,
    clocked_in: clockedIn,
    clocked_out: clockedOut,
    total_in: clockedIn.length,
    total_out: clockedOut.length
  });
});

/* FILE UPLOAD */
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { ref_type, ref_id } = req.body;
  const result = dbRun('INSERT INTO uploaded_files (filename, original_name, mime_type, size, ref_type, ref_id, uploaded_by) VALUES (?,?,?,?,?,?,?)',
    [req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, ref_type || '', ref_id || null, req.user.id]);
  logAction('upload_file', req.user, req.file.originalname);
  res.json({
    success: true,
    file: {
      id: result.lastInsertRowid,
      filename: req.file.filename,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size: req.file.size,
      url: '/uploads/' + req.file.filename
    }
  });
});

app.get('/api/files', auth, (req, res) => {
  if (!hasPerm(req.user, 'accounts', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const { ref_type, ref_id } = req.query;
  let sql = 'SELECT * FROM uploaded_files';
  const params = [];
  const conds = [];
  if (ref_type) { conds.push('ref_type=?'); params.push(ref_type); }
  if (ref_id) { conds.push('ref_id=?'); params.push(ref_id); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY id DESC';
  res.json(dbQuery(sql, params));
});

app.delete('/api/files/:id', auth, (req, res) => {
  if (!hasPerm(req.user, 'accounts', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const file = dbGet('SELECT * FROM uploaded_files WHERE id=?', [req.params.id]);
  if (!file) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(uploadsDir, file.filename);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  dbRun('DELETE FROM uploaded_files WHERE id=?', [req.params.id]);
  logAction('delete_file', req.user, file.original_name);
  res.json({ success: true });
});

/* LEAVE REQUESTS */
app.get('/api/leave', auth, (req, res) => {
  if (!hasPerm(req.user, 'applications', 'view') && req.user.role !== 'OWNER') return res.status(403).json({ error: 'Forbidden' });
  const { status, source } = req.query;
  let sql = 'SELECT * FROM leave_requests';
  const params = [];
  const conds = [];
  if (status) { conds.push('status=?'); params.push(status); }
  if (source) { conds.push('source=?'); params.push(source); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT 100';
  res.json(dbQuery(sql, params));
});

app.post('/api/leave', auth, (req, res) => {
  const { type, reason, from_date, to_date, discord_tag } = req.body;
  if (!type || !from_date || !to_date) return res.status(400).json({ error: 'Required fields missing' });
  dbRun("INSERT INTO leave_requests (name, discord_tag, type, reason, from_date, to_date, source, created_by) VALUES (?,?,?,?,?,?,'portal',?)",
    [req.user.display_name, discord_tag || req.user.discord_tag || '', type, reason || '', from_date, to_date, req.user.id]);
  logAction('create_leave', req.user, type + ' ' + from_date + ' -> ' + to_date);
  res.json({ success: true, message: '✅ تم تقديم طلب الإجازة' });
});

app.put('/api/leave/:id/status', auth, (req, res) => {
  if (!hasPerm(req.user, 'applications', 'full') && req.user.role !== 'OWNER') return res.status(403).json({ error: 'Forbidden' });
  const { status } = req.body;
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const leave = dbGet('SELECT * FROM leave_requests WHERE id=?', [req.params.id]);
  if (!leave) return res.status(404).json({ error: 'Not found' });
  dbRun('UPDATE leave_requests SET status=?, reviewed_by=?, reviewed_at=datetime(\"now\",\"localtime\") WHERE id=?', [status, req.user.id, leave.id]);
  logAction('update_leave', req.user, leave.name + ' -> ' + status);
  if (leave.discord_tag) {
    const statusMsg = status === 'approved' ? '✅ تمت الموافقة على طلب الإجازة' : '❌ تم رفض طلب الإجازة';
    sendDiscordDM(leave.discord_tag, '**' + statusMsg + '**\n`النوع: ' + leave.type + '\nمن: ' + leave.from_date + '\nإلى: ' + leave.to_date + '`');
  }
  res.json({ success: true });
});

app.delete('/api/leave/:id', auth, (req, res) => {
  if (!hasPerm(req.user, 'applications', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const leave = dbGet('SELECT * FROM leave_requests WHERE id=?', [req.params.id]);
  if (!leave) return res.status(404).json({ error: 'Not found' });
  dbRun('DELETE FROM leave_requests WHERE id=?', [req.params.id]);
  logAction('delete_leave', req.user, leave.name);
  res.json({ success: true });
});

/* ADVANCED STATS */
app.get('/api/stats/overview', auth, (req, res) => {
  if (!hasPerm(req.user, 'accounts', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const totalUsers = dbGet('SELECT COUNT(*) as c FROM users')?.c || 0;
  const totalApps = dbGet('SELECT COUNT(*) as c FROM applications')?.c || 0;
  const pendingApps = dbGet("SELECT COUNT(*) as c FROM applications WHERE status='pending'")?.c || 0;
  const totalCerts = dbGet('SELECT COUNT(*) as c FROM certificates')?.c || 0;
  const totalReports = dbGet('SELECT COUNT(*) as c FROM reports')?.c || 0;
  const totalAnn = dbGet('SELECT COUNT(*) as c FROM announcements')?.c || 0;
  const totalPublicReports = dbGet('SELECT COUNT(*) as c FROM public_reports')?.c || 0;
  const totalDivMembers = dbGet('SELECT COUNT(*) as c FROM division_members')?.c || 0;
  const rejectedApps = dbGet("SELECT COUNT(*) as c FROM applications WHERE status='rejected'")?.c || 0;
  const acceptedApps = dbGet("SELECT COUNT(*) as c FROM applications WHERE status='accepted'")?.c || 0;
  res.json({
    totalUsers, totalApps, pendingApps, acceptedApps, rejectedApps, totalCerts,
    totalReports, totalAnn, totalPublicReports,
    totalDivMembers
  });
});

app.get('/api/stats/applications-by-date', auth, (req, res) => {
  if (!hasPerm(req.user, 'applications', 'view')) return res.status(403).json({ error: 'Forbidden' });
  const days = parseInt(req.query.days) || 30;
  const data = dbQuery("SELECT date, COUNT(*) as count, SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) as accepted, SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected FROM applications WHERE date >= date('now','-' || ? || ' days') GROUP BY date ORDER BY date", [days]);
  res.json(data);
});

app.get('/api/stats/certificates-by-month', auth, (req, res) => {
  if (!hasPerm(req.user, 'certificates', 'full')) return res.status(403).json({ error: 'Forbidden' });
  const months = parseInt(req.query.months) || 12;
  const data = dbQuery("SELECT strftime('%Y-%m', date_created) as month, COUNT(*) as count FROM certificates WHERE date_created >= datetime('now','-' || ? || ' months') GROUP BY month ORDER BY month", [months]);
  res.json(data);
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ RANKS (public) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const RANKS_DATA = {
  'OWNER':            { emoji:'ًں‘‘', level:0, permissions:['ظƒظ„ ط§ظ„طµظ„ط§ط­ظٹط§طھ'] },
  'FULL ACCESS':      { emoji:'ًں”µ', level:1, permissions:['ط´ظ‡ط§ط¯ط§طھ','طھظ‚ط§ط±ظٹط±','طھظ‚ط¯ظٹظ…ط§طھ','ط³ط¬ظ„ط§طھ'] },
  'FTO CHIEF':        { emoji:'ًںں،', level:2, permissions:['ط´ظ‡ط§ط¯ط§طھ','طھظ‚ط§ط±ظٹط±','طھظ‚ط¯ظٹظ…ط§طھ'] },
  'FTO MEMBER':       { emoji:'ًںں¢', level:3, permissions:['ط´ظ‡ط§ط¯ط§طھ','ط¥ظ†ط´ط§ط، طھظ‚ط§ط±ظٹط±'] },
  'IA CHIEF':         { emoji:'ًں”´', level:4, permissions:['ط´ظ‡ط§ط¯ط§طھ','طھظ‚ط§ط±ظٹط±','طھظ‚ط¯ظٹظ…ط§طھ'] },
  'IA MEMBER':        { emoji:'ًںں ', level:5, permissions:['ط´ظ‡ط§ط¯ط§طھ','طھظ‚ط§ط±ظٹط±'] },
  'WING COMMANDER':   { emoji:'ًںں£', level:6, permissions:['ط´ظ‡ط§ط¯ط§طھ','طھظ‚ط§ط±ظٹط±','طھظ‚ط¯ظٹظ…ط§طھ'] },
  'WINGS':            { emoji:'âڑھ', level:7, permissions:['ط´ظ‡ط§ط¯ط§طھ','طھظ‚ط§ط±ظٹط±'] },
  'APPLICANT VIEWER': { emoji:'ًں‘پï¸ڈ', level:8, permissions:['ط¹ط±ط¶ ط§ظ„طھظ‚ط¯ظٹظ…ط§طھ ظپظ‚ط·'] },
  'VISITOR':          { emoji:'ًں‘¤', level:9, permissions:['ظ„ط§ ظٹظˆط¬ط¯ طµظ„ط§ط­ظٹط§طھ'] }
};

app.get('/api/ranks', (req, res) => {
  res.json(RANKS_DATA);
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ SERVE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.get('/api/bot-status', (req, res) => {
  res.json({ online: !!botClient && !!botClient.user, user: botClient?.user?.tag || null, guildId: botGuildId || null, guilds: botClient?.guilds?.cache?.size || 0, hasToken: !!dbGet('SELECT value FROM settings WHERE key=?', ['bot_token'])?.value });
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDB().then(() => {
  initBot();
  const os = require('os');
  const ifaces = os.networkInterfaces();
  const ip = Object.values(ifaces).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`âœ… LSPD Portal running on http://localhost:${PORT}`);
    console.log(`   Network:  http://${ip}:${PORT}`);
    console.log(`   Owner: the king / Klk98lkl`);
    console.log(`   Roles: ${Object.keys(RANKS_DATA).join(', ')}`);
  });
});
