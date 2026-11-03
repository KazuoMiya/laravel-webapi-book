// PHPを実行するワーカー。重い処理や無限ループで画面が固まらないよう、ページとは別に動かす。
// php_8_5.js と 8_5_12/php_8_5.wasm は WordPress Playground の php-wasm（GPL-2.0-or-later）のビルドで、
// サイトを作るときに取得する（site/build.py）。
//
// ページとのやり取り
//   受け取る: { type: 'init' } / { type: 'run', id, code }
//   送る:     { type: 'progress', loaded, total } / { type: 'ready' } / { type: 'load-error', message }
//             { type: 'started', id } / { type: 'result', id, output, exitCode, truncated }
const MAX_OUTPUT = 256 * 1024;   // 画面に返す出力の上限（文字数）。超えた分は捨てる

let runtimePromise = null;

async function fetchWithProgress(url, total) {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok || !response.body) throw new Error(`実行環境を取得できませんでした（${response.status}）`);
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (loaded - reported > 256 * 1024) {
      reported = loaded;
      self.postMessage({ type: 'progress', loaded, total });
    }
  }
  self.postMessage({ type: 'progress', loaded, total: loaded });
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function loadRuntime() {
  const loader = await import('./php_8_5.js');
  const bytes = await fetchWithProgress(loader.dependencyFilename, loader.dependenciesTotalSize);
  let resolveReady;
  let rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  const M = loader.init('WORKER', {
    ENV: {},
    noInitialRun: true,
    locateFile: (path) => path,
    // 取得済みのバイト列から起動する（取得の進み具合をページに知らせるため、自分で取得している）
    instantiateWasm(info, receiveInstance) {
      WebAssembly.instantiate(bytes, info)
        .then(({ instance, module }) => receiveInstance(instance, module))
        .catch(rejectReady);
      return {};
    },
    onAbort: (reason) => rejectReady(reason),
    onRuntimeInitialized: () => resolveReady(),
  });
  await ready;
  const ini = '/internal/shared/php.ini';
  M.FS.mkdirTree('/internal/shared');
  M.FS.mkdirTree('/tmp');
  M.FS.writeFile(ini, [
    'memory_limit=128M', 'error_reporting=E_ALL', 'display_errors=1', 'html_errors=0',
    'display_startup_errors=1', 'log_errors=0', 'output_buffering=0', 'implicit_flush=1',
    'date.timezone=Asia/Tokyo',
  ].join('\n'));
  M.ccall('wasm_set_phpini_path', null, ['string'], [ini]);
  await M.ccall('php_wasm_init', null, [], [], { isAsync: true });
  return M;
}

async function execute(M, code) {
  const decoder = new TextDecoder();
  let output = '';
  let truncated = false;
  const append = (chunk) => {
    if (truncated) return;
    output += decoder.decode(chunk, { stream: true });
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT);
      truncated = true;
    }
  };
  M.onHeaders = () => {};
  M.onStdout = append;
  M.onStderr = append;
  M.FS.writeFile('/sample.php', code);
  M.ccall('wasm_set_request_uri', null, ['string'], ['/']);
  M.ccall('wasm_set_query_string', null, ['string'], ['']);
  M.ccall('wasm_set_request_method', null, ['string'], ['GET']);
  M.ccall('wasm_set_request_host', null, ['string'], ['localhost']);
  M.ccall('wasm_set_request_port', null, ['number'], [80]);
  M.ccall('wasm_set_path_translated', null, ['string'], ['/sample.php']);
  M.ccall('wasm_add_SERVER_entry', null, ['string', 'string'], ['SCRIPT_FILENAME', '/sample.php']);
  const exitCode = await M.ccall('wasm_sapi_handle_request', 'number', [], [], { async: true });
  return { output, exitCode, truncated };
}

function ensureRuntime() {
  runtimePromise ??= loadRuntime().then((M) => {
    self.postMessage({ type: 'ready' });
    return M;
  }).catch((error) => {
    runtimePromise = null;
    self.postMessage({ type: 'load-error', message: String(error?.message ?? error) });
    throw error;
  });
  return runtimePromise;
}

let queue = Promise.resolve();
self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    ensureRuntime().catch(() => {});
    return;
  }
  if (message.type !== 'run') return;
  queue = queue.then(async () => {
    let M;
    try {
      M = await ensureRuntime();
    } catch {
      return;   // 読み込みの失敗は load-error で知らせている
    }
    // ここから先が、読者のコードの実行時間（ページ側の時間制限はここから数える）
    self.postMessage({ type: 'started', id: message.id });
    const started = performance.now();
    try {
      const result = await execute(M, message.code);
      self.postMessage({ type: 'result', id: message.id, elapsed: performance.now() - started, ...result });
    } catch (error) {
      self.postMessage({ type: 'result', id: message.id, error: String(error?.message ?? error) });
    }
  });
};
