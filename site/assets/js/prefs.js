// 読者ごとの設定（試し方のモード）。ブラウザーに保存できないときは、その場かぎりの設定として動く
const MODE_KEY = 'tb-mode';
const listeners = new Set();

function read(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 保存できなくても続ける */ }
}

export function getMode() {
  return document.documentElement.dataset.mode || read(MODE_KEY, 'browser');
}

export function setMode(mode) {
  document.documentElement.dataset.mode = mode;
  write(MODE_KEY, mode);
  for (const fn of listeners) fn(mode);
}

export function onModeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function readJSON(key, fallback) {
  try { return JSON.parse(read(key, 'null')) ?? fallback; } catch { return fallback; }
}

export function writeJSON(key, value) {
  write(key, JSON.stringify(value));
}
