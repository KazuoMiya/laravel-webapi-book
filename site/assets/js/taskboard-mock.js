// ブラウザーの中だけで動く、TaskBoard API の模擬サーバー。
// api フォルダーの完成版（第17章まで）と同じ URL、入力検証、ステータスコード、応答の形を再現する。
// データは閲覧している人のブラウザーにだけ保存され、「初期状態に戻す」で作り直せる。

const STORAGE_KEY = 'taskboard-mock-v1';
const ORIGIN = 'http://localhost';
const PRIORITY_KEYS = ['low', 'medium', 'high'];
const ROLES = ['owner', 'admin', 'member', 'viewer'];
const MAX_OPEN_TASKS = 100;

const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
  412: 'Precondition Failed', 422: 'Unprocessable Content', 428: 'Precondition Required',
  429: 'Too Many Requests', 500: 'Internal Server Error',
};

// lang/ja/validation.php の訳。ここにない規則は、Laravelと同じく英語の文に戻る
const MESSAGES_JA = {
  required: ':attributeは必須です。',
  string: ':attributeは文字列で指定してください。',
  boolean: ':attributeはtrueかfalseで指定してください。',
  array: ':attributeは配列で指定してください。',
  email: ':attributeは正しいメールアドレスの形式で指定してください。',
  unique: 'その:attributeはすでに使われています。',
  confirmed: ':attributeが確認用の値と一致しません。',
  distinct: ':attributeに重複した値があります。',
  in: '選択された:attributeは正しくありません。',
  integer: ':attributeは整数で指定してください。',
  date_format: ':attributeは:formatの形式で指定してください。',
  'max.string': ':attributeは:max文字以内で指定してください。',
  'max.array': ':attributeは:max個以内で指定してください。',
  'max.numeric': ':attributeは:max以下で指定してください。',
  'min.string': ':attributeは:min文字以上で指定してください。',
  'between.numeric': ':attributeは:minから:maxの間で指定してください。',
};
const MESSAGES_EN = {
  exists: 'The selected :attribute is invalid.',
  prohibited: 'The :attribute field is prohibited.',
  'min.numeric': 'The :attribute field must be at least :min.',
  'min.array': 'The :attribute field must have at least :min items.',
  'between.string': 'The :attribute field must be between :min and :max characters.',
  'between.array': 'The :attribute field must have between :min and :max items.',
};
const GLOBAL_ATTRIBUTES = { name: '名前', email: 'メールアドレス', password: 'パスワード' };

const TASK_ATTRIBUTES = {
  title: 'タイトル', memo: 'メモ', due_date: '期限', priority: '優先度', is_done: '完了状態',
  tags: 'タグ', 'tags.*': 'タグ', assignee_id: '担当者',
};

const SEED_TITLES = [
  'レポートを書く', '牛乳を買う', '歯医者の予約を取る', '請求書を送る', '会議の資料を作る', '部屋を掃除する',
  'PHPの復習をする', '電気代を払う', '週報を提出する', '本を返却する', '洗剤を買う', 'API仕様を見直す',
  'テストを書く', 'ゴミを出す', '英単語を覚える', '見積もりを確認する', '名刺を注文する', '植物に水をやる',
  '銀行で記帳する', 'ブログの下書きを書く', 'パンを買う', '面談の日程を決める', 'Dockerの勉強をする',
  'カーテンを洗う', '経費を精算する', 'メールに返信する', '卵を買う', 'SQLの練習問題を解く',
  'プリンターのインクを買う', '議事録をまとめる', '旅行の計画を立てる', '靴を修理に出す',
  'エアコンのフィルターを掃除する', '年賀状の住所を確認する', 'ノートパソコンを更新する', '保険の書類を出す',
  'ランニングをする', '図書館で本を借りる', 'お米を買う', 'バックアップを取る',
];
const TEAM_TITLES = [
  '仕様をまとめる', 'ログイン画面を作る', 'APIの設計レビュー', 'テスト環境を用意する', '本番のデータを移す',
  'リリースノートを書く', '監視の設定をする', '性能を測る', '利用規約を確認する', 'ふりかえりを開く',
];
const OTHER_NAMES = ['佐藤 一郎', '鈴木 美咲', '高橋 健', '田中 由美', '伊藤 翔'];

// ---------- 小さな道具 ----------

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  (globalThis.crypto ?? { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function iso(date) {
  // Laravel の toIso8601String() と同じ形（UTC、+00:00）
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

function dateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 86400000);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mbLength(value) {
  return Array.from(String(value)).length;
}

// Laravel の TrimStrings と ConvertEmptyStringsToNull（パスワードは前後の空白を残す）
function normalizeInput(value, key = '') {
  if (typeof value === 'string') {
    const keep = ['password', 'password_confirmation', 'current_password'].includes(key);
    const trimmed = keep ? value : value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (Array.isArray(value)) return value.map((v) => normalizeInput(v));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeInput(v, k)]));
  }
  return value;
}

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

class ValidationError extends Error {
  constructor(errors) {
    super('validation');
    this.errors = errors;
  }
}

// ---------- 入力検証（Laravel の規則のうち、本書で使うもの） ----------

function attributeName(field, attributes) {
  if (attributes[field]) return attributes[field];
  const wildcard = field.replace(/\.\d+(?=\.|$)/g, '.*');
  if (attributes[wildcard]) return attributes[wildcard];
  if (GLOBAL_ATTRIBUTES[field]) return GLOBAL_ATTRIBUTES[field];
  return field.replace(/_/g, ' ');
}

function message(key, field, attributes, replace = {}) {
  const template = MESSAGES_JA[key] ?? MESSAGES_EN[key] ?? `validation.${key}`;
  let text = template.replace(':attribute', attributeName(field, attributes));
  for (const [k, v] of Object.entries(replace)) text = text.replace(`:${k}`, v);
  return text;
}

function isBooleanLike(v) {
  return [true, false, 0, 1, '0', '1'].includes(v);
}

function isIntegerLike(v) {
  if (typeof v === 'number') return Number.isInteger(v);
  return typeof v === 'string' && /^-?\d+$/.test(v);
}

