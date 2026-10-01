const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, clipboard, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const { importBrave } = require('./brave');
const store = require('./store');

const UI = path.join(__dirname, '..', 'ui');
const START_FILE = pathToFileURL(path.join(UI, 'start.html')).href;
const SETTINGS_FILE = pathToFileURL(path.join(UI, 'settings.html')).href;
const SETTINGS_URL = 'opium://settings';
const isStart = (u) => (u || '').split('?')[0] === START_FILE;
const isSettings = (u) => (u || '').split('?')[0] === SETTINGS_FILE;
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;

const ENGINES = {
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  startpage: 'https://www.startpage.com/sp/search?query=%s',
  brave: 'https://search.brave.com/search?q=%s',
  leta: 'https://leta.mullvad.net/search?q=%s',
  google: 'https://www.google.com/search?q=%s',
};
const DNS = {
  quad9: ['https://dns.quad9.net/dns-query'],
  mullvad: ['https://dns.mullvad.net/dns-query'],
  cloudflare: ['https://cloudflare-dns.com/dns-query'],
};
const DEFAULTS = {
  engine: 'duckduckgo',
  homepage: 'opium',
  homepageUrl: '',
  restoreTabs: false,
  accent: '#a78bfa',
  snow: true,
  snowAmount: 2,
  compact: false,
  adblock: true,
  dns: 'quad9',
  saveHistory: true,
  clearCookiesOnExit: false,
  allowCamera: false,
  allowLocation: false,
  allowNotifications: false,
  savePasswords: true,
};

app.userAgentFallback = CHROME_UA;
app.commandLine.appendSwitch('disable-features', 'InterestFeedContentSuggestions,OptimizationHints,MediaRouter,AutofillServerCommunication');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-background-networking');

if (!app.requestSingleInstanceLock()) app.quit();

let win;
let ses;
let blocker;
let blocking = false;
let bounds = { x: 0, y: 0, width: 800, height: 600 };
const tabs = new Map();
let activeId = null;
let nextId = 1;

const settings = () => ({ ...DEFAULTS, ...store.get('settings', {}) });

function startUrl() {
  const s = settings();
  const q = new URLSearchParams({ snow: s.snow ? s.snowAmount : 0, accent: s.accent, engine: ENGINES[s.engine] });
  return `${START_FILE}?${q}`;
}

function homeUrl() {
  const s = settings();
  if (s.homepage === 'blank') return 'about:blank';
  if (s.homepage === 'custom' && s.homepageUrl) return toUrl(s.homepageUrl);
  return startUrl();
}

function toUrl(input) {
  const text = (input || '').trim();
  if (!text) return homeUrl();
  if (text === SETTINGS_URL) return SETTINGS_FILE;
  if (/^(https?|file|about|view-source):/i.test(text)) return text;
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text) || /^localhost(:\d+)?/.test(text)) return 'https://' + text;
  return ENGINES[settings().engine].replace('%s', encodeURIComponent(text));
}

