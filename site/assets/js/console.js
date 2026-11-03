// 本文の curl の例を、その場で送って結果を確かめるコンソール
import { createMockApi } from './taskboard-mock.js';
import { splitCommands, parseCurl, parseAssign } from './curl.js';
import { getMode, setMode, onModeChange, readJSON, writeJSON } from './prefs.js';

const VARS_KEY = 'tb-console-vars';
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

let mock = null;
const mails = [];
function getMock() {
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }
  mock ??= createMockApi({ storage, onMail: (mail) => { mails.push(mail); } });
  return mock;
}

// 変数は、送り先（模擬API／手元のAPI）ごとに分けて覚えておく
function allVars() { return readJSON(VARS_KEY, { browser: {}, local: {} }); }
function varsFor(mode) { return allVars()[mode] ?? {}; }
function setVar(mode, name, value) {
  const all = allVars();
  all[mode] ??= {};
  if (value === null) delete all[mode][name]; else all[mode][name] = value;
  writeJSON(VARS_KEY, all);
  window.dispatchEvent(new CustomEvent('tb-vars-change'));
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

async function send(mode, request) {
  const isLocalApi = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(request.url);
  const started = performance.now();
  if (isLocalApi && mode === 'browser') {
    const r = await getMock().request(request);
    return { ...r, via: 'mock', ms: Math.round(performance.now() - started) };
  }
  const res = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body ?? undefined,
    mode: 'cors',
    credentials: 'omit',
  });
  const body = request.method === 'HEAD' ? '' : await res.text();
  return {
    status: res.status,
    statusText: res.statusText || STATUS_TEXT[res.status] || '',
    headers: [...res.headers.entries()].map(([k, v]) => [k.replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase()), v]),
    body,
    via: isLocalApi ? 'local' : 'internet',
    ms: Math.round(performance.now() - started),
  };
}