function sizeKind(rules) {
  if (rules.includes('array')) return 'array';
  if (rules.includes('integer') || rules.includes('numeric')) return 'numeric';
  return 'string';
}

function sizeOf(value, kind) {
  if (kind === 'array') return Array.isArray(value) ? value.length : 0;
  if (kind === 'numeric') return Number(value);
  return mbLength(value ?? '');
}

function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && dateOnly(d) === v;
}

function validEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+$/.test(v) && !/\.\./.test(v);
}

function runRules(field, value, present, rules, input, attributes, errors) {
  const add = (key, replace) => {
    (errors[field] ??= []).push(message(key, field, attributes, replace));
  };
  if (rules.includes('prohibited')) {
    const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
    if (present && !empty) add('prohibited');
    return;
  }
  if (rules.includes('sometimes') && !present) return;
  const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  if (rules.includes('required') && empty) { add('required'); return; }
  if (!present) return;
  if (value === null && rules.includes('nullable')) return;
  const kind = sizeKind(rules);
  for (const rule of rules) {
    if (typeof rule === 'function') { const m = rule(value, field); if (m) (errors[field] ??= []).push(m); continue; }
    const [name, arg] = rule.split(/:(.*)/s);
    switch (name) {
      case 'string': if (typeof value !== 'string') add('string'); break;
      case 'boolean': if (!isBooleanLike(value)) add('boolean'); break;
      case 'array': if (!Array.isArray(value)) add('array'); break;
      case 'integer': if (!isIntegerLike(value)) add('integer'); break;
      case 'email': if (!validEmail(value)) add('email'); break;
      case 'date_format': if (!validDate(value)) add('date_format', { format: arg }); break;
      case 'in': if (!arg.split(',').includes(typeof value === 'boolean' ? String(value) : String(value)) || isPlainObject(value) || Array.isArray(value)) add('in'); break;
      case 'max': if (value !== null && sizeOf(value, kind) > Number(arg)) add(`max.${kind}`, { max: arg }); break;
      case 'min': if (value !== null && sizeOf(value, kind) < Number(arg)) add(`min.${kind}`, { min: arg }); break;
      case 'between': {
        const [lo, hi] = arg.split(',').map(Number);
        const size = sizeOf(value, kind);
        if (!(size >= lo && size <= hi)) add(`between.${kind}`, { min: lo, max: hi });
        break;
      }
      case 'confirmed': if (input[`${field}_confirmation`] !== value) add('confirmed'); break;
      default: break;
    }
  }
}

function validate(input, rules, attributes = {}) {
  const errors = {};
  const validated = {};
  for (const [field, fieldRules] of Object.entries(rules)) {
    if (field.endsWith('.*')) continue;
    const present = Object.prototype.hasOwnProperty.call(input, field);
    const value = input[field];
    runRules(field, value, present, fieldRules, input, attributes, errors);
    const wildcardRules = rules[`${field}.*`];
    if (wildcardRules && Array.isArray(value)) {
      value.forEach((item, index) => {
        const itemField = `${field}.${index}`;
        const itemRules = wildcardRules.filter((r) => r !== 'distinct');
        runRules(itemField, item, true, itemRules, input, attributes, errors);
        if (wildcardRules.includes('distinct') && value.filter((v) => v === item).length > 1) {
          (errors[itemField] ??= []).push(message('distinct', itemField, attributes));
        }
      });
    }
    if (present && !errors[field]) validated[field] = value;
  }
  // 項目の並びは規則を書いた順にそろえる（Laravel と同じ）
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return validated;
}

// ---------- 状態 ----------

function seedState(now = new Date()) {
  const rand = mulberry32(20261103);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const created = iso(now);
  const state = {
    seq: { users: 0, tokens: 0, tasks: 0, tags: 0, teams: 0, invitations: 0, activity_logs: 0 },
    users: [], tokens: [], tasks: [], tags: [], tag_task: [], teams: [], team_user: [],
    invitations: [], activity_logs: [], idempotency: {}, rate: {}, seededAt: created,
  };
  const nextId = (table) => ++state.seq[table];
  const addUser = (name, email) => {
    const user = { id: nextId('users'), name, email, password: 'password', created_at: created, updated_at: created };
    state.users.push(user);
    return user;
  };
  const addTask = (attrs) => {
    const offsets = [-6, -3, -1, 0, 1, 2, 4, 7, 10, 14, 21, 28];   // 期限切れから1か月先まで
    const due = rand() < 0.6 ? dateOnly(addDays(now, offsets[Math.floor(rand() * offsets.length)])) : null;
    const task = {
      id: nextId('tasks'), user_id: attrs.user_id, team_id: attrs.team_id ?? null, assignee_id: attrs.assignee_id ?? null,
      title: attrs.title, memo: rand() < 0.4 ? 'シーダーで作ったメモです。' : null, due_date: due,
      priority: 1 + Math.floor(rand() * 3), is_done: attrs.is_done ?? false, version: 1,
      created_at: iso(addDays(now, -(60 - state.seq.tasks) / 24)), updated_at: created,
    };
    task.updated_at = task.created_at;
    state.tasks.push(task);
    state.activity_logs.push({
      id: nextId('activity_logs'), team_id: task.team_id, user_id: null, token_id: null, request_id: null,
      via: 'system', action: 'task.created', subject_type: 'App\\Models\\Task', subject_id: task.id,
      changes: { title: task.title, priority: task.priority, is_done: task.is_done }, created_at: task.created_at,
    });
    return task;
  };

  // DatabaseSeeder と同じ順番でデータを作る
  const test = addUser('テストユーザー', 'test@example.com');
  const tags = ['仕事', '買い物', '家', '勉強'].map((name) => {
    const tag = { id: nextId('tags'), user_id: test.id, name, created_at: created, updated_at: created };
    state.tags.push(tag);
    return tag;
  });
  for (let i = 0; i < 30; i++) {
    const task = addTask({ user_id: test.id, title: SEED_TITLES[i] });
    const count = Math.floor(rand() * 3);
    const chosen = [...tags].sort(() => rand() - 0.5).slice(0, count);
    for (const tag of chosen) state.tag_task.push([task.id, tag.id]);
  }
  for (let i = 0; i < 10; i++) addTask({ user_id: test.id, title: SEED_TITLES[30 + i], is_done: true });
  for (let i = 0; i < 5; i++) {
    const other = addUser(OTHER_NAMES[i], `user${i + 2}@example.net`);
    addTask({ user_id: other.id, title: pick(SEED_TITLES) });
  }
  const mate = addUser('チームメイト', 'mate@example.com');
  const team = { id: nextId('teams'), owner_id: test.id, name: '開発チーム', created_at: created, updated_at: created };
  state.teams.push(team);
  state.team_user.push({ team_id: team.id, user_id: test.id, role: 'owner', created_at: created });
  state.team_user.push({ team_id: team.id, user_id: mate.id, role: 'member', created_at: created });
  for (let i = 0; i < 10; i++) addTask({ user_id: test.id, team_id: team.id, assignee_id: mate.id, title: TEAM_TITLES[i] });
  return state;
}