function displayUrl(u) {
  if (isStart(u) || u === 'about:blank') return '';
  if (isSettings(u)) return SETTINGS_URL;
  return u;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function tabState(id) {
  const t = tabs.get(id);
  if (!t) return null;
  const wc = t.view.webContents;
  const url = wc.getURL();
  return {
    id,
    title: isSettings(url) ? 'Einstellungen' : wc.getTitle() || 'Neuer Tab',
    url: displayUrl(url),
    internal: isStart(url) || isSettings(url),
    settings: isSettings(url),
    favicon: t.favicon,
    loading: wc.isLoading(),
    canBack: wc.navigationHistory.canGoBack(),
    canForward: wc.navigationHistory.canGoForward(),
    blocked: t.blocked,
    active: id === activeId,
  };
}

function pushTabs() {
  const list = [...tabs.keys()].map(tabState);
  send('tabs', { tabs: list, active: activeId, totalBlocked: store.get('blockedTotal', 0), bookmarks: store.get('bookmarks', []).slice(0, 8) });
  if (settings().restoreTabs) store.set('session', list.filter((t) => t.url && !t.settings).map((t) => t.url));
}

function layout() {
  for (const [id, t] of tabs) {
    t.view.setVisible(id === activeId);
    if (id === activeId) t.view.setBounds(bounds);
  }
}

function handleKeys(event, input) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;
  const key = input.key.toLowerCase();
  const wc = activeId && tabs.get(activeId)?.view.webContents;
  const act = (fn) => { event.preventDefault(); fn(); };
  if (ctrl && key === 't') act(() => { createTab(); send('focus-url'); });
  else if (ctrl && key === 'w') act(() => activeId && closeTab(activeId));
  else if (ctrl && key === 'l') act(() => send('focus-url'));
  else if (ctrl && key === 'b') act(() => send('toggle-sidebar'));
  else if (ctrl && key === ',') act(() => openSettings());
  else if (ctrl && key === 'd') act(() => toggleBookmark());
  else if ((ctrl && key === 'r') || key === 'f5') act(() => wc && wc.reload());
  else if (ctrl && key === 'tab') act(() => cycle(input.shift ? -1 : 1));
  else if (input.alt && key === 'arrowleft') act(() => wc && wc.navigationHistory.goBack());
  else if (input.alt && key === 'arrowright') act(() => wc && wc.navigationHistory.goForward());
  else if (ctrl && (key === '+' || key === '=')) act(() => wc && wc.setZoomLevel(wc.getZoomLevel() + 0.5));
  else if (ctrl && key === '-') act(() => wc && wc.setZoomLevel(wc.getZoomLevel() - 0.5));
  else if (ctrl && key === '0') act(() => wc && wc.setZoomLevel(0));
  else if (key === 'f12') act(() => wc && wc.toggleDevTools());
  else if (key === 'f11') act(() => win.setFullScreen(!win.isFullScreen()));
}

function cycle(dir) {
  const ids = [...tabs.keys()];
  if (ids.length < 2) return;
  const i = ids.indexOf(activeId);
  activate(ids[(i + dir + ids.length) % ids.length]);
}

function contextMenu(wc, params) {
  const items = [];
  if (params.linkURL) {
    items.push({ label: 'Link in neuem Tab öffnen', click: () => createTab(params.linkURL, false) });
    items.push({ label: 'Link kopieren', click: () => clipboard.writeText(params.linkURL) });
    items.push({ type: 'separator' });
  }
  if (params.hasImageContents && params.srcURL) {
    items.push({ label: 'Bild in neuem Tab öffnen', click: () => createTab(params.srcURL, false) });
    items.push({ label: 'Bild kopieren', click: () => wc.copyImageAt(params.x, params.y) });
    items.push({ type: 'separator' });
  }
  if (params.selectionText) {
    items.push({ label: 'Kopieren', role: 'copy' });
    items.push({ label: `Suchen nach „${params.selectionText.slice(0, 24)}“`, click: () => createTab(toUrl(params.selectionText)) });
    items.push({ type: 'separator' });
  }
  if (params.isEditable) {
    items.push({ label: 'Ausschneiden', role: 'cut' }, { label: 'Einfügen', role: 'paste' }, { type: 'separator' });
  }
  items.push(
    { label: 'Zurück', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Vor', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: 'Neu laden', click: () => wc.reload() },
    { type: 'separator' },
    { label: 'Untersuchen', click: () => wc.inspectElement(params.x, params.y) },
  );
  Menu.buildFromTemplate(items).popup({ window: win });
}

function createTab(url, focus = true) {
  const target = url ? toUrl(url) : homeUrl();
  const id = nextId++;
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload-tab.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      safeDialogs: true,
    },
  });
  view.setBorderRadius(10);
  view.setBackgroundColor('#121016');
  win.contentView.addChildView(view);
  const t = { view, favicon: null, blocked: 0 };
  tabs.set(id, t);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url: u }) => { createTab(u, true); return { action: 'deny' }; });
  wc.on('before-input-event', handleKeys);
  wc.on('context-menu', (_e, params) => contextMenu(wc, params));
  wc.on('page-favicon-updated', (_e, icons) => { t.favicon = icons[0] || null; pushTabs(); });
  for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page']) {
    wc.on(ev, () => pushTabs());
  }
  wc.on('did-navigate', (_e, u) => {
    t.blocked = 0;
    t.favicon = null;
    if (settings().saveHistory && /^https?:/.test(u)) store.addHistory(u, wc.getTitle());
  });
  wc.on('will-navigate', (e, u) => {
    if (isSettings(u) && !isSettings(wc.getURL())) e.preventDefault();
  });
  wc.on('did-fail-load', (_e, code, desc, _u, main) => { if (main && code !== -3) send('toast', `Seite konnte nicht geladen werden (${desc})`); });
  wc.loadURL(target);
  if (focus || activeId === null) activate(id); else layout();
  pushTabs();
  return id;
}

