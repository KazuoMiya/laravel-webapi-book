import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,   // 別のオリジンにもCookieを送る
  withXSRFToken: true,     // XSRF-TOKEN Cookieの値を X-XSRF-TOKEN ヘッダーに入れて送る
  headers: { Accept: 'application/json' },
});

// ログイン：先にCSRF用のCookieを受け取ってから、メールアドレスとパスワードを送る
export async function login(email, password) {
  await api.get('/sanctum/csrf-cookie');
  const { data } = await api.post('/login', { email, password });
  return data.data;
}

export async function logout() {
  await api.post('/logout');
}

export async function fetchMe() {
  const { data } = await api.get('/api/v1/me');
  return data.data;
}

// params の例：{ is_done: false, sort: '-priority', page: 1 }
export async function fetchTasks(params) {
  const { data } = await api.get('/api/v1/tasks', { params });
  return data;   // data、links、meta をまとめて返す
}

export async function createTask(input) {
  const { data } = await api.post('/api/v1/tasks', input);
  return data.data;
}

export async function updateTask(id, input) {
  const { data } = await api.patch(`/api/v1/tasks/${id}`, input);
  return data.data;
}

export async function deleteTask(id) {
  await api.delete(`/api/v1/tasks/${id}`);
}

// ここからチームの機能（15.10節）
export async function fetchTeams() {
  const { data } = await api.get('/api/v1/teams');
  return data.data;
}

export async function fetchTeamTasks(teamId, params) {
  const { data } = await api.get(`/api/v1/teams/${teamId}/tasks`, { params });
  return data;
}

export async function createTeamTask(teamId, input) {
  const { data } = await api.post(`/api/v1/teams/${teamId}/tasks`, input);
  return data.data;
}

// チームのタスクは、取得したときの version を If-Match に入れて更新する
export async function updateTeamTask(task, input) {
  const { data } = await api.patch(`/api/v1/tasks/${task.id}`, input, {
    headers: { 'If-Match': `"v${task.version}"` },
  });
  return data.data;
}

// エラーの応答を、画面で表示しやすい文字列に変換する
export function errorMessage(error) {
  const res = error.response;
  if (!res) return 'サーバーに接続できません。';
  if (res.status === 422 && res.data.errors) {
    return Object.values(res.data.errors).flat().join('\n');
  }
  return res.data?.message ?? `エラーが発生しました（${res.status}）`;
}
