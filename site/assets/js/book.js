// Web版の画面の動き：試し方の切り替え、表示テーマ、目次、検索、コードのコピーと実行
import { getMode, setMode, onModeChange } from './prefs.js';

const root = document.documentElement;
const base = document.querySelector('meta[name="tb-root"]')?.content ?? './';

// ---------- 試し方（ブラウザーだけ／手元の環境） ----------
function syncModeButtons() {
  const mode = getMode();
  root.dataset.mode = mode;
  for (const button of document.querySelectorAll('.mode-switch [data-mode-value], .mode-cards [data-mode-value]')) {
    button.setAttribute('aria-pressed', String(button.dataset.modeValue === mode));
  }
}
for (const button of document.querySelectorAll('.mode-switch [data-mode-value], .mode-cards [data-mode-value]')) {
  button.addEventListener('click', () => setMode(button.dataset.modeValue));
}
onModeChange(syncModeButtons);
syncModeButtons();

// ---------- 表示テーマ ----------
const themeButton = document.querySelector('.theme-toggle');
function currentTheme() {
  return root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function syncThemeButton() {
  const dark = currentTheme() === 'dark';
  themeButton?.setAttribute('aria-label', dark ? '明るい表示にする' : '暗い表示にする');
  themeButton?.setAttribute('title', dark ? '明るい表示にする' : '暗い表示にする');
}
themeButton?.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('tb-theme', next); } catch { /* 保存できなくても切り替える */ }
  syncThemeButton();
});
syncThemeButton();

// ---------- 小さい画面の目次 ----------
const navToggle = document.querySelector('.nav-toggle');
navToggle?.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  navToggle.setAttribute('aria-expanded', String(open));
});
document.querySelector('.sidebar-scrim')?.addEventListener('click', () => {
  document.body.classList.remove('nav-open');
  navToggle?.setAttribute('aria-expanded', 'false');
});

// ---------- 読んでいる節を、右の目次で示す ----------
const tocLinks = new Map([...document.querySelectorAll('.page-toc a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]));
if (tocLinks.size && 'IntersectionObserver' in window) {
  const visible = new Set();
  const observer = new IntersectionObserver((records) => {
    for (const r of records) (r.isIntersecting ? visible.add(r.target.id) : visible.delete(r.target.id));
    const headings = [...tocLinks.keys()];
    const current = headings.find((id) => visible.has(id));
    if (!current) return;
    for (const [id, a] of tocLinks) a.classList.toggle('is-current', id === current);
  }, { rootMargin: '-64px 0px -60% 0px' });
  for (const id of tocLinks.keys()) {
    const h = document.getElementById(id);
    if (h) observer.observe(h);
  }
}

// ---------- コードのコピー、PHPの実行、APIを試す ----------
function addButton(block, label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn ${className}`;
  button.textContent = label;
  button.addEventListener('click', () => onClick(button));
  block.querySelector('.code-actions').append(button);
  return button;
}

for (const block of document.querySelectorAll('.code')) {
  addButton(block, 'コピー', 'btn-quiet', async (button) => {
    const text = block.querySelector('textarea')?.value ?? block.querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'コピーしました';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(block.querySelector('code'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      button.textContent = '選択しました';
    }
    setTimeout(() => { button.textContent = 'コピー'; }, 1600);
  });
}

const phpBlocks = document.querySelectorAll('.code[data-run="php"]');
if (phpBlocks.length) {
  import('./php-ui.js').then(({ mountPhp }) => {
    for (const block of phpBlocks) mountPhp(block, { editable: block.hasAttribute('data-playground') });
  });
}

for (const block of document.querySelectorAll('.code[data-run="http"]')) {
  let panel = null;
  const button = addButton(block, '試す', 'btn-run', async () => {
    if (panel) {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      return;
    }
    button.disabled = true;
    const { mountConsole } = await import('./console.js');
    panel = mountConsole(block);
    button.disabled = false;
    button.setAttribute('aria-expanded', 'true');
  });
  button.setAttribute('aria-expanded', 'false');
  block.querySelector('.code-actions').prepend(button);
}

// ---------- 検索 ----------
const searchInput = document.querySelector('#search');
const results = document.querySelector('.search-results');
let index = null;

async function loadIndex() {
  index ??= fetch(`${base}search-index.json`).then((r) => r.json()).catch(() => []);
  return index;
}

function snippet(text, query) {
  const at = text.indexOf(query);
  const start = Math.max(0, at - 30);
  const before = text.slice(start, at);
  const after = text.slice(at + query.length, at + query.length + 50);
  const frag = document.createDocumentFragment();
  frag.append(`${start > 0 ? '…' : ''}${before}`);
  const mark = document.createElement('mark');
  mark.textContent = query;
  frag.append(mark, `${after}…`);
  return frag;
}

async function search() {
  const query = searchInput.value.trim();
  if (!query) { results.hidden = true; return; }
  const entries = await loadIndex();
  const lower = query.toLowerCase();
  const hits = [];
  for (const e of entries) {
    const inTitle = e.h.toLowerCase().includes(lower);
    const at = e.x.toLowerCase().indexOf(lower);
    if (inTitle || at >= 0) hits.push({ e, score: inTitle ? 0 : 1, at });
    if (hits.length > 60) break;
  }
  hits.sort((a, b) => a.score - b.score);
  results.replaceChildren();
  if (!hits.length) {
    const p = document.createElement('p');
    p.className = 'search-empty';
    p.textContent = `「${query}」を含む節は見つかりませんでした。`;
    results.append(p);
  }
  for (const { e, at } of hits.slice(0, 20)) {
    const a = document.createElement('a');
    a.href = `${base}${e.u}`;
    a.className = 'search-hit';
    const where = document.createElement('span');
    where.className = 'search-where';
    where.textContent = e.c;
    const title = document.createElement('span');
    title.className = 'search-title';
    title.textContent = e.h;
    a.append(where, title);
    if (at >= 0) {
      const text = document.createElement('span');
      text.className = 'search-text';
      text.append(snippet(e.x, e.x.substr(at, query.length)));
      a.append(text);
    }
    results.append(a);
  }
  results.hidden = false;
}

if (searchInput) {
  let timer = null;
  searchInput.addEventListener('focus', loadIndex, { once: true });
  searchInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 120); });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchInput.value = ''; results.hidden = true; searchInput.blur(); }
    if (e.key === 'Enter') { results.querySelector('a')?.click(); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) results.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      searchInput.focus();
    }
  });
}