function openSettings() {
  for (const [id, t] of tabs) {
    if (isSettings(t.view.webContents.getURL())) { activate(id); return; }
  }
  createTab(SETTINGS_URL);
}

function activate(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  layout();
  pushTabs();
}

function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  const ids = [...tabs.keys()];
  const idx = ids.indexOf(id);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  tabs.delete(id);
  if (tabs.size === 0) { createTab(); return; }
  if (activeId === id) activate([...tabs.keys()][Math.max(0, idx - 1)]);
  pushTabs();
}

function toggleBookmark() {
  const s = tabState(activeId);
  if (!s || !s.url || s.internal) return false;
  const added = store.toggleBookmark(s.url, s.title, s.favicon);
  pushTabs();
  return added;
}

function permissionAllowed(permission) {
  const s = settings();
  if (['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission)) return true;
  if (permission === 'media') return s.allowCamera;
  if (permission === 'geolocation') return s.allowLocation;
  if (permission === 'notifications') return s.allowNotifications;
  return false;
}

function applyDns() {
  const mode = settings().dns;
  if (mode === 'off') app.configureHostResolver({ secureDnsMode: 'off' });
  else app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: DNS[mode] || DNS.quad9 });
}

function applyAdblock() {
  if (!blocker) return;
  const want = settings().adblock;
  if (want && !blocking) blocker.enableBlockingInSession(ses);
  if (!want && blocking) blocker.disableBlockingInSession(ses);
  blocking = want;
}

function applyAppearance() {
  const s = settings();
  send('appearance', { accent: s.accent, snow: s.snow ? s.snowAmount : 0, compact: s.compact });
}

async function setupSession() {
  ses = session.fromPartition('persist:opium');
  ses.setUserAgent(CHROME_UA);
  ses.setSpellCheckerEnabled(false);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permissionAllowed(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => permissionAllowed(permission));
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    h['Sec-GPC'] = '1';
    h['DNT'] = '1';
    delete h['X-Client-Data'];
    if (h.Referer && details.url) {
      try {
        const ref = new URL(h.Referer);
        if (ref.origin !== new URL(details.url).origin) h.Referer = ref.origin + '/';
      } catch {}
    }
    cb({ requestHeaders: h });
  });
  ses.on('will-download', (_e, item) => {
    item.once('done', (_ev, state) => send('toast', state === 'completed' ? `Heruntergeladen: ${item.getFilename()}` : `Download abgebrochen: ${item.getFilename()}`));
  });

  const cache = path.join(app.getPath('userData'), 'adblock.bin');
  try {
    blocker = await ElectronBlocker.fromPrebuiltFull(fetch, { path: cache, read: fs.promises.readFile, write: fs.promises.writeFile });
  } catch {
    if (fs.existsSync(cache)) blocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(cache)));
  }
  if (blocker) {
    blocker.on('request-blocked', (req) => {
      store.set('blockedTotal', store.get('blockedTotal', 0) + 1);
      for (const t of tabs.values()) if (t.view.webContents.id === req.tabId) t.blocked++;
      schedulePush();
    });
    applyAdblock();
  }
}

let pushTimer = null;
function schedulePush() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; pushTabs(); }, 400);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 700,
    minHeight: 450,
    frame: false,
    backgroundColor: '#0c0b10',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    title: 'Opium',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-ui.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(UI, 'index.html'));
  win.webContents.on('before-input-event', handleKeys);
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => send('maximized', true));
  win.on('unmaximize', () => send('maximized', false));
  win.on('focus', () => send('focus', true));
  win.on('blur', () => send('focus', false));
  win.webContents.once('did-finish-load', () => {
    applyAppearance();
    const saved = settings().restoreTabs ? store.get('session', []) : [];
    if (saved.length) saved.forEach((u, i) => createTab(u, i === 0));
    else createTab();
  });
}

