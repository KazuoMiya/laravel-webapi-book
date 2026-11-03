// 本文の curl の例を、その場で送って結果を確かめるコンソール
import { createMockApi } from './taskboard-mock.js';
import { splitCommands, parseCurl, parseAssign } from './curl.js';
import { getMode, setMode, onModeChange, readJSON, writeJSON } from './prefs.js';

// 模擬APIの変数（架空のトークン）だけをブラウザーに保存する。手元のAPIの本物のトークンは、
// このページを開いている間だけメモリーに置き、閉じたり再読み込みしたりすると消える
const MOCK_VARS_KEY = 'tb-console-vars-mock';
const LOCAL_BASE_KEY = 'tb-local-api';
const BOOK_ORIGIN = 'http://localhost';   // 本文のコマンドに書いてあるAPIのオリジン
// 認証情報なしで参照してよい外部のAPI（第1章）
const PUBLIC_APIS = ['https://api.github.com'];
const KNOWN_VARS = [
  { name: 'TOKEN', email: 'test@example.com', who: 'テストユーザー' },
  { name: 'MATE_TOKEN', email: 'mate@example.com', who: 'チームメイト' },
  { name: 'HANAKO_TOKEN', email: 'hanako@example.com', who: '花子（第10章で登録）' },
];
const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
  404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 412: 'Precondition Failed',
  419: 'Page Expired', 422: 'Unprocessable Content', 428: 'Precondition Required', 429: 'Too Many Requests',
  500: 'Internal Server Error', 503: 'Service Unavailable',
};

// 以前の版が保存していた変数（手元のAPIのトークンを含むことがある）は消す
try { localStorage.removeItem('tb-console-vars'); } catch { /* 消せなくても続ける */ }

let mock = null;
const mails = [];
function getMock() {
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }
  mock ??= createMockApi({ storage, onMail: (mail) => { mails.push(mail); } });
  return mock;
}

const localVars = new Map();
function varsFor(scope) {
  if (scope === 'browser') return readJSON(MOCK_VARS_KEY, {});
  if (!localVars.has(scope)) localVars.set(scope, Object.create(null));
  return localVars.get(scope);
}
function setVar(scope, name, value) {
  const vars = varsFor(scope);
  if (value === null) delete vars[name]; else vars[name] = value;
  if (scope === 'browser') writeJSON(MOCK_VARS_KEY, vars);
  window.dispatchEvent(new CustomEvent('tb-vars-change'));
}

