const fs = require('fs');
const path = require('path');

let file;
let crypto;
let data = {};
let timer = null;

function init(dir, safeStorage) {
  file = path.join(dir, 'opium.json');
  crypto = safeStorage;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = {};
  }
}

function flush() {
  timer = null;
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
}

function persist() {
  if (!timer) timer = setTimeout(flush, 500);
}

function get(key, fallback) {
  return key in data ? data[key] : fallback;
}

function set(key, value) {
  data[key] = value;
  persist();
}

function addHistory(url, title) {
  if (!/^https?:/.test(url)) return;
  const history = get('history', []).filter((h) => h.url !== url);
  history.unshift({ url, title: title || url, t: Date.now() });
  set('history', history.slice(0, 5000));
}

function mergeHistory(entries) {
  const seen = new Set(get('history', []).map((h) => h.url));
  const merged = get('history', []).concat(entries.filter((e) => !seen.has(e.url)));
  merged.sort((a, b) => b.t - a.t);
  set('history', merged.slice(0, 5000));
}

function suggest(q) {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  const pool = get('bookmarks', []).concat(get('history', []));
  const out = [];
  const seen = new Set();
  for (const item of pool) {
    if (seen.has(item.url)) continue;
    if (item.url.toLowerCase().includes(term) || (item.title || '').toLowerCase().includes(term)) {
      seen.add(item.url);
      out.push({ url: item.url, title: item.title });
      if (out.length >= 6) break;
    }
  }
  return out;
}

function toggleBookmark(url, title, favicon) {
  const list = get('bookmarks', []);
  const i = list.findIndex((b) => b.url === url);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ url, title, favicon: favicon || null, t: Date.now() });
  set('bookmarks', list);
  return i < 0;
}

function mergeBookmarks(entries) {
  const list = get('bookmarks', []);
  const seen = new Set(list.map((b) => b.url));
  for (const e of entries) if (!seen.has(e.url)) { list.push(e); seen.add(e.url); }
  set('bookmarks', list);
}

function encrypt(text) {
  return crypto.encryptString(text).toString('base64');
}

function decrypt(b64) {
  try {
    return crypto.decryptString(Buffer.from(b64, 'base64'));
  } catch {
    return '';
  }
}

function savePassword(origin, username, password) {
  const vault = get('vault', {});
  const list = vault[origin] || [];
  const existing = list.find((e) => e.u === username);
  if (existing && decrypt(existing.p) === password) return false;
  if (existing) existing.p = encrypt(password);
  else list.push({ u: username, p: encrypt(password) });
  vault[origin] = list;
  set('vault', vault);
  return true;
}

function getPasswords(origin) {
  return (get('vault', {})[origin] || []).map((e) => ({ username: e.u, password: decrypt(e.p) }));
}

function listPasswords() {
  const vault = get('vault', {});
  return Object.keys(vault).sort().flatMap((origin) => vault[origin].map((e) => ({ origin, username: e.u })));
}

function deletePassword(origin, username) {
  const vault = get('vault', {});
  vault[origin] = (vault[origin] || []).filter((e) => e.u !== username);
  if (!vault[origin].length) delete vault[origin];
  set('vault', vault);
  return true;
}

module.exports = {
  init, get, set, addHistory, mergeHistory, suggest, toggleBookmark, mergeBookmarks,
  savePassword, getPasswords, listPasswords, deletePassword,
};
