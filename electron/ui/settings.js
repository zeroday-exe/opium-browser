const api = window.opium;
let settings = {};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const letter = (u) => `<span class="letter">${esc(hostOf(u).charAt(0).toUpperCase())}</span>`;

async function save(key, value) {
  settings[key] = value;
  await api.set(key, value);
  render();
}

function render() {
  document.documentElement.style.setProperty('--accent', settings.accent);
  document.querySelectorAll('[data-key]').forEach((el) => {
    const v = settings[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'SELECT') el.value = v;
    else if (el.tagName === 'INPUT') { if (document.activeElement !== el) el.value = v ?? ''; }
    else el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(v) === b.dataset.value));
  });
  document.querySelectorAll('[data-show]').forEach((row) => {
    const [key, want] = row.dataset.show.split('=');
    row.hidden = String(settings[key]) !== want;
  });
}

function bind() {
  document.querySelectorAll('.swatches button').forEach((b) => b.style.setProperty('--c', b.dataset.value));
  document.querySelectorAll('[data-key]').forEach((el) => {
    const key = el.dataset.key;
    if (el.type === 'checkbox') el.addEventListener('change', () => save(key, el.checked));
    else if (el.tagName === 'SELECT') el.addEventListener('change', () => save(key, el.value));
    else if (el.tagName === 'INPUT') el.addEventListener('change', () => save(key, el.value.trim()));
    else el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) save(key, el.dataset.type === 'number' ? Number(b.dataset.value) : b.dataset.value);
    });
  });

  document.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    await api.clear(b.dataset.clear);
    b.textContent = 'Gelöscht';
  }));

  document.getElementById('import-brave').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const out = document.getElementById('import-result');
    btn.disabled = true;
    btn.textContent = 'Importiere …';
    const r = await api.importBrave();
    btn.disabled = false;
    btn.textContent = 'Importieren';
    out.hidden = false;
    out.textContent = r.ok
      ? `${r.cookies} Cookies, ${r.passwords} Passwörter, ${r.bookmarks} Lesezeichen und ${r.history} Verlaufseinträge übernommen.${r.skipped ? ` ${r.skipped} Cookies konnten nicht entschlüsselt werden.` : ''}`
      : r.error;
    loadPasswords();
    loadBookmarks();
  });

  document.getElementById('pw-filter').addEventListener('input', loadPasswords);

  const links = [...document.querySelectorAll('nav a')];
  const observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${en.target.id}`));
    }
  }, { rootMargin: '-30% 0px -65% 0px' });
  document.querySelectorAll('section').forEach((s) => observer.observe(s));
}

async function loadPasswords() {
  const list = document.getElementById('pw-list');
  const q = document.getElementById('pw-filter').value.toLowerCase();
  const items = (await api.passwords()).filter((p) => (p.origin + p.username).toLowerCase().includes(q));
  list.dataset.empty = 'Keine gespeicherten Passwörter.';
  list.innerHTML = items.map((p) => `
    <div class="row">
      ${letter(p.origin)}
      <div class="label"><b>${esc(hostOf(p.origin))}</b><span>${esc(p.username || 'ohne Benutzername')}</span></div>
      <button class="link" data-o="${esc(p.origin)}" data-u="${esc(p.username)}">Entfernen</button>
    </div>`).join('');
}

async function loadBookmarks() {
  const list = document.getElementById('bm-list');
  const items = await api.bookmarks();
  list.dataset.empty = 'Noch keine Lesezeichen.';
  list.innerHTML = items.map((b) => `
    <div class="row">
      ${b.favicon ? `<img src="${esc(b.favicon)}" alt="">` : letter(b.url)}
      <div class="label"><b>${esc(b.title || hostOf(b.url))}</b><span>${esc(hostOf(b.url))}</span></div>
      <button class="link" data-url="${esc(b.url)}">Entfernen</button>
    </div>`).join('');
  list.querySelectorAll('img').forEach((img) => { img.onerror = () => { img.outerHTML = letter(img.closest('.row').querySelector('[data-url]').dataset.url); }; });
}

document.getElementById('pw-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-o]');
  if (!b) return;
  await api.deletePassword(b.dataset.o, b.dataset.u);
  loadPasswords();
});
document.getElementById('bm-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-url]');
  if (!b) return;
  await api.deleteBookmark(b.dataset.url);
  loadBookmarks();
});

(async () => {
  const data = await api.get();
  if (!data) return;
  settings = data.settings;
  document.getElementById('versions').textContent = `Version ${data.versions.app} · Chromium ${data.versions.chrome} · Electron ${data.versions.electron}`;
  if (data.stats.blocked) {
    document.getElementById('blocked-stat').textContent = `Blockiert Werbung, Tracker, Cookie-Banner und Malware. Bisher ${data.stats.blocked.toLocaleString('de-DE')} Anfragen blockiert.`;
  }
  bind();
  render();
  loadPasswords();
  loadBookmarks();
})();