// 手元のAPIのオリジン。localhost などの自分のパソコンだけを指定できる
function localBase() {
  let saved = '';
  try { saved = localStorage.getItem(LOCAL_BASE_KEY) ?? ''; } catch { saved = ''; }
  return normalizeLocalBase(saved) ?? BOOK_ORIGIN;
}
function normalizeLocalBase(value) {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// JSON を見やすく整形し、キーと値を色分けする
function prettyBody(body, contentType) {
  if (!body) return null;
  let text = body;
  let isJson = false;
  if (/json/i.test(contentType ?? '') || /^[[{]/.test(body.trim())) {
    try { text = JSON.stringify(JSON.parse(body), null, 2); isJson = true; } catch { /* JSON でなければそのまま */ }
  }
  const pre = el('pre', { class: 'resp-body' });
  if (!isJson) { pre.textContent = text; return pre; }
  pre.innerHTML = escapeHtml(text).replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    (m, str, colon, lit, num) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (lit) return `<span class="j-lit">${lit}</span>`;
      return `<span class="j-num">${num}</span>`;
    },
  );
  return pre;
}

function shortToken(value) {
  return value.length > 14 ? `${value.slice(0, 10)}…` : value;
}

function hasCredentials(headers) {
  return Object.keys(headers).some((k) => ['authorization', 'cookie', 'proxy-authorization'].includes(k.toLowerCase()));
}

// PHPはフォーム項目名のドットや空白を下線に変換する。教材では通常の項目名だけを受け付ける。
function checkPostFields(params) {
  for (const name of params.keys()) {
    if (name === '_method' || !/^[a-zA-Z0-9_]+(?:\[[a-zA-Z0-9_]*\])*$/.test(name) || name.startsWith('_method[')) {
      throw new Error('POSTの項目名やメソッドの上書き指定を確かめてください。');
    }
  }
}

function checkLocalPost(request, url) {
  if (request.method !== 'POST') return;
  const headers = new Headers(request.headers);
  for (const name of headers.keys()) {
    if (name.replace(/[_.]/g, '-') === 'x-http-method-override') {
      throw new Error('メソッドの上書きはできません。削除する場合は -X DELETE を指定してください。');
    }
  }
  checkPostFields(url.searchParams);
  if (!request.body) return;
  const type = (headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/x-www-form-urlencoded') {
    checkPostFields(new URLSearchParams(request.body));
  } else if (type === 'application/json') {
    let fields;
    try { fields = JSON.parse(request.body); } catch { return; } // JSONの構文エラーはAPIで扱う
    if (fields && Object.hasOwn(fields, '_method')) throw new Error('JSONでメソッドを上書きすることはできません。');
  } else {
    throw new Error('手元のAPIへのPOSTにはJSONまたはフォーム形式を指定してください。');
  }
}

// 送り先を決める。認証情報を送ってよいのは、本書のAPI（模擬API、または設定した手元のAPIの /api/）だけ
export function resolveTarget(mode, request, base = BOOK_ORIGIN) {
  const url = new URL(request.url);
  const isBookApi = url.origin === BOOK_ORIGIN || url.origin === base;
  const credentialed = hasCredentials(request.headers);
  if (isBookApi && mode === 'browser') return { via: 'mock', url: `${BOOK_ORIGIN}${url.pathname}${url.search}` };
  if (isBookApi && mode === 'local') {
    const target = `${base}${url.pathname}${url.search}`;
    if (!url.pathname.startsWith('/api/') || /%(?:25|2e|2f|5c)/i.test(url.pathname)) {
      throw new Error('認証情報は、手元のAPIの /api/ 以下にだけ送ります。送り先のパスを確かめてください。');
    }
    checkLocalPost(request, url);
    return { via: 'local', url: target };
  }
  if (credentialed) {
    throw new Error(`認証情報（Authorization など）は、本書のAPIにだけ送ります。${url.origin} には送りません。`);
  }
  if (!PUBLIC_APIS.includes(url.origin)) {
    throw new Error(`この画面から送れるのは、本書のAPIと ${PUBLIC_APIS.join('、')} だけです。ほかの送り先は、ターミナルの curl で試してください。`);
  }
  if (!['GET', 'HEAD'].includes(request.method) || request.body) {
    throw new Error('外部のAPIには、データを送らない参照（GET）だけを送れます。');
  }
  if (request.missing?.length || Object.keys(request.headers).length || url.username || url.password ||
      url.search || url.hash || !/^\/users\/[a-z0-9-]+$/i.test(url.pathname)) {
    throw new Error('外部の演習では、変数やヘッダーを使わず GitHub の /users/ユーザー名 を指定してください。');
  }
  return { via: 'internet', url: url.href };
}

// 変数を渡す前に送信先を決める。展開の前後で外部APIに切り替わるコマンドも拒否する。
export function prepareRequest(mode, text, vars, base) {
  const literal = parseCurl(text, Object.create(null));
  const url = new URL(literal.url);
  if (url.origin !== BOOK_ORIGIN && url.origin !== base) {
    return { request: literal, target: resolveTarget(mode, literal, base) };
  }
  const expanded = vars.__last_invite ? text.replaceAll('招待コード', vars.__last_invite) : text;
  const request = parseCurl(expanded, vars);
  const target = resolveTarget(mode, request, base);
  if (target.via === 'internet') throw new Error('変数で外部の送り先を指定することはできません。');
  return { request, target };
}

async function send(target, request) {
  const started = performance.now();
  if (target.via === 'mock') {
    const r = await getMock().request({ ...request, url: target.url });
    return { ...r, via: 'mock', url: target.url, ms: Math.round(performance.now() - started) };
  }
  const res = await fetch(target.url, {
    method: request.method,
    headers: request.headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body ?? undefined,
    mode: 'cors',
    credentials: 'omit',
    redirect: 'error',   // 別の送り先へ転送されても、ついて行かない
  });
  const body = request.method === 'HEAD' ? '' : await res.text();
  return {
    status: res.status,
    statusText: res.statusText || STATUS_TEXT[res.status] || '',
    headers: [...res.headers.entries()].map(([k, v]) => [k.replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase()), v]),
    body,
    via: target.via,
    url: target.url,
    ms: Math.round(performance.now() - started),
  };
}