function renderResponse(result, request) {
  const box = el('div', { class: 'resp' });
  const family = Math.floor(result.status / 100);
  const where = { mock: 'ブラウザー内の模擬API', local: '手元のAPI', internet: 'インターネット上のAPI' }[result.via];
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

export function mountConsole(codeBlock) {
  const source = codeBlock.querySelector('code').textContent;
  const entries = splitCommands(source);
  if (!entries.some((e) => e.kind === 'curl' || e.kind === 'assign')) return null;

  const panel = el('section', { class: 'console', 'aria-label': 'APIを試すコンソール' });
  const modeButtons = {};
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'リクエストの送り先' },
    ...[['browser', 'ブラウザー内の模擬API'], ['local', '手元のAPI（localhost）']].map(([m, label]) => {
      modeButtons[m] = el('button', { type: 'button', 'data-mode-value': m, onclick: () => setMode(m) }, label);
      return modeButtons[m];
    }));
  const head = el('div', { class: 'console-head' }, el('span', { class: 'console-title' }, 'その場で送ってみる'), seg);
  const varsBar = el('div', { class: 'console-vars' });
  const hint = el('p', { class: 'console-hint' });
  const list = el('ol', { class: 'console-cmds' });
  const runAll = el('button', { type: 'button', class: 'btn btn-quiet' }, 'すべて順に送る');
  const reset = el('button', { type: 'button', class: 'btn btn-link' }, '模擬APIのデータを初期状態に戻す');
  const foot = el('div', { class: 'console-foot' }, runAll, reset);
  panel.append(head, hint, varsBar, list, foot);

  const runners = [];

  function refreshMode() {
    const mode = getMode();
    for (const [m, b] of Object.entries(modeButtons)) b.setAttribute('aria-pressed', String(m === mode));
    hint.textContent = mode === 'browser'
      ? 'localhost への送信は、このページの中で動く模擬API（本書の完成版と同じ動き）が受け取ります。シーダーと同じデータが入っています。'
      : '手元のSailで動かしているAPI（http://localhost）に送ります。api フォルダーの README の「Web版から送る」の設定が必要です。';
    reset.hidden = mode !== 'browser';
    renderVars();
  }

  function renderVars() {
    const mode = getMode();
    const vars = varsFor(mode);
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
        chip.append(el('button', { type: 'button', class: 'chip-btn', 'aria-label': `${name} を空にする`, title: '空にする', onclick: () => setVar(mode, name, null) }, '×'));
      }
      varsBar.append(chip);
    }
  }

  async function prepareToken(known) {
    const mode = getMode();
    const body = JSON.stringify({ email: known.email, password: known.name === 'HANAKO_TOKEN' ? 'secret-pass' : 'password', device_name: 'web-book' });
    try {
      const result = await send(mode, { method: 'POST', url: 'http://localhost/api/v1/login', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body });
      const token = JSON.parse(result.body || '{}')?.data?.token;
      if (token) setVar(mode, known.name, token);
      else hint.textContent = `ログインできませんでした（${result.status}）。${JSON.parse(result.body || '{}').message ?? ''}`;
    } catch (error) {
      hint.textContent = connectionHelp(error);
    }
  }

  function connectionHelp(error) {
    return `手元のAPIに接続できませんでした（${error.message}）。Sailが起動しているか、api の .env に BOOK_SITE_URL を設定したかを確かめてください。うまくいかないときは、上の切り替えで「ブラウザー内の模擬API」に戻せます。`;
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

    const run = async () => {
      const mode = getMode();
      const vars = varsFor(mode);
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
              return;
            }
            setVar(mode, name, token);
            output.append(note(message));
          } else {
            setVar(mode, name, value);
            output.append(note(`${name} に値を入れました。`));
          }
          return;
        }
        let text = textarea.value.trim();
        const invite = vars.__last_invite;
        if (text.includes('招待コード') && invite) {
          text = text.replaceAll('招待コード', invite);
          output.append(note('「招待コード」を、ログに書き出された招待コードに置き換えて送りました。'));
        }
        const request = parseCurl(text, vars);
        if (request.missing.length) {
          output.append(note(`変数 ${request.missing.map((n) => `$${n}`).join('、')} が空のまま送りました。上の「ログインして入れる」で用意できます。`, 'warn'));
        }
        const mailCount = mails.length;
        const result = await send(mode, request);
        output.append(renderResponse(result, request));
        // ログインや登録で受け取ったトークンを、変数に入れておく
        let data = null;
        try { data = JSON.parse(result.body || 'null'); } catch { data = null; }
        const usedVars = [...text.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g)].map((m) => m[1]).filter((n) => vars[n]);
        const usedToken = (request.headers.Authorization ?? request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        if (result.status === 204 && /\/logout$/.test(new URL(request.url).pathname) && usedToken) {
          // ログアウトしたトークンは、もう使えないことを変数の欄に示す
          setVar(mode, '__revoked', [...(varsFor(mode).__revoked ?? []), usedToken]);
        }
        if (result.status === 401 && usedVars.length) {
          output.append(note(`${usedVars.map((n) => `$${n}`).join('、')} のトークンは使えません（ログアウト済みか期限切れ）。上の欄の「ログインして入れる」か「入れ直す」で用意し直せます。`, 'warn'));
        }
        const token = data?.data?.token;
        if (token) {
          setVar(mode, '__last_token', token);
          let email = '';
          try { email = JSON.parse(request.body || '{}').email ?? ''; } catch { email = ''; }
          const known = KNOWN_VARS.find((v) => v.email === email && !/agent-tokens/.test(request.url));
          if (known) {
            setVar(mode, known.name, token);
            output.append(note(`受け取ったトークンを $${known.name} に入れました。`));
          } else {
            output.append(note('受け取ったトークンを覚えました。次の TOKEN=... の行を実行すると、変数に入ります。'));
          }
        }
        // 作成したタスクのIDを、続くコマンドに使えるようにする（本文のIDは例なので、環境ごとに違う）
        const created = result.status === 201 && /\/api\/v1\/(?:teams\/\d+\/)?tasks$/.test(new URL(request.url).pathname) ? data?.data?.id : null;
        if (created) {
          const later = runners.slice(runners.indexOf(run) + 1).map((r) => r.textarea)
            .filter((t) => new RegExp(`/tasks/(?!${created}\\b)\\d+`).test(t.value));
          if (later.length) {
            const fix = el('button', { type: 'button', class: 'btn btn-quiet' }, `続くコマンドのIDを ${created} に書き換える`);
            fix.addEventListener('click', () => {
              for (const t of later) t.value = t.value.replace(/\/tasks\/\d+/g, `/tasks/${created}`);
              fix.disabled = true;
              fix.textContent = `IDを ${created} に書き換えました`;
            });
            output.append(el('div', { class: 'cmd-fix' }, note(`作成したタスクのIDは ${created} です。本文のIDは例なので、続くコマンドのIDをこの値に書き換えられます。`), fix));
          }
        }
        for (const mail of mails.slice(mailCount)) {
          setVar(mode, '__last_invite', mail.code);
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
      } catch (error) {
        output.append(note(error instanceof TypeError ? connectionHelp(error) : error.message, 'error'));
      } finally {
        button.disabled = false;
      }
    };
    run.textarea = textarea;
    button.addEventListener('click', run);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
    });
    textarea.addEventListener('input', () => { textarea.rows = Math.max(1, textarea.value.split('\n').length); });
    runners.push(run);
  });

  runAll.addEventListener('click', async () => {
    runAll.disabled = true;
    for (const run of runners) await run();
    runAll.disabled = false;
  });
  runAll.hidden = runners.length < 2;
  reset.addEventListener('click', () => {
    getMock().reset();
    const all = allVars();
    all.browser = {};
    writeJSON(VARS_KEY, all);
    window.dispatchEvent(new CustomEvent('tb-vars-change'));
    hint.textContent = '模擬APIのデータを初期状態に戻し、トークンの変数を空にしました。';
  });

  onModeChange(refreshMode);
  window.addEventListener('tb-vars-change', renderVars);
  refreshMode();
  codeBlock.after(panel);
  return panel;
}