const fromSettings = (e) => isSettings(e.senderFrame?.url);

ipcMain.on('layout', (_e, r) => {
  bounds = { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
  layout();
});
ipcMain.on('win', (_e, action) => {
  if (action === 'close') win.close();
  else if (action === 'min') win.minimize();
  else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('tab:new', (_e, url) => createTab(url));
ipcMain.on('tab:close', (_e, id) => closeTab(id));
ipcMain.on('tab:activate', (_e, id) => activate(id));
ipcMain.on('settings:open', () => openSettings());
ipcMain.on('nav', (_e, { action, value }) => {
  const wc = activeId && tabs.get(activeId)?.view.webContents;
  if (!wc) return;
  if (action === 'go') wc.loadURL(toUrl(value));
  else if (action === 'back') wc.navigationHistory.goBack();
  else if (action === 'forward') wc.navigationHistory.goForward();
  else if (action === 'reload') wc.isLoading() ? wc.stop() : wc.reload();
});
ipcMain.handle('suggest', (_e, q) => store.suggest(q));
ipcMain.handle('bookmark:toggle', () => toggleBookmark());

ipcMain.handle('settings:get', (e) => {
  if (!fromSettings(e)) return null;
  return {
    settings: settings(),
    versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome },
    stats: { blocked: store.get('blockedTotal', 0), history: store.get('history', []).length },
  };
});
ipcMain.handle('settings:set', (e, key, value) => {
  if (!fromSettings(e) || !(key in DEFAULTS) || typeof value !== typeof DEFAULTS[key]) return false;
  store.set('settings', { ...store.get('settings', {}), [key]: value });
  if (key === 'adblock') applyAdblock();
  if (key === 'dns') applyDns();
  if (['accent', 'snow', 'snowAmount', 'compact'].includes(key)) applyAppearance();
  if (key === 'restoreTabs') pushTabs();
  return true;
});
ipcMain.handle('brave:import', async (e, forceClose) => {
  if (!fromSettings(e)) return { ok: false, error: 'Nicht erlaubt' };
  try {
    const r = await importBrave(ses, forceClose === true);
    pushTabs();
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code };
  }
});
ipcMain.handle('passwords:list', (e) => (fromSettings(e) ? store.listPasswords() : []));
ipcMain.handle('passwords:delete', (e, origin, username) => fromSettings(e) && store.deletePassword(origin, username));
ipcMain.handle('bookmarks:list', (e) => (fromSettings(e) ? store.get('bookmarks', []) : []));
ipcMain.handle('bookmarks:delete', (e, url) => {
  if (!fromSettings(e)) return false;
  store.set('bookmarks', store.get('bookmarks', []).filter((b) => b.url !== url));
  pushTabs();
  return true;
});
ipcMain.handle('privacy:clear', async (e, what) => {
  if (!fromSettings(e)) return false;
  if (what === 'history') store.set('history', []);
  if (what === 'site') { await ses.clearStorageData(); await ses.clearCache(); }
  return true;
});
ipcMain.handle('vault:get', (e) => {
  const origin = e.senderFrame?.origin;
  if (!origin || !origin.startsWith('https://')) return [];
  return store.getPasswords(origin);
});
ipcMain.on('vault:save', (e, { username, password }) => {
  const origin = e.senderFrame?.origin;
  if (!settings().savePasswords || !origin || !origin.startsWith('https://') || !password) return;
  if (store.savePassword(origin, username || '', password)) send('toast', `Passwort für ${new URL(origin).host} gespeichert`);
});

app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const url = argv.find((a) => /^https?:\/\//.test(a));
  if (url) createTab(url);
});

app.whenReady().then(async () => {
  store.init(app.getPath('userData'), safeStorage);
  applyDns();
  Menu.setApplicationMenu(null);
  await setupSession();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', async (e) => {
  if (!ses || app.isQuitting) return;
  app.isQuitting = true;
  e.preventDefault();
  await ses.clearCache();
  if (settings().clearCookiesOnExit) await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
  app.quit();
});