function renderResponse(result, request) {
  const box = el('div', { class: 'resp' });
  const family = Math.floor(result.status / 100);
  const where = { mock: 'ブラウザー内の模擬API', local: `手元のAPI（${new URL(result.url).origin}）`, internet: 'インターネット上のAPI' }[result.via];
  box.append(el('div', { class: 'resp-status' },
    el('span', { class: `status-pill s${family}xx` }, String(result.status)),
    el('span', { class: 'resp-line' }, `HTTP/1.1 ${result.status} ${result.statusText}`),
    el('span', { class: 'resp-meta' }, `${where}・${result.ms}ms`)));
  const headerText = result.headers.map(([k, v]) => `${k}: ${v}`).join('\n');
  if (headerText) {
    const details = el('details', { class: 'resp-headers', open: request.include || null },
      el('summary', {}, `ヘッダー（${result.headers.length}）`),
      el('pre', {}, headerText));
    box.append(details);
  }
  const contentType = result.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1];
  const body = prettyBody(result.body, contentType);
  if (body) box.append(body);
  else box.append(el('p', { class: 'resp-empty' }, 'ボディはありません。'));
  return box;
}

function note(text, kind = 'info') {
  return el('p', { class: `cmd-note note-${kind}` }, text);
}

// 作成のリクエストか（個人のタスク、チームのタスク）
export function isCreateTask(request) {
  return request.method === 'POST' && /\/api\/v1\/(?:teams\/\d+\/)?tasks$/.test(new URL(request.url).pathname);
}

