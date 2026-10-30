import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import express from 'express';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const controlPassword = process.env.CONTROL_PASSWORD || '';
const deviceToken = process.env.DEVICE_TOKEN || '';
const sessionSecret = process.env.SESSION_SECRET || '';
const cookieSecure = process.env.NODE_ENV === 'production';
const leaseMs = 8000;
const deviceOnlineMs = 7000;

if (controlPassword.length < 16 || deviceToken.length < 32 || sessionSecret.length < 32) {
  throw new Error('Set CONTROL_PASSWORD (16+ chars), DEVICE_TOKEN and SESSION_SECRET (32+ chars) in .env');
}

const databasePath = path.resolve(root, process.env.DATABASE_PATH || './data/control.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS command (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    lease_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO command (id, enabled, lease_until, updated_at)
  VALUES (1, 0, 0, 0);
  CREATE TABLE IF NOT EXISTS device (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_seen INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO device (id, last_seen) VALUES (1, 0);
`);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2kb' }));
app.get('/', (req, res) => res.sendFile(path.join(root, 'index.html')));

function safeEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(left).digest();
  const rightHash = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function sign(payload) {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

function getCookie(req, name) {
  const entry = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function isAuthenticated(req) {
  const value = getCookie(req, 'mc_session');
  const separator = value.lastIndexOf('.');
  if (separator < 1) return false;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!safeEqual(signature, sign(payload))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).expiresAt > Date.now();
  } catch {
    return false;
  }
}

function requireOperator(req, res, next) {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Sign in required.' });
  next();
}

function requireDevice(req, res, next) {
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(supplied, deviceToken)) return res.status(401).json({ error: 'Device authentication failed.' });
  next();
}

function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin || new URL(origin).host !== req.get('host')) {
    return res.status(403).json({ error: 'Request origin rejected.' });
  }
  next();
}

const loginAttempts = new Map();
app.post('/api/login', sameOrigin, (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (attempts.resetAt <= now) {
    attempts.count = 0;
    attempts.resetAt = now + 15 * 60 * 1000;
  }
  if (attempts.count >= 8) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  attempts.count += 1;
  loginAttempts.set(ip, attempts);

  if (typeof req.body.password !== 'string' || !safeEqual(req.body.password, controlPassword)) {
    return res.status(401).json({ error: 'Incorrect control password.' });
  }

  loginAttempts.delete(ip);
  const payload = Buffer.from(JSON.stringify({ expiresAt: now + 12 * 60 * 60 * 1000 })).toString('base64url');
  res.setHeader('Set-Cookie', `mc_session=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${cookieSecure ? '; Secure' : ''}`);
  res.json({ authenticated: true });
});

app.post('/api/logout', sameOrigin, (req, res) => {
  res.setHeader('Set-Cookie', `mc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cookieSecure ? '; Secure' : ''}`);
  res.json({ authenticated: false });
});

app.get('/api/status', (req, res) => {
  const now = Date.now();
  const command = db.prepare('SELECT enabled, lease_until FROM command WHERE id = 1').get();
  const device = db.prepare('SELECT last_seen FROM device WHERE id = 1').get();
  const enabled = Boolean(command.enabled && command.lease_until > now);
  res.json({
    authenticated: isAuthenticated(req),
    deviceOnline: now - device.last_seen <= deviceOnlineMs,
    enabled
  });
});

app.post('/api/command', sameOrigin, requireOperator, (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Expected enabled to be true or false.' });

  const now = Date.now();
  const device = db.prepare('SELECT last_seen FROM device WHERE id = 1').get();
  if (enabled && now - device.last_seen > deviceOnlineMs) {
    return res.status(409).json({ error: 'ESP32 is offline. Start is blocked.' });
  }

  db.prepare(`UPDATE command SET enabled = ?, lease_until = ?, updated_at = ? WHERE id = 1`)
    .run(enabled ? 1 : 0, enabled ? now + leaseMs : now, now);
  res.json({ enabled, leaseMs: enabled ? leaseMs : 0 });
});

app.get('/api/device/command', requireDevice, (req, res) => {
  const now = Date.now();
  db.prepare('UPDATE device SET last_seen = ? WHERE id = 1').run(now);
  const command = db.prepare('SELECT enabled, lease_until FROM command WHERE id = 1').get();
  const enabled = Boolean(command.enabled && command.lease_until > now);
  res.json({ enabled, leaseRemainingMs: enabled ? command.lease_until - now : 0 });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Motor control service listening on port ${port}`);
});