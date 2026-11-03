// PHPを実行するワーカー。重い処理や無限ループで画面が固まらないよう、ページとは別に動かす
// php_8_5.js と 8_5_12/php_8_5.wasm は WordPress Playground の php-wasm（GPL-2.0-or-later）のビルドで、
// サイトを作るときに取得する（site/build.py）
let runtimePromise = null;
let initialized = false;

async function loadRuntime() {
  const loader = await import('./php_8_5.js');
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  const M = loader.init('WORKER', {
    ENV: {},
    noInitialRun: true,
    locateFile: (path) => path,
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
  return M;
}

async function execute(code) {
  runtimePromise ??= loadRuntime();
  const M = await runtimePromise;
  const decoder = new TextDecoder();
  let output = '';
  M.onHeaders = () => {};
  M.onStdout = (chunk) => { output += decoder.decode(chunk, { stream: true }); };
  M.onStderr = (chunk) => { output += decoder.decode(chunk, { stream: true }); };
  if (!initialized) {
    await M.ccall('php_wasm_init', null, [], [], { isAsync: true });
    initialized = true;
  }
  M.FS.writeFile('/sample.php', code);
  M.ccall('wasm_set_request_uri', null, ['string'], ['/']);
  M.ccall('wasm_set_query_string', null, ['string'], ['']);
  M.ccall('wasm_set_request_method', null, ['string'], ['GET']);
  M.ccall('wasm_set_request_host', null, ['string'], ['localhost']);
  M.ccall('wasm_set_request_port', null, ['number'], [80]);
  M.ccall('wasm_set_path_translated', null, ['string'], ['/sample.php']);
  M.ccall('wasm_add_SERVER_entry', null, ['string', 'string'], ['SCRIPT_FILENAME', '/sample.php']);
  const exitCode = await M.ccall('wasm_sapi_handle_request', 'number', [], [], { async: true });
  return { output, exitCode };
}

let queue = Promise.resolve();
self.onmessage = (event) => {
  const { id, code } = event.data;
  queue = queue.then(async () => {
    try {
      const result = await execute(code);
      self.postMessage({ id, ...result });
    } catch (error) {
      self.postMessage({ id, error: String(error?.message ?? error) });
    }
  });
};
self.postMessage({ ready: true });
