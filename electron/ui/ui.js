const $ = (id) => document.getElementById(id);
const api = window.opium;
const state = { tabs: [], bookmarks: [], current: null, suggestions: [], sel: -1 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const GLOBE = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.8"/><path d="M2.2 8h11.6M8 2.2c1.7 1.8 2.4 3.7 2.4 5.8S9.7 12 8 13.8C6.3 12 5.6 10.1 5.6 8S6.3 4 8 2.2"/></svg>';
const GEAR = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.1"/><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6"/></svg>';
const SPARK = '<svg viewBox="0 0 16 16"><path d="M8 2.5v11M3.2 5.2l9.6 5.6M3.2 10.8l9.6-5.6"/></svg>';

function reportLayout() {
  const r = $('viewport').getBoundingClientRect();
  api.layout({ x: r.x, y: r.y, width: r.width, height: r.height });
}
new ResizeObserver(reportLayout).observe($('viewport'));
$('sidebar').addEventListener('transitionend', reportLayout);

document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => api.win(b.dataset.win)));
$('back').onclick = () => api.nav('back');
$('forward').onclick = () => api.nav('forward');
$('reload').onclick = () => api.nav('reload');
$('newtab').onclick = () => { api.newTab(); focusUrl(); };
$('settings').onclick = () => api.openSettings();
$('star').onclick = () => api.toggleBookmark();

function favicon(t) {
  if (t.settings) return GEAR;
  if (t.internal) return SPARK;
  if (t.favicon) return `<img src="${esc(t.favicon)}" alt="" width="16" height="16">`;
  return GLOBE;
}

function renderTabs() {
  $('tabs').innerHTML = state.tabs.map((t) => `
    <li class="tab${t.active ? ' active' : ''}${t.loading ? ' loading' : ''}" data-id="${t.id}" title="${esc(t.title)}">
      <span class="fav">${favicon(t)}</span>
      <span class="title">${esc(t.title)}</span>
      <button class="x" data-close="${t.id}" aria-label="Tab schließen"><svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button>
    </li>`).join('');
  $('tabs').querySelectorAll('img').forEach((img) => { img.onerror = () => { img.outerHTML = GLOBE; }; });
}

function renderEssentials() {
  const cur = state.current?.url;
  $('essentials').innerHTML = state.bookmarks.map((b, i) => {
    const icon = b.favicon
      ? `<img src="${esc(b.favicon)}" alt="">`
      : `<span class="letter">${esc(hostOf(b.url).charAt(0).toUpperCase())}</span>`;
    return `<button class="ess${cur && hostOf(cur) === hostOf(b.url) ? ' active' : ''}" data-i="${i}" title="${esc(b.title)}">${icon}</button>`;
  }).join('');
  $('essentials').querySelectorAll('img').forEach((img) => {
    img.onerror = () => { img.outerHTML = `<span class="letter">${esc(img.closest('.ess').title.charAt(0).toUpperCase())}</span>`; };
  });
}

$('essentials').addEventListener('click', (e) => {
  const b = e.target.closest('.ess');
  if (b) api.nav('go', state.bookmarks[Number(b.dataset.i)].url);
});
$('essentials').addEventListener('auxclick', (e) => {
  const b = e.target.closest('.ess');
  if (b && e.button === 1) api.newTab(state.bookmarks[Number(b.dataset.i)].url);
});

$('tabs').addEventListener('click', (e) => {
  const close = e.target.closest('[data-close]');
  if (close) { api.closeTab(Number(close.dataset.close)); return; }
  const tab = e.target.closest('.tab');
  if (tab) api.activate(Number(tab.dataset.id));
});
$('tabs').addEventListener('auxclick', (e) => {
  const tab = e.target.closest('.tab');
  if (tab && e.button === 1) api.closeTab(Number(tab.dataset.id));
});

function syncUrl() {
  const cur = state.current;
  const editing = document.activeElement === $('url');
  if (!editing) $('url').value = cur ? cur.url : '';
  const showHost = !editing && cur && cur.url && !cur.settings;
  $('host').textContent = showHost ? hostOf(cur.url) : '';
  $('urlbar').classList.toggle('show-host', !!showHost);
}

api.on('tabs', ({ tabs, totalBlocked, bookmarks }) => {
  state.tabs = tabs;
  state.bookmarks = bookmarks;
  state.current = tabs.find((t) => t.active) || null;
  renderTabs();
  renderEssentials();
  syncUrl();
  const cur = state.current;
  if (cur) {
    $('back').disabled = !cur.canBack;
    $('forward').disabled = !cur.canForward;
    $('reload').classList.toggle('loading', cur.loading);
    $('star').classList.toggle('on', !!cur.url && bookmarks.concat().some((b) => b.url === cur.url));
    $('star').style.visibility = cur.internal ? 'hidden' : '';
  }
  const tab = cur && cur.blocked ? `${cur.blocked} hier · ` : '';
  $('shield').textContent = totalBlocked ? `${tab}${totalBlocked.toLocaleString('de-DE')} blockiert` : '';
});

api.on('appearance', ({ accent, snow, compact }) => {
  document.documentElement.style.setProperty('--accent', accent);
  document.body.classList.toggle('compact', compact);
  window.snow.set(snow, accent);
  setTimeout(reportLayout, 240);
});
api.on('focus', (focused) => document.body.classList.toggle('inactive', !focused));

function focusUrl() {
  $('url').focus();
  $('url').select();
}
api.on('focus-url', focusUrl);
api.on('toggle-sidebar', () => document.body.classList.toggle('hidden-sidebar'));
api.on('maximized', () => reportLayout());

let toastTimer;
api.on('toast', (msg) => {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
});

const url = $('url');
const sug = $('suggest');
function renderSuggest() {
  if (!state.suggestions.length) { sug.hidden = true; return; }
  sug.hidden = false;
  sug.innerHTML = state.suggestions.map((s, i) => `<li class="${i === state.sel ? 'sel' : ''}" data-i="${i}"><span>${esc(s.title)}</span><small>${esc(hostOf(s.url))}</small></li>`).join('');
}
function closeSuggest() {
  state.suggestions = [];
  state.sel = -1;
  renderSuggest();
}
url.addEventListener('input', async () => {
  state.sel = -1;
  state.suggestions = await api.suggest(url.value);
  renderSuggest();
});
url.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const n = state.suggestions.length;
    if (!n) return;
    e.preventDefault();
    state.sel += e.key === 'ArrowDown' ? 1 : -1;
    if (state.sel >= n) state.sel = -1;
    if (state.sel < -1) state.sel = n - 1;
    renderSuggest();
  } else if (e.key === 'Enter') {
    api.nav('go', state.sel >= 0 ? state.suggestions[state.sel].url : url.value);
    closeSuggest();
    url.blur();
  } else if (e.key === 'Escape') {
    closeSuggest();
    url.blur();
  }
});
url.addEventListener('focus', () => { syncUrl(); url.select(); });
url.addEventListener('blur', () => setTimeout(() => { closeSuggest(); syncUrl(); }, 120));
sug.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  api.nav('go', state.suggestions[Number(li.dataset.i)].url);
  closeSuggest();
});

reportLayout();
