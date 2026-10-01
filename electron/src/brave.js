const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const store = require('./store');

const BRAVE = path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data');
const EPOCH_OFFSET = 11644473600;

function dpapiUnprotect(buf) {
  const script = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${buf.toString('base64')}'), $null, 'CurrentUser'))`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return Buffer.from(out.trim(), 'base64');
}

function masterKey() {
  const state = JSON.parse(fs.readFileSync(path.join(BRAVE, 'Local State'), 'utf8'));
  const enc = Buffer.from(state.os_crypt.encrypted_key, 'base64');
  if (enc.subarray(0, 5).toString() !== 'DPAPI') throw new Error('Unbekanntes Brave-Schlüsselformat');
  return dpapiUnprotect(enc.subarray(5));
}

function decryptValue(buf, key) {
  if (!buf || !buf.length) return null;
  const prefix = buf.subarray(0, 3).toString();
  if (prefix === 'v10' || prefix === 'v11') {
    const iv = buf.subarray(3, 15);
    const tag = buf.subarray(buf.length - 16);
    const data = buf.subarray(15, buf.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]);
  }
  if (prefix === 'v20') return null;
  try {
    return dpapiUnprotect(buf);
  } catch {
    return null;
  }
}

function openCopy(profile, rel) {
  const src = path.join(BRAVE, profile, rel);
  if (!fs.existsSync(src)) return null;
  const tmp = path.join(os.tmpdir(), `opium-${crypto.randomBytes(6).toString('hex')}.db`);
  try {
    fs.copyFileSync(src, tmp);
  } catch {
    const err = new Error('Brave ist noch geöffnet.');
    err.code = 'BRAVE_OPEN';
    throw err;
  }
  return { db: new DatabaseSync(tmp, { readOnly: true }), tmp };
}

function closeCopy(handle) {
  if (!handle) return;
  handle.db.close();
  fs.rmSync(handle.tmp, { force: true });
}

function query(db, sql, one = false) {
  const stmt = db.prepare(sql);
  stmt.setReadBigInts(true);
  return one ? stmt.get() : stmt.all();
}

const SAME_SITE = { '-1': 'unspecified', 0: 'no_restriction', 1: 'lax', 2: 'strict' };

async function importCookies(ses, profile, key) {
  const h = openCopy(profile, path.join('Network', 'Cookies')) || openCopy(profile, 'Cookies');
  if (!h) return { cookies: 0, skipped: 0 };
  let cookies = 0;
  let skipped = 0;
  try {
    const meta = query(h.db, "SELECT value FROM meta WHERE key = 'version'", true);
    const hashPrefix = Number(meta?.value || 0) >= 24;
    const rows = query(h.db, 'SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies');
    const now = Date.now() / 1000;
    for (const r of rows) {
      let value = r.value;
      if (!value) {
        const plain = decryptValue(Buffer.from(r.encrypted_value), key);
        if (!plain) { skipped++; continue; }
        value = (hashPrefix ? plain.subarray(32) : plain).toString('utf8');
      }
      const expires = r.expires_utc ? Number(r.expires_utc) / 1e6 - EPOCH_OFFSET : undefined;
      if (expires && expires < now) continue;
      const host = r.host_key.replace(/^\./, '');
      const details = {
        url: `${r.is_secure ? 'https' : 'http'}://${host}${r.path || '/'}`,
        name: r.name,
        value,
        path: r.path || '/',
        secure: !!r.is_secure,
        httpOnly: !!r.is_httponly,
        sameSite: SAME_SITE[String(r.samesite)] || 'unspecified',
      };
      if (r.host_key.startsWith('.') && !r.name.startsWith('__Host-')) details.domain = r.host_key;
      if (expires) details.expirationDate = expires;
      try {
        await ses.cookies.set(details);
        cookies++;
      } catch {
        skipped++;
      }
    }
    await ses.cookies.flushStore();
  } finally {
    closeCopy(h);
  }
  return { cookies, skipped };
}

function importPasswords(profile, key) {
  const h = openCopy(profile, 'Login Data');
  if (!h) return 0;
  let count = 0;
  try {
    const rows = query(h.db, 'SELECT origin_url, username_value, password_value FROM logins WHERE blacklisted_by_user = 0');
    for (const r of rows) {
      let origin;
      try { origin = new URL(r.origin_url).origin; } catch { continue; }
      if (!origin.startsWith('https://')) continue;
      const plain = decryptValue(Buffer.from(r.password_value), key);
      if (!plain) continue;
      store.savePassword(origin, r.username_value || '', plain.toString('utf8'));
      count++;
    }
  } finally {
    closeCopy(h);
  }
  return count;
}

function importBookmarks(profile) {
  const file = path.join(BRAVE, profile, 'Bookmarks');
  if (!fs.existsSync(file)) return 0;
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'url' && /^https?:/.test(node.url)) out.push({ url: node.url, title: node.name, t: Date.now() });
    (node.children || []).forEach(walk);
  };
  Object.values(json.roots || {}).forEach(walk);
  store.mergeBookmarks(out);
  return out.length;
}

function importHistory(profile) {
  const h = openCopy(profile, 'History');
  if (!h) return 0;
  try {
    const rows = query(h.db, 'SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 5000');
    const entries = rows
      .filter((r) => /^https?:/.test(r.url))
      .map((r) => ({ url: r.url, title: r.title || r.url, t: Math.round((Number(r.last_visit_time) / 1e6 - EPOCH_OFFSET) * 1000) }));
    store.mergeHistory(entries);
    return entries.length;
  } finally {
    closeCopy(h);
  }
}

function closeBrave() {
  try {
    execFileSync('taskkill.exe', ['/IM', 'brave.exe', '/F'], { windowsHide: true, stdio: 'ignore' });
  } catch {}
  return new Promise((r) => setTimeout(r, 2000));
}

async function importBrave(ses, forceClose = false) {
  if (forceClose) await closeBrave();
  if (!fs.existsSync(path.join(BRAVE, 'Local State'))) throw new Error('Keine Brave-Installation gefunden.');
  const key = masterKey();
  const profile = 'Default';
  const passwords = importPasswords(profile, key);
  const { cookies, skipped } = await importCookies(ses, profile, key);
  const bookmarks = importBookmarks(profile);
  const history = importHistory(profile);
  return { passwords, cookies, skipped, bookmarks, history };
}

module.exports = { importBrave };
