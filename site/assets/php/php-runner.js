// ページ側の窓口。ワーカーにコードを渡し、時間がかかりすぎたらワーカーを作り直す
const TIMEOUT_MS = 10000;
let worker = null;
let nextId = 1;
const pending = new Map();

function startWorker() {
  worker = new Worker(new URL('./php-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id } = event.data;
    if (!id || !pending.has(id)) return;
    const { resolve, timer } = pending.get(id);
    clearTimeout(timer);
    pending.delete(id);
    resolve(event.data);
  };
  worker.onerror = (event) => {
    for (const [id, { resolve, timer }] of pending) {
      clearTimeout(timer);
      resolve({ id, error: event.message || 'PHPの実行環境を読み込めませんでした。' });
    }
    pending.clear();
    worker = null;
  };
}

export function runPHP(code) {
  if (!worker) startWorker();
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      worker.terminate();
      worker = null;
      resolve({ id, timeout: true });
    }, TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    worker.postMessage({ id, code });
  });
}