// ---------- 応答の形（API リソース） ----------

function userResource(user) {
  return { id: user.id, name: user.name, email: user.email, created_at: user.created_at };
}

// ---------- 模擬サーバー本体 ----------

export function createMockApi({ storage = null, onMail = () => {}, onLog = () => {} } = {}) {
  let state = load();

  function load() {
    try {
      const saved = storage?.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* 保存できない環境では、毎回初期状態から始める */ }
    return seedState();
  }

  function save() {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 保存できなくても動かす */ }
  }

  function reset() {
    state = seedState();
    save();
  }

  const nextId = (table) => ++state.seq[table];
  const findUser = (id) => state.users.find((u) => u.id === Number(id));
  const findTeam = (id) => state.teams.find((t) => t.id === Number(id));
  const roleOf = (team, user) => state.team_user.find((m) => m.team_id === team.id && m.user_id === user.id)?.role ?? null;
  const tagsOf = (task) => state.tag_task.filter(([taskId]) => taskId === task.id)
    .map(([, tagId]) => state.tags.find((t) => t.id === tagId)).filter(Boolean)
    .sort((a, b) => a.id - b.id);

  function taskResource(task) {
    const assignee = task.assignee_id ? findUser(task.assignee_id) : null;
    return {
      id: task.id,
      title: task.title,
      memo: task.memo,
      due_date: task.due_date,
      priority: PRIORITY_KEYS[task.priority - 1],
      is_done: task.is_done,
      tags: tagsOf(task).map((t) => ({ id: t.id, name: t.name })),
      team_id: task.team_id,
      assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
      version: task.version,
      created_at: task.created_at,
      updated_at: task.updated_at,
    };
  }

  function teamResource(team, user) {
    return { id: team.id, name: team.name, my_role: roleOf(team, user), created_at: team.created_at };
  }

  function record(task, action, changes, ctx) {
    state.activity_logs.push({
      id: nextId('activity_logs'), team_id: task.team_id, user_id: ctx.user?.id ?? null,
      token_id: ctx.token?.id ?? null, request_id: ctx.requestId,
      via: ctx.user ? (ctx.isAgent ? 'agent' : 'api') : 'system',
      action, subject_type: 'App\\Models\\Task', subject_id: task.id, changes, created_at: iso(new Date()),
    });
  }

  // ---------- 認証と回数制限 ----------

  function authenticate(ctx) {
    const header = ctx.headers.authorization ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new HttpError(401, 'Unauthenticated.');
    const [id, plain] = match[1].trim().split('|');
    const token = state.tokens.find((t) => String(t.id) === id && t.token === plain);
    if (!token || (token.expires_at && new Date(token.expires_at) <= new Date())) {
      throw new HttpError(401, 'Unauthenticated.');
    }
    const user = findUser(token.tokenable_id);
    if (!user) throw new HttpError(401, 'Unauthenticated.');
    token.last_used_at = iso(new Date());
    ctx.user = user;
    ctx.token = token;
    ctx.isAgent = token.abilities.includes('agent') && !token.abilities.includes('*');
  }

  function tokenCan(ctx, ability) {
    return ctx.token.abilities.includes('*') || ctx.token.abilities.includes(ability);
  }

  function throttle(ctx, name, limit, key) {
    const bucket = `${name}|${key}`;
    const now = Date.now();
    const hits = (state.rate[bucket] ?? []).filter((t) => now - t < 60000);
    if (hits.length >= limit) {
      const retryAfter = Math.max(1, Math.ceil((hits[0] + 60000 - now) / 1000));
      state.rate[bucket] = hits;
      throw new HttpError(429, 'Too Many Attempts.', {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(now / 1000) + retryAfter),
      });
    }
    hits.push(now);
    state.rate[bucket] = hits;
    ctx.rateHeaders = { 'X-RateLimit-Limit': String(limit), 'X-RateLimit-Remaining': String(limit - hits.length) };
  }

  // ---------- 一覧の絞り込みと並べ替え（Task::filterForList） ----------

  const INDEX_RULES = {
    is_done: ['sometimes', 'in:true,false,1,0'],
    priority: ['sometimes', `in:${PRIORITY_KEYS.join(',')}`],
    tag: ['sometimes', 'string', 'max:50'],
    q: ['sometimes', 'string', 'max:100'],
    due_before: ['sometimes', 'date_format:Y-m-d'],
    sort: ['sometimes', 'in:due_date,-due_date,priority,-priority,created_at,-created_at'],
    page: ['sometimes', 'integer', 'min:1'],
    per_page: ['sometimes', 'integer', 'between:1,100'],
  };

  function filterForList(tasks, filters) {
    let list = tasks;
    if (filters.is_done !== undefined) {
      const done = ['true', '1'].includes(String(filters.is_done));
      list = list.filter((t) => t.is_done === done);
    }
    if (filters.priority !== undefined) {
      const p = PRIORITY_KEYS.indexOf(filters.priority) + 1;
      list = list.filter((t) => t.priority === p);
    }
    if (filters.tag !== undefined) list = list.filter((t) => tagsOf(t).some((tag) => tag.name === filters.tag));
    if (filters.q !== undefined) {
      list = list.filter((t) => t.title.includes(filters.q) || (t.memo ?? '').includes(filters.q));
    }
    if (filters.due_before !== undefined) list = list.filter((t) => t.due_date !== null && t.due_date <= filters.due_before);
    const sort = filters.sort ?? '-created_at';
    const dir = sort.startsWith('-') ? -1 : 1;
    const column = sort.replace(/^-/, '');
    // MySQL と同じく、昇順では null が先、降順では null が後
    const cmp = (a, b) => {
      const va = a[column]; const vb = b[column];
      if (va === vb) return (a.id - b.id) * dir;
      if (va === null) return -1 * dir;
      if (vb === null) return 1 * dir;
      return (va < vb ? -1 : 1) * dir;
    };
    return [...list].sort(cmp);
  }

  function paginate(ctx, items, perPage, resource) {
    const page = Math.max(1, Number(ctx.query.page ?? 1));
    const total = items.length;
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    const slice = items.slice((page - 1) * perPage, page * perPage);
    const path = `${ORIGIN}${ctx.path}`;
    const others = ctx.rawQuery.filter(([k]) => k !== 'page');
    const url = (p) => {
      const params = new URLSearchParams(others);
      params.set('page', String(p));
      return `${path}?${params.toString()}`;
    };
    const links = [{ url: page > 1 ? url(page - 1) : null, label: '&laquo; Previous', page: page > 1 ? page - 1 : null, active: false }];
    const pages = [];
    if (lastPage <= 13) {
      for (let p = 1; p <= lastPage; p++) pages.push(p);
    } else {
      const window = new Set([1, 2, lastPage - 1, lastPage]);
      for (let p = page - 3; p <= page + 3; p++) if (p >= 1 && p <= lastPage) window.add(p);
      const sorted = [...window].sort((a, b) => a - b);
      sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) pages.push('...'); pages.push(p); });
    }
    for (const p of pages) {
      links.push(p === '...' ? { url: null, label: '...', active: false } : { url: url(p), label: String(p), page: p, active: p === page });
    }
    links.push({ url: page < lastPage ? url(page + 1) : null, label: 'Next &raquo;', page: page < lastPage ? page + 1 : null, active: false });
    const from = slice.length ? (page - 1) * perPage + 1 : null;
    return {
      data: slice.map(resource),
      links: { first: url(1), last: url(lastPage), prev: page > 1 ? url(page - 1) : null, next: page < lastPage ? url(page + 1) : null },
      meta: { current_page: page, from, last_page: lastPage, links, path, per_page: perPage, to: from ? from + slice.length - 1 : null, total },
    };
  }

  // ---------- タスク ----------

  function taskAttributes(validated) {
    const attrs = {};
    for (const key of ['title', 'memo', 'due_date', 'priority', 'is_done', 'assignee_id']) {
      if (!(key in validated)) continue;
      let value = validated[key];
      if (key === 'priority') value = PRIORITY_KEYS.indexOf(value) + 1;
      if (key === 'is_done') value = [true, 1, '1'].includes(value);
      if (key === 'assignee_id' && value !== null) value = Number(value);
      attrs[key] = value;
    }
    return attrs;
  }

  function storeRules() {
    return {
      title: ['required', 'string', 'max:100'],
      memo: ['nullable', 'string', 'max:2000'],
      due_date: ['nullable', 'date_format:Y-m-d'],
      priority: ['sometimes', `in:${PRIORITY_KEYS.join(',')}`],
      is_done: ['sometimes', 'boolean'],
      tags: ['sometimes', 'array', 'max:10'],
      'tags.*': ['string', 'distinct', 'max:50'],
    };
  }

  function teamMemberRule(teamId) {
    return (value) => (state.team_user.some((m) => m.team_id === teamId && m.user_id === Number(value))
      ? null : message('exists', 'assignee_id', TASK_ATTRIBUTES));
  }

  function syncTags(user, task, names) {
    const ids = [];
    for (const raw of names) {
      const name = String(raw).trim();
      if (!name) continue;
      let tag = state.tags.find((t) => t.user_id === user.id && t.name === name);
      if (!tag) {
        tag = { id: nextId('tags'), user_id: user.id, name, created_at: iso(new Date()), updated_at: iso(new Date()) };
        state.tags.push(tag);
      }
      if (!ids.includes(tag.id)) ids.push(tag.id);
    }
    state.tag_task = state.tag_task.filter(([taskId]) => taskId !== task.id);
    for (const id of ids) state.tag_task.push([task.id, id]);
  }

  // TaskPolicy
  function authorizeTask(ctx, task, ability) {
    if (task.team_id === null) {
      if (task.user_id !== ctx.user.id) throw new HttpError(404, 'リソースが見つかりません。');
      return;
    }
    const team = findTeam(task.team_id);
    const role = team ? roleOf(team, ctx.user) : null;
    if (!role) throw new HttpError(404, 'リソースが見つかりません。');
    if (ability === 'view') return;
    const isMine = task.user_id === ctx.user.id || task.assignee_id === ctx.user.id;
    const allowed = ['owner', 'admin'].includes(role) || (role === 'member' && isMine);
    if (!allowed) throw new HttpError(403, 'このタスクを変更する権限がありません。');
  }

  // TeamPolicy
  function authorizeTeam(ctx, team, ability) {
    const role = roleOf(team, ctx.user);
    if (!role) throw new HttpError(404, 'リソースが見つかりません。');
    const manage = ['owner', 'admin'].includes(role);
    if (ability === 'update' && !manage) throw new HttpError(403, 'チームを変更する権限がありません。');
    if (ability === 'manageMembers' && !manage) throw new HttpError(403, 'チームを変更する権限がありません。');
    if (ability === 'delete' && role !== 'owner') throw new HttpError(403, 'チームを削除できるのはオーナーだけです。');
    if (ability === 'createTask' && !['owner', 'admin', 'member'].includes(role)) {
      throw new HttpError(403, '閲覧専用の役割ではタスクを作成できません。');
    }
    return role;
  }

  function bindTask(id) {
    const task = /^\d+$/.test(id) ? state.tasks.find((t) => t.id === Number(id)) : null;
    if (!task) throw new HttpError(404, 'リソースが見つかりません。');
    return task;
  }

  function bindTeam(id) {
    const team = /^\d+$/.test(id) ? findTeam(id) : null;
    if (!team) throw new HttpError(404, 'リソースが見つかりません。');
    return team;
  }

  function bindUser(id) {
    const user = /^\d+$/.test(id) ? findUser(id) : null;
    if (!user) throw new HttpError(404, 'リソースが見つかりません。');
    return user;
  }

  const etagFor = (task) => `"v${task.version}"`;

  function createTask(ctx, attrs, teamId, tagNames) {
    const now = iso(new Date());
    const task = {
      id: nextId('tasks'), user_id: ctx.user.id, team_id: teamId, assignee_id: attrs.assignee_id ?? null,
      title: attrs.title, memo: attrs.memo ?? null, due_date: attrs.due_date ?? null,
      priority: attrs.priority ?? 2, is_done: attrs.is_done ?? false, version: 1, created_at: now, updated_at: now,
    };
    state.tasks.push(task);
    record(task, 'task.created', { title: task.title, priority: task.priority, is_done: task.is_done }, ctx);
    if (tagNames) syncTags(ctx.user, task, tagNames);
    return task;
  }

  // ---------- ルート ----------

  const routes = [];
  const route = (method, pattern, options, handler) => {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, pattern, regex, keys, ...options, handler });
  };
  const AUTH = { auth: true, throttle: 'api' };

  // 第4章のAPI（第8章で削除するが、試せるように残しておく）
  route('GET', '/api/hello', {}, () => ({ status: 200, json: { message: 'Hello, API' } }));
  route('GET', '/api/hello/{name}', {}, (ctx) => ({ status: 200, json: { message: `Hello, ${ctx.params.name}` } }));
  route('GET', '/api/v1/hello', {}, (ctx) => ({ status: 200, json: { message: `Hello, ${ctx.query.name ?? 'World'}` } }));
  route('POST', '/api/v1/hello', {}, (ctx) => ({ status: 201, json: { message: `${ctx.input.name ?? ''}さんを登録しました` } }));

  // 認証（第10章）
  route('POST', '/api/v1/register', { throttle: 'api', login: true }, (ctx) => {
    const v = validate(ctx.input, {
      name: ['required', 'string', 'max:50'],
      email: ['required', 'string', 'email', 'max:255', (value) => (
        state.users.some((u) => u.email === value) ? message('unique', 'email', {}) : null)],
      password: ['required', 'confirmed', (value) => (typeof value === 'string' && mbLength(value) >= 8 ? null : message('min.string', 'password', {}, { min: 8 }))],
      device_name: ['sometimes', 'string', 'max:255'],
    });
    const now = iso(new Date());
    const user = { id: nextId('users'), name: v.name, email: v.email, password: v.password, created_at: now, updated_at: now };
    state.users.push(user);
    return { status: 201, json: { data: { user: userResource(user), token: issueToken(user, v.device_name ?? 'api', ['*'], 30) } } };
  });

  route('POST', '/api/v1/login', { throttle: 'api', login: true }, (ctx) => {
    const v = validate(ctx.input, {
      email: ['required', 'string', 'email'],
      password: ['required', 'string'],
      device_name: ['required', 'string', 'max:255'],
    });
    const user = state.users.find((u) => u.email === v.email);
    if (!user || user.password !== v.password) {
      throw new ValidationError({ email: ['メールアドレスまたはパスワードが正しくありません。'] });
    }
    return { status: 200, json: { data: { user: userResource(user), token: issueToken(user, v.device_name, ['*'], 30) } } };
  });

  function issueToken(user, name, abilities, days) {
    const now = new Date();
    const token = {
      id: nextId('tokens'), tokenable_id: user.id, name, token: randomString(40), abilities,
      expires_at: iso(addDays(now, days)), last_used_at: null, created_at: iso(now),
    };
    state.tokens.push(token);
    return `${token.id}|${token.token}`;
  }

  route('POST', '/api/v1/logout', AUTH, (ctx) => {
    state.tokens = state.tokens.filter((t) => t.id !== ctx.token.id);
    return { status: 204 };
  });
  route('GET', '/api/v1/me', AUTH, (ctx) => ({ status: 200, json: { data: userResource(ctx.user) } }));

  // タスク（第8章〜第14章、第16章）
  route('GET', '/api/v1/tasks/summary', AUTH, (ctx) => {
    const today = dateOnly(new Date());   // アプリの標準のタイムゾーン（UTC）での「今日」
    const open = state.tasks.filter((t) => t.user_id === ctx.user.id && t.team_id === null && !t.is_done);
    return {
      status: 200,
      json: { data: {
        open: open.length,
        overdue: open.filter((t) => t.due_date !== null && t.due_date < today).length,
        due_today: open.filter((t) => t.due_date === today).length,
      } },
    };
  });

  route('GET', '/api/v1/tasks', AUTH, (ctx) => {
    const v = validate(ctx.query, INDEX_RULES);
    const mine = state.tasks.filter((t) => t.user_id === ctx.user.id && t.team_id === null);
    return { status: 200, json: paginate(ctx, filterForList(mine, v), Number(v.per_page ?? 15), taskResource) };
  });

  route('POST', '/api/v1/tasks', { ...AUTH, idempotent: true }, (ctx) => {
    const v = validate(ctx.input, storeRules(), TASK_ATTRIBUTES);
    const openCount = state.tasks.filter((t) => t.user_id === ctx.user.id && t.team_id === null && !t.is_done).length;
    const isDone = [true, 1, '1'].includes(ctx.input.is_done);
    if (!isDone && openCount >= MAX_OPEN_TASKS) {
      throw new HttpError(422, `未完了のタスクは${MAX_OPEN_TASKS}件までです。`);
    }
    const task = createTask(ctx, taskAttributes(v), null, 'tags' in v ? v.tags : null);
    return { status: 201, json: { data: taskResource(task) }, headers: { Location: `${ORIGIN}/api/v1/tasks/${task.id}` } };
  });

  route('GET', '/api/v1/tasks/{task}', AUTH, (ctx) => {
    const task = bindTask(ctx.params.task);
    authorizeTask(ctx, task, 'view');
    return { status: 200, json: { data: taskResource(task) }, headers: { ETag: etagFor(task) } };
  });

  route('PATCH', '/api/v1/tasks/{task}', AUTH, (ctx) => {
    const task = bindTask(ctx.params.task);
    authorizeTask(ctx, task, 'update');   // UpdateTaskRequest::authorize（入力検証より先）
    const rules = storeRules();
    rules.title = ['sometimes', 'required', 'string', 'max:100'];
    rules.memo = ['sometimes', 'nullable', 'string', 'max:2000'];
    rules.due_date = ['sometimes', 'nullable', 'date_format:Y-m-d'];
    if (task.team_id === null) {
      rules.assignee_id = ['prohibited'];
    } else {
      delete rules['tags.*'];
      rules.tags = ['prohibited'];
      rules.assignee_id = ['sometimes', 'nullable', 'integer', teamMemberRule(task.team_id)];
    }
    const v = validate(ctx.input, rules, TASK_ATTRIBUTES);
    const ifMatch = ctx.headers['if-match'] ?? null;
    if (task.team_id !== null && ifMatch === null) {
      throw new HttpError(428, 'If-Match ヘッダーに、取得したときの ETag を指定してください。');
    }
    if (ifMatch !== null && ifMatch !== etagFor(task)) {
      throw new HttpError(412, '他の人がこのタスクを更新しました。最新の内容を取得してからやり直してください。');
    }
    const attrs = taskAttributes(v);
    const changes = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (task[key] !== value) changes[key] = value;
    }
    const now = iso(new Date());
    if (Object.keys(changes).length) {
      Object.assign(task, changes, { version: task.version + 1, updated_at: now });
      record(task, 'task.updated', changes, ctx);
    }
    if ('tags' in v) {
      syncTags(ctx.user, task, v.tags);
      if (!Object.keys(changes).length) {
        // タグだけを変えた場合も版を進める（touch）
        Object.assign(task, { version: task.version + 1, updated_at: now });
        record(task, 'task.updated', {}, ctx);
      }
    }
    return { status: 200, json: { data: taskResource(task) }, headers: { ETag: etagFor(task) } };
  });

  route('DELETE', '/api/v1/tasks/{task}', AUTH, (ctx) => {
    const task = bindTask(ctx.params.task);
    authorizeTask(ctx, task, 'delete');
    state.tasks = state.tasks.filter((t) => t.id !== task.id);
    state.tag_task = state.tag_task.filter(([taskId]) => taskId !== task.id);
    record(task, 'task.deleted', { title: task.title }, ctx);
    return { status: 204 };
  });

  route('GET', '/api/v1/tags', AUTH, (ctx) => ({
    status: 200,
    json: { data: state.tags.filter((t) => t.user_id === ctx.user.id).sort((a, b) => (a.name < b.name ? -1 : 1)).map((t) => ({ id: t.id, name: t.name })) },
  }));

  // チーム（第11章）
  route('GET', '/api/v1/teams', AUTH, (ctx) => ({
    status: 200,
    json: { data: state.teams.filter((t) => roleOf(t, ctx.user)).sort((a, b) => (a.name < b.name ? -1 : 1)).map((t) => teamResource(t, ctx.user)) },
  }));

  route('POST', '/api/v1/teams', AUTH, (ctx) => {
    const v = validate(ctx.input, { name: ['required', 'string', 'max:50'] });
    const now = iso(new Date());
    const team = { id: nextId('teams'), owner_id: ctx.user.id, name: v.name, created_at: now, updated_at: now };
    state.teams.push(team);
    state.team_user.push({ team_id: team.id, user_id: ctx.user.id, role: 'owner', created_at: now });
    return { status: 201, json: { data: teamResource(team, ctx.user) }, headers: { Location: `${ORIGIN}/api/v1/teams/${team.id}` } };
  });

  route('GET', '/api/v1/teams/{team}', AUTH, (ctx) => {
    const team = bindTeam(ctx.params.team);
    authorizeTeam(ctx, team, 'view');
    return { status: 200, json: { data: teamResource(team, ctx.user) } };
  });

  const updateTeam = (ctx) => {
    const team = bindTeam(ctx.params.team);
    authorizeTeam(ctx, team, 'update');
    const v = validate(ctx.input, { name: ['required', 'string', 'max:50'] });
    team.name = v.name;
    team.updated_at = iso(new Date());
    return { status: 200, json: { data: teamResource(team, ctx.user) } };
  };
  route('PUT', '/api/v1/teams/{team}', AUTH, updateTeam);
  route('PATCH', '/api/v1/teams/{team}', AUTH, updateTeam);

  route('DELETE', '/api/v1/teams/{team}', AUTH, (ctx) => {
    const team = bindTeam(ctx.params.team);
    authorizeTeam(ctx, team, 'delete');
    // 外部キーの設定で、チームのタスク、所属、招待も消える（監査ログは残る）
    const taskIds = state.tasks.filter((t) => t.team_id === team.id).map((t) => t.id);
    state.tasks = state.tasks.filter((t) => t.team_id !== team.id);
    state.tag_task = state.tag_task.filter(([taskId]) => !taskIds.includes(taskId));
    state.team_user = state.team_user.filter((m) => m.team_id !== team.id);
    state.invitations = state.invitations.filter((i) => i.team_id !== team.id);
    state.teams = state.teams.filter((t) => t.id !== team.id);
    return { status: 204 };
  });

  route('GET', '/api/v1/teams/{team}/members', AUTH, (ctx) => {
    const team = bindTeam(ctx.params.team);
    authorizeTeam(ctx, team, 'view');
    const members = state.team_user.filter((m) => m.team_id === team.id)
      .map((m) => ({ m, u: findUser(m.user_id) })).filter(({ u }) => u)
      .sort((a, b) => (a.u.name < b.u.name ? -1 : 1))
      .map(({ m, u }) => ({ id: u.id, name: u.name, email: u.email, role: m.role, joined_at: m.created_at }));
    return { status: 200, json: { data: members } };
  });

  route('PATCH', '/api/v1/teams/{team}/members/{user}', AUTH, (ctx) => {
    const team = bindTeam(ctx.params.team);
    const target = bindUser(ctx.params.user);
    authorizeTeam(ctx, team, 'manageMembers');
    const v = validate(ctx.input, { role: ['required', 'in:admin,member,viewer'] });
    const membership = state.team_user.find((m) => m.team_id === team.id && m.user_id === target.id);
    if (!membership) throw new HttpError(404, 'リソースが見つかりません。');
    if (membership.role === 'owner') throw new HttpError(422, 'オーナーの役割は変更できません。');
    membership.role = v.role;
    return { status: 200, json: { data: { id: target.id, name: target.name, email: target.email, role: membership.role, joined_at: membership.created_at } } };
  });

  route('DELETE', '/api/v1/teams/{team}/members/{user}', AUTH, (ctx) => {
    const team = bindTeam(ctx.params.team);
    const target = bindUser(ctx.params.user);
    authorizeTeam(ctx, team, target.id === ctx.user.id ? 'view' : 'manageMembers');
    if (roleOf(team, target) === 'owner') throw new HttpError(422, 'オーナーはチームから外せません。');
    state.team_user = state.team_user.filter((m) => !(m.team_id === team.id && m.user_id === target.id));
    return { status: 204 };
  });

  route('POST', '/api/v1/teams/{team}/invitations', AUTH, (ctx) => {
    const team = bindTeam(ctx.params.team);
    authorizeTeam(ctx, team, 'manageMembers');
    const v = validate(ctx.input, {
      email: ['required', 'string', 'email', 'max:255'],
      role: ['required', 'in:admin,member,viewer'],
    });
    const plain = randomString(40);
    const invitation = {
      id: nextId('invitations'), team_id: team.id, invited_by: ctx.user.id, email: v.email.toLowerCase(),
      role: v.role, token: plain, expires_at: iso(addDays(new Date(), 7)), accepted_at: null, created_at: iso(new Date()),
    };
    state.invitations.push(invitation);
    // 開発環境ではメールは送られず、ログに書き出される（MAIL_MAILER=log）
    onMail({
      to: invitation.email,
      subject: 'TaskBoardのチームへの招待',
      body: `「${team.name}」に招待されました。\nアプリで次の招待コードを入力してください（7日間有効）。\n\n${plain}`,
      code: plain,
    });
    return { status: 201, json: { data: { id: invitation.id, email: invitation.email, role: invitation.role, expires_at: invitation.expires_at } } };
  });

  route('POST', '/api/v1/invitations/{token}/accept', AUTH, (ctx) => {
    const invitation = state.invitations.find((i) => i.token === ctx.params.token && !i.accepted_at && new Date(i.expires_at) > new Date());
    if (!invitation || invitation.email !== ctx.user.email.toLowerCase()) throw new HttpError(404, 'リソースが見つかりません。');
    const team = findTeam(invitation.team_id);
    if (!team) throw new HttpError(404, 'リソースが見つかりません。');
    if (roleOf(team, ctx.user)) throw new HttpError(409, 'すでにこのチームのメンバーです。');
    state.team_user.push({ team_id: team.id, user_id: ctx.user.id, role: invitation.role, created_at: iso(new Date()) });
    invitation.accepted_at = iso(new Date());
    return { status: 200, json: { data: teamResource(team, ctx.user) } };
  });

  route('GET', '/api/v1/teams/{team}/tasks', AUTH, (ctx) => {
    const team = bindTeam(ctx.params.team);
    authorizeTeam(ctx, team, 'view');   // IndexTeamTaskRequest::authorize（入力検証より先）
    const v = validate(ctx.query, INDEX_RULES);
    const tasks = state.tasks.filter((t) => t.team_id === team.id);
    return { status: 200, json: paginate(ctx, filterForList(tasks, v), Number(v.per_page ?? 15), taskResource) };
  });

  route('POST', '/api/v1/teams/{team}/tasks', AUTH, (ctx) => {
    const team = bindTeam(ctx.params.team);
    authorizeTeam(ctx, team, 'createTask');
    const rules = storeRules();
    delete rules['tags.*'];
    rules.tags = ['prohibited'];
    rules.assignee_id = ['sometimes', 'nullable', 'integer', teamMemberRule(team.id)];
    const v = validate(ctx.input, rules, TASK_ATTRIBUTES);
    const task = createTask(ctx, taskAttributes(v), team.id, null);
    return { status: 201, json: { data: taskResource(task) }, headers: { Location: `${ORIGIN}/api/v1/tasks/${task.id}` } };
  });

  // エージェント用のトークン（第16章）
  route('POST', '/api/v1/agent-tokens', AUTH, (ctx) => {
    const v = validate(ctx.input, {
      name: ['required', 'string', 'max:100'],
      abilities: ['required', 'array', 'min:1'],
      'abilities.*': ['in:tasks:read,tasks:write'],
    });
    const abilities = ['agent', ...v.abilities];
    const plain = issueToken(ctx.user, `agent: ${v.name}`, abilities, 7);
    const token = state.tokens[state.tokens.length - 1];
    return { status: 201, json: { data: { token: plain, abilities, expires_at: token.expires_at } } };
  });

  // 監査ログ（第17章）
  route('GET', '/api/v1/teams/{team}/activities', AUTH, (ctx) => {
    const team = bindTeam(ctx.params.team);
    authorizeTeam(ctx, team, 'update');
    const logs = state.activity_logs.filter((l) => l.team_id === team.id).sort((a, b) => b.id - a.id);
    return {
      status: 200,
      json: paginate(ctx, logs, 50, (l) => {
        const user = l.user_id ? findUser(l.user_id) : null;
        return { id: l.id, user: user ? { id: user.id, name: user.name } : null, via: l.via, action: l.action, subject_id: l.subject_id, changes: l.changes, created_at: l.created_at };
      }),
    };
  });

  // ---------- リクエストの処理 ----------

  function parseBody(headers, body) {
    if (!body) return {};
    const type = (headers['content-type'] ?? '').toLowerCase();
    if (type.includes('json')) {
      try {
        const parsed = JSON.parse(body);
        return isPlainObject(parsed) ? parsed : {};
      } catch {
        throw new HttpError(400, 'リクエストのJSONの形式が正しくありません。');
      }
    }
    // Content-Type がなければ、curl はフォームの形式（application/x-www-form-urlencoded）で送る
    const form = {};
    for (const [k, v] of new URLSearchParams(body)) form[k] = v;
    return form;
  }

  function respond(ctx, status, json, headers = {}) {
    const out = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': ctx.requestId,
      ...(ctx.rateHeaders ?? {}),
      ...headers,
    };
    if (status === 204) delete out['Content-Type'];
    return {
      status,
      statusText: STATUS_TEXT[status] ?? '',
      headers: Object.entries(out),
      body: status === 204 ? '' : JSON.stringify(json),
    };
  }

  async function request({ method = 'GET', url, headers = {}, body = '' }) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const parsed = new URL(url, ORIGIN);
    const ctx = {
      method: method.toUpperCase(), path: decodeURIComponent(parsed.pathname).replace(/\/+$/, '') || '/',
      headers: lower, requestId: lower['x-request-id'] || uuid(), query: {}, input: {}, params: {},
      rawQuery: [...parsed.searchParams],
    };
    for (const [k, v] of parsed.searchParams) ctx.query[k] = v;
    ctx.query = normalizeInput(ctx.query);

    if (!ctx.path.startsWith('/api/')) {
      if (ctx.path === '/up' && ctx.method === 'GET') {
        return { status: 200, statusText: 'OK', headers: [['Content-Type', 'text/html; charset=utf-8']], body: '<!DOCTYPE html><title>TaskBoard</title><p>Application up</p>' };
      }
      return respond(ctx, 404, { message: 'リソースが見つかりません。' });
    }

    const candidates = routes.filter((r) => r.regex.test(ctx.path));
    try {
      if (!candidates.length) throw new HttpError(404, 'リソースが見つかりません。');
      const found = candidates.find((r) => r.method === ctx.method || (ctx.method === 'HEAD' && r.method === 'GET'));
      if (!found) {
        const allowed = [...new Set(candidates.flatMap((r) => (r.method === 'GET' ? ['GET', 'HEAD'] : [r.method])))];
        throw new HttpError(405, `The ${ctx.method} method is not supported for route ${ctx.path.slice(1)}. Supported methods: ${allowed.join(', ')}.`);
      }
      const match = ctx.path.match(found.regex);
      found.keys.forEach((k, i) => { ctx.params[k] = match[i + 1]; });

      // ForceJsonResponse（壊れたJSONは400）は、認証より先に動く
      ctx.input = normalizeInput(parseBody(lower, body));
      // ミドルウェアの優先順位により、認証 → 回数制限 → エージェント用トークンの拒否 の順に動く
      if (found.auth) authenticate(ctx);
      if (found.throttle) {
        // ログイン中はユーザーごと、未ログインはIPアドレス（ここでは「このブラウザー」）ごと
        throttle(ctx, 'api', 60, ctx.user ? `user:${ctx.user.id}` : 'ip:127.0.0.1');
      }
      if (found.login) {
        const apiHeaders = ctx.rateHeaders;
        const email = String(ctx.input.email ?? '').toLowerCase();
        throttle(ctx, 'login', 5, `${email}|127.0.0.1`);
        ctx.rateHeaders = apiHeaders;
      }
      if (ctx.isAgent) throw new HttpError(403, 'エージェント用のトークンでは、このAPIは使えません。');

      let idempotencyKey = null;
      let fingerprint = null;
      if (found.idempotent && lower['idempotency-key']) {
        idempotencyKey = `${ctx.user.id}|${ctx.method}|${ctx.path.slice(1)}|${lower['idempotency-key']}`;
        fingerprint = body ?? '';
        const saved = state.idempotency[idempotencyKey];
        if (saved && saved.expires > Date.now()) {
          if (saved.fingerprint !== fingerprint) {
            throw new HttpError(422, '同じ Idempotency-Key で、違う内容のリクエストが送られました。新しいキーを使ってください。');
          }
          const replay = respond(ctx, saved.status, null, { ...saved.headers, 'Idempotent-Replayed': 'true' });
          replay.body = saved.body;
          save();
          return replay;
        }
      }

      const result = found.handler(ctx);
      const response = respond(ctx, result.status, result.json, result.headers);
      if (idempotencyKey && result.status >= 200 && result.status < 300) {
        state.idempotency[idempotencyKey] = {
          fingerprint, status: result.status, body: response.body,
          headers: Object.fromEntries(Object.entries(result.headers ?? {}).filter(([k]) => k === 'Location')),
          expires: Date.now() + 86400000,
        };
      }
      save();
      return response;
    } catch (error) {
      save();
      if (error instanceof ValidationError) {
        const all = Object.values(error.errors).flat();
        let text = all[0];
        if (all.length > 1) text += ` （ほか${all.length - 1}件のエラー）`;
        return respond(ctx, 422, { message: text, errors: error.errors });
      }
      if (error instanceof HttpError) {
        return respond(ctx, error.status, { message: error.message }, error.headers);
      }
      onLog(String(error?.stack ?? error));
      return respond(ctx, 500, { message: 'Server Error' });
    }
  }

  // 本文の手順の代わりに、指定したユーザーのトークンを発行する（第8章の Tinker の代わり）
  function issueTokenFor(email) {
    const user = state.users.find((u) => u.email === email);
    if (!user) return null;
    const plain = issueToken(user, 'dev', ['*'], 30);
    save();
    return plain;
  }

  return { request, reset, issueTokenFor, get state() { return state; } };
}

export { ROLES };