// 作成で返ったIDを、続くコマンドの /tasks/{id} に入れる。書き換えたコマンドの数を返す
export function carryCreatedId(texts, createdId) {
  let changed = 0;
  const next = texts.map((text) => {
    const replaced = text.replace(/\/tasks\/\d+(?=[/?\s"'\\]|$)/g, `/tasks/${createdId}`);
    if (replaced !== text) changed++;
    return replaced;
  });
  return { texts: next, changed };
}

export function mountConsole(codeBlock) {
  const source = codeBlock.querySelector('code').textContent;
  const entries = splitCommands(source);
  if (!entries.some((e) => e.kind === 'curl' || e.kind === 'assign')) return null;

  const panel = el('section', { class: 'console', 'aria-label': 'APIを試すコンソール' });
  const modeButtons = {};
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'リクエストの送り先' },
    ...[['browser', 'ブラウザー内の模擬API'], ['local', '手元のAPI']].map(([m, label]) => {
      modeButtons[m] = el('button', { type: 'button', 'data-mode-value': m, onclick: () => setMode(m) }, label);
      return modeButtons[m];
    }));
  const head = el('div', { class: 'console-head' }, el('span', { class: 'console-title' }, 'その場で送ってみる'), seg);
  const hint = el('p', { class: 'console-hint' });
  const baseInput = el('input', { type: 'url', class: 'base-input', spellcheck: 'false', 'aria-label': '手元のAPIのURL' });
  const baseRow = el('label', { class: 'console-base' }, '手元のAPIのURL', baseInput,
    el('span', { class: 'base-help' }, 'localhost か 127.0.0.1 だけを指定できます。'));
  const varsBar = el('div', { class: 'console-vars' });
  const list = el('ol', { class: 'console-cmds' });
  const runAll = el('button', { type: 'button', class: 'btn btn-quiet' }, 'すべて順に送る');
  const reset = el('button', { type: 'button', class: 'btn btn-link' }, '模擬APIのデータを初期状態に戻す');
  const foot = el('div', { class: 'console-foot' }, runAll, reset);
  panel.append(head, hint, baseRow, varsBar, list, foot);

  const runners = [];

  baseInput.addEventListener('change', () => {
    const normalized = normalizeLocalBase(baseInput.value);
    if (!normalized) {
      baseInput.value = localBase();
      hint.textContent = '手元のAPIのURLには、http://localhost や http://localhost:8080 のように、自分のパソコンを指すURLだけを指定できます。';
      return;
    }
    try { localStorage.setItem(LOCAL_BASE_KEY, normalized); } catch { /* 保存できなくても、この場では使う */ }
    baseInput.value = normalized;
    window.dispatchEvent(new CustomEvent('tb-vars-change'));
  });

  function refreshMode() {
    const mode = getMode();
    for (const [m, b] of Object.entries(modeButtons)) b.setAttribute('aria-pressed', String(m === mode));
    hint.textContent = mode === 'browser'
      ? 'localhost への送信は、このページの中で動く模擬API（本書の完成版と同じ動き）が受け取ります。シーダーと同じデータが入っています。'
      : '手元のSailで動かしているAPIに送ります。api フォルダーの README の「Web版から送る」の設定が必要です。受け取ったトークンは、このページを閉じると消えます。';
    baseRow.hidden = mode !== 'local';
    baseInput.value = localBase();
    reset.hidden = mode !== 'browser';
    renderVars();
  }

  function renderVars() {
    const mode = getMode();
    const scope = mode === 'local' ? localBase() : 'browser';
    const vars = varsFor(scope);
    varsBar.replaceChildren();
    const names = new Set([...KNOWN_VARS.map((v) => v.name), ...Object.keys(vars).filter((n) => !n.startsWith('__'))]);
    const revoked = vars.__revoked ?? [];
    for (const name of names) {
      const known = KNOWN_VARS.find((v) => v.name === name);
      const value = vars[name];
      const dead = value && revoked.includes(value);
      const chip = el('span', { class: `var-chip${dead ? ' is-dead' : value ? ' is-set' : ''}` },
        el('code', {}, `$${name}`),
        el('span', { class: 'var-value' }, dead ? 'ログアウト済み' : value ? shortToken(value) : '未設定'));
      const canLogin = known && (known.name !== 'HANAKO_TOKEN' || mode === 'local' || getMock().state.users.some((u) => u.email === known.email));
      if (canLogin && (!value || dead)) {
        chip.append(el('button', { type: 'button', class: 'chip-btn chip-login', onclick: () => prepareToken(known) },
          `${known.email} でログインして入れる`));
      } else if (canLogin) {
        chip.append(el('button', { type: 'button', class: 'chip-btn', title: `${known.email} でログインし直して入れる`, onclick: () => prepareToken(known) }, '入れ直す'));
      }
      if (value) {
        chip.append(el('button', { type: 'button', class: 'chip-btn', 'aria-label': `${name} を空にする`, title: '空にする', onclick: () => setVar(scope, name, null) }, '×'));
      }
      varsBar.append(chip);
    }
  }

  async function prepareToken(known) {
    const mode = getMode();
    const base = localBase();
    const scope = mode === 'local' ? base : 'browser';
    // 教材のアカウントのパスワード（シーダーと第10章の例）
    const body = JSON.stringify({ email: known.email, password: known.name === 'HANAKO_TOKEN' ? 'secret-pass' : 'password', device_name: 'web-book' });
    try {
      const request = { method: 'POST', url: `${BOOK_ORIGIN}/api/v1/login`, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body };
      const result = await send(resolveTarget(mode, request, base), request);
      const token = JSON.parse(result.body || '{}')?.data?.token;
      if (token) setVar(scope, known.name, token);
      else hint.textContent = `ログインできませんでした（${result.status}）。${JSON.parse(result.body || '{}').message ?? ''}`;
    } catch (error) {
      hint.textContent = connectionHelp(error);
    }
  }

  function connectionHelp(error) {
    return `手元のAPIに接続できませんでした（${error.message}）。Sailが起動しているか、api の .env に BOOK_SITE_URL を設定したかを確かめてください。うまくいかないときは、上の切り替えで「ブラウザー内の模擬API」に戻せます。`;
  }

  // 作成で返ったIDを、このコンソールの続くコマンドに入れる
  function carryForward(fromRun, createdId, output) {
    const later = runners.slice(runners.indexOf(fromRun) + 1).filter((r) => r.textarea);
    const { texts, changed } = carryCreatedId(later.map((r) => r.textarea.value), createdId);
    later.forEach((r, i) => { r.textarea.value = texts[i]; });
    if (changed) {
      output.append(note(`作成したタスクのIDは ${createdId} です。本文のIDは例なので、続く${changed}件のコマンドのIDを ${createdId} に書き換えました。`));
    }
  }

  entries.forEach((entry) => {
    const item = el('li', { class: `cmd cmd-${entry.kind}` });
    if (entry.label) item.append(el('div', { class: 'cmd-label' }, `# ${entry.label}`));
    if (entry.kind === 'other') {
      item.append(el('pre', { class: 'cmd-static' }, `$ ${entry.text}`),
        note('手元の環境で実行するコマンドです。ブラウザーでは実行できません。', 'muted'));
      list.append(item);
      return;
    }
    const textarea = el('textarea', { class: 'cmd-text', spellcheck: 'false', rows: String(entry.text.split('\n').length), 'aria-label': 'コマンド（書き換えて送れます）' });
    textarea.value = entry.text;
    const button = el('button', { type: 'button', class: 'btn btn-run' }, entry.kind === 'assign' ? '変数に入れる' : '送信');
    const output = el('div', { class: 'cmd-output', 'aria-live': 'polite' });
    item.append(el('div', { class: 'cmd-row' }, el('span', { class: 'prompt', 'aria-hidden': 'true' }, '$'), textarea, button), output);
    list.append(item);

    // 結果として { ok, stop } を返す。stop が true なら「すべて順に送る」をそこで止める
    const run = async (confirmation = null) => {
      if (button.disabled) return { ok: false, stop: true };
      const mode = getMode();
      const base = localBase();
      const scope = mode === 'local' ? base : 'browser';
      const vars = varsFor(scope);
      output.replaceChildren();
      button.disabled = true;
      try {
        if (entry.kind === 'assign') {
          const { name, value } = parseAssign(textarea.value.trim(), vars);
          if (/\.\.\.|…/.test(value)) {
            // 「5|xYz...」のような書き換え前提の値は、直前に受け取ったトークンで置き換える
            let token = vars.__last_token;
            let message = `${name} に、直前に受け取ったトークンを入れました。`;
            if (!token && mode === 'browser') {
              const known = KNOWN_VARS.find((v) => v.name === name) ?? KNOWN_VARS[0];
              token = getMock().issueTokenFor(known.email);
              message = `Tinkerで発行する代わりに、模擬APIで ${known.email} のトークンを発行して ${name} に入れました。`;
            }
            if (!token) {
              output.append(note('先にログインのcurlを送るか、この行の値を、受け取ったトークンに書き換えてから送ってください。', 'warn'));
              return { ok: false, stop: true };
            }
            setVar(scope, name, token);
            output.append(note(message));
          } else {
            setVar(scope, name, value);
            output.append(note(`${name} に値を入れました。`));
          }
          return { ok: true };
        }
        const text = textarea.value.trim();
        const { request, target } = prepareRequest(mode, text, vars, base);
        const signature = JSON.stringify([mode, target, request, text]);
        if (confirmation !== null && confirmation !== signature) {
          output.append(note('確認後に内容が変わりました。送り先とコマンドを確かめて、もう一度「送信」を押してください。', 'warn'));
          return { ok: false, stop: true };
        }
        if (target.via === 'local' && request.method === 'DELETE' && confirmation === null) {
          const confirm = el('button', { type: 'button', class: 'btn btn-danger' }, '削除を送る');
          confirm.addEventListener('click', () => run(signature), { once: true });
          output.append(el('div', { class: 'cmd-confirm' },
            note(`手元のAPIの ${target.url} に DELETE を送ります。消えるのはこのURLが指すデータです。確かめてから押してください。`, 'warn'),
            confirm));
          return { ok: false, stop: true };
        }
        if (request.missing.length) {
          output.append(note(`変数 ${request.missing.map((n) => `$${n}`).join('、')} が空のまま送りました。上の「ログインして入れる」で用意できます。`, 'warn'));
        }
        const mailCount = mails.length;
        const result = await send(target, request);
        output.append(renderResponse(result, request));
        let data = null;
        try { data = JSON.parse(result.body || 'null'); } catch { data = null; }
        const usedVars = [...text.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g)].map((m) => m[1]).filter((n) => vars[n]);
        const usedToken = (request.headers.Authorization ?? request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        if (result.status === 204 && /\/logout$/.test(new URL(request.url).pathname) && usedToken) {
          // ログアウトしたトークンは、もう使えないことを変数の欄に示す
          setVar(scope, '__revoked', [...(varsFor(scope).__revoked ?? []), usedToken]);
        }
        if (result.status === 401 && usedVars.length) {
          output.append(note(`${usedVars.map((n) => `$${n}`).join('、')} のトークンは使えません（ログアウト済みか期限切れ）。上の欄の「ログインして入れる」か「入れ直す」で用意し直せます。`, 'warn'));
        }
        // ログインや登録で受け取ったトークンを、変数に入れておく
        const token = data?.data?.token;
        if (token) {
          setVar(scope, '__last_token', token);
          let email = '';
          try { email = JSON.parse(request.body || '{}').email ?? ''; } catch { email = ''; }
          const known = KNOWN_VARS.find((v) => v.email === email && !/agent-tokens/.test(request.url));
          if (known) {
            setVar(scope, known.name, token);
            output.append(note(`受け取ったトークンを $${known.name} に入れました。`));
          } else {
            output.append(note('受け取ったトークンを覚えました。次の TOKEN=... の行を実行すると、変数に入ります。'));
          }
        }
        if (isCreateTask(request)) {
          const createdId = result.status === 201 ? data?.data?.id : null;
          if (!createdId) {
            output.append(note('タスクを作成できなかったので、続くコマンドのIDは書き換えていません。「すべて順に送る」は、ここで止めます。', 'warn'));
            return { ok: false, stop: true };
          }
          carryForward(run, createdId, output);
        }
        for (const mail of mails.slice(mailCount)) {
          setVar(scope, '__last_invite', mail.code);
          output.append(el('div', { class: 'mail-log' },
            el('div', { class: 'mail-head' }, `ログに書き出されたメール（宛先：${mail.to}）`),
            el('pre', {}, `件名：${mail.subject}\n\n${mail.body}`),
            note('次の「招待コード」を含むコマンドを送ると、このコードに置き換えて送ります。', 'muted')));
        }
        if (result.via === 'mock' && result.status >= 400 && ![401, 404, 422].includes(result.status)) {
          output.append(note('開発環境（APP_DEBUG=true）の実際の応答には、exception や trace などの調査用の項目も含まれます。', 'muted'));
        }
        if (result.via === 'internet') {
          output.append(note('ブラウザーから読めるヘッダーだけを表示しています。すべてを見るには、ターミナルの curl を使ってください。', 'muted'));
        }
        return { ok: true };
      } catch (error) {
        output.append(note(error instanceof TypeError ? connectionHelp(error) : error.message, 'error'));
        return { ok: false, stop: true };
      } finally {
        button.disabled = false;
      }
    };
    run.textarea = textarea;
    button.addEventListener('click', () => run());
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
    });
    textarea.addEventListener('input', () => { textarea.rows = Math.max(1, textarea.value.split('\n').length); });
    runners.push(run);
  });

  runAll.addEventListener('click', async () => {
    runAll.disabled = true;
    for (const run of runners) {
      const outcome = await run();
      if (outcome?.stop) break;
    }
    runAll.disabled = false;
  });
  runAll.hidden = runners.length < 2;
  reset.addEventListener('click', () => {
    getMock().reset();
    writeJSON(MOCK_VARS_KEY, {});
    window.dispatchEvent(new CustomEvent('tb-vars-change'));
    hint.textContent = '模擬APIのデータを初期状態に戻し、トークンの変数を空にしました。';
  });

  onModeChange(refreshMode);
  window.addEventListener('tb-vars-change', renderVars);
  refreshMode();
  codeBlock.after(panel);
  return panel;
}
