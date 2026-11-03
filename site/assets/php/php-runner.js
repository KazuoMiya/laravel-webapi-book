// ページ側の窓口。実行環境の読み込みと、読者のコードの実行を分けて扱う。
// 時間の制限（10秒）は実行が始まってから数え、読み込みの時間は含めない
const RUN_TIMEOUT_MS = 10000;

let worker = null;
let readyPromise = null;
let nextId = 1;
const pending = new Map();      // id → { resolve, timer }
const progressListeners = new Set();
let lastProgress = null;
let ready = false;

function settleAll(result) {
  for (const [id, { resolve, timer }] of pending) {
    clearTimeout(timer);
    resolve({ id, ...result });
  }
  pending.clear();
}

function stopWorker(result) {
  worker?.terminate();
  worker = null;
  readyPromise = null;
  lastProgress = null;
  ready = false;
  settleAll(result);
}

function startWorker() {
  worker = new Worker(new URL('./php-worker.js', import.meta.url), { type: 'module' });
  let resolveReady;
  let rejectReady;
  readyPromise = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  readyPromise.catch(() => {});
  worker.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'progress') {
      lastProgress = message;
      for (const fn of progressListeners) fn(message);
    } else if (message.type === 'ready') {
      ready = true;
      resolveReady();
    } else if (message.type === 'load-error') {
      const error = new Error(message.message);
      rejectReady(error);
      stopWorker({ error: `PHPの実行環境を読み込めませんでした（${message.message}）` });
    } else if (message.type === 'started') {
      const entry = pending.get(message.id);
      if (!entry) return;
      entry.timer = setTimeout(() => {
        // 止まらないコードは、ワーカーごと止める。待っていたほかの実行も、ここで終わらせる
        pending.delete(message.id);
        entry.resolve({ id: message.id, timeout: true });
        stopWorker({ cancelled: true });
      }, RUN_TIMEOUT_MS);
    } else if (message.type === 'result') {
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.id);
      entry.resolve(message);
    }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'PHPの実行環境を読み込めませんでした。');
    rejectReady(error);
    stopWorker({ error: error.message });
  };
  worker.postMessage({ type: 'init' });
}

// 実行環境の読み込みを始める（「実行」ボタンに近づいたときに、先に始めておく）
export function preload() {
  if (!worker) startWorker();
  return readyPromise;
}

export function isReady() {
  return ready;
}

export function onProgress(fn) {
  progressListeners.add(fn);
  if (lastProgress) fn(lastProgress);
  return () => progressListeners.delete(fn);
}

// 読み込みを取りやめる（画面の「取りやめる」ボタン）
export function cancelLoading() {
  stopWorker({ cancelled: true });
}

export function runPHP(code) {
  if (!worker) startWorker();
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve, timer: null });
    worker.postMessage({ type: 'run', id, code });
  });
}
