const { ipcRenderer, contextBridge } = require('electron');

if (location.protocol === 'file:' && /\/ui\/settings\.html$/.test(location.pathname)) {
  contextBridge.exposeInMainWorld('opium', {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    importBrave: (forceClose) => ipcRenderer.invoke('brave:import', forceClose),
    passwords: () => ipcRenderer.invoke('passwords:list'),
    deletePassword: (origin, username) => ipcRenderer.invoke('passwords:delete', origin, username),
    bookmarks: () => ipcRenderer.invoke('bookmarks:list'),
    deleteBookmark: (url) => ipcRenderer.invoke('bookmarks:delete', url),
    clear: (what) => ipcRenderer.invoke('privacy:clear', what),
  });
}

if (location.protocol === 'https:' && window.top === window) {
  const filled = new WeakSet();

  const usernameFor = (pw) => {
    const scope = pw.form || document;
    const inputs = [...scope.querySelectorAll('input')].filter((i) => !i.disabled && i.type !== 'hidden');
    const idx = inputs.indexOf(pw);
    for (let i = idx - 1; i >= 0; i--) {
      if (['text', 'email', 'tel', ''].includes(inputs[i].type)) return inputs[i];
    }
    return scope.querySelector('input[autocomplete="username"], input[type="email"]');
  };

  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const capture = (pw) => {
    const user = usernameFor(pw);
    if (pw.value) ipcRenderer.send('vault:save', { username: user ? user.value : '', password: pw.value });
  };

  const scan = async () => {
    const fields = [...document.querySelectorAll('input[type="password"]')].filter((p) => !filled.has(p));
    if (!fields.length) return;
    const creds = await ipcRenderer.invoke('vault:get');
    for (const pw of fields) {
      filled.add(pw);
      const form = pw.form;
      if (form) form.addEventListener('submit', () => capture(pw), true);
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') capture(pw); });
      if (!creds.length || pw.value) continue;
      const user = usernameFor(pw);
      const match = (user && creds.find((c) => c.username === user.value)) || creds[0];
      if (user && !user.value) setValue(user, match.username);
      setValue(pw, match.password);
      pw.style.boxShadow = '0 0 0 2px #b06cff';
    }
  };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('button, input[type="submit"]');
    if (!btn) return;
    const scope = btn.form || document;
    const pw = scope.querySelector('input[type="password"]');
    if (pw) capture(pw);
  }, true);

  window.addEventListener('DOMContentLoaded', () => {
    scan();
    new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });
  });
}
