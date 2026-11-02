import * as SecureStore from 'expo-secure-store';

const BASE_URL = `${process.env.EXPO_PUBLIC_API_URL}/api/v1`;
const TOKEN_KEY = 'taskboard_token';

async function request(path, { method = 'GET', body } = {}) {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;   // ボディのない応答

  const json = await res.json();
  if (!res.ok) {
    const error = new Error(json.message);
    error.status = res.status;
    error.errors = json.errors;   // 422のときの項目ごとのエラー
    throw error;
  }
  return json;
}

export async function login(email, password) {
  const json = await request('/login', {
    method: 'POST',
    body: { email, password, device_name: 'TaskBoard Mobile' },
  });
  await SecureStore.setItemAsync(TOKEN_KEY, json.data.token);
  return json.data.user;
}

export async function logout() {
  try {
    await request('/logout', { method: 'POST' });   // サーバー側でトークンを無効にする
  } finally {
    // 失敗しても（期限切れなど）、端末からは必ずトークンを消す
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export async function fetchMe() {
  return (await request('/me')).data;
}

export async function fetchTasks(page = 1) {
  return request(`/tasks?sort=-created_at&page=${page}`);
}

export async function createTask(title) {
  return (await request('/tasks', { method: 'POST', body: { title } })).data;
}

export async function toggleTask(task) {
  return (await request(`/tasks/${task.id}`, { method: 'PATCH', body: { is_done: !task.is_done } })).data;
}

export async function deleteTask(id) {
  await request(`/tasks/${id}`, { method: 'DELETE' });
}
