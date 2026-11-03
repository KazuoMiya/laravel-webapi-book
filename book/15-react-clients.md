# 第15章 ReactからAPIを呼び出す

完成したAPIを、実際のフロントエンドから呼び出します。ブラウザーで動くReactアプリはSPA認証で、スマートフォンアプリ（React Native）はトークン認証で接続します。Reactそのものの解説は省き、APIとのやり取りに関わる部分に絞って説明します。

## この章のゴール

- ブラウザーとスマートフォンから、それぞれに合った認証方式でAPIを呼べる
- APIのエラーを、使う側で適切に扱える
- 同時編集の衝突を、画面で利用者に分かりやすく伝えられる

## 15.1 2つのクライアントの違い

| 項目 | ブラウザー（React） | スマートフォン（React Native） |
| --- | --- | --- |
| 認証方式 | SPA認証（Cookie） | APIトークン認証 |
| ログイン | /sanctum/csrf-cookie の後に /login | /api/v1/login でトークンを受け取る |
| 認証情報の保存 | ブラウザーのCookie（JavaScriptから読めない） | 端末の安全な保存領域（SecureStore） |
| 毎回のリクエスト | Cookieが自動で送られる | Authorization: Bearer ヘッダーを付ける |
| CORS | 必要（オリジンが違うため） | 不要（ブラウザーではないため） |
| CSRF対策 | 必要（X-XSRF-TOKEN ヘッダー） | 不要（Cookieを使わないため） |

準備として、Node.jsのLTS版をパソコンにインストールしておきます。また、APIのSailが起動していること、第10章のSPA認証の設定が済んでいることを確認してください。

## 15.2 ブラウザー版のプロジェクトを作る

Viteというツールで、Reactのプロジェクトを作ります。Laravelのプロジェクトとは別のフォルダーで実行してください。

```bash
$ npm create vite@latest taskboard-web -- --template react
$ cd taskboard-web
$ npm install
$ npm install axios
```

プロジェクト直下に `.env` を作り、APIのURLを書きます。

```dotenv
VITE_API_URL=http://localhost
```

## 15.3 APIを呼ぶ関数をまとめる

APIの呼び出しは1つのファイルにまとめ、画面のコードから切り離します。HTTP通信のライブラリには、Sanctumの公式ドキュメントでも使われているaxiosを使います。`src/api.js` を作成します。

```js
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

// エラーの応答を、画面で表示しやすい文字列に変換する
export function errorMessage(error) {
  const res = error.response;
  if (!res) return 'サーバーに接続できません。';
  if (res.status === 422 && res.data.errors) {
    return Object.values(res.data.errors).flat().join('\n');
  }
  return res.data?.message ?? `エラーが発生しました（${res.status}）`;
}
```

第5章でエラーの形をそろえたおかげで、`errorMessage` 関数1つでどのAPIのエラーも処理できています。設計の効果が、使う側のコードの短さに表れる部分です。

## 15.4 画面を作る

`src/App.jsx` を次の内容に置き換えます。ログイン、一覧、追加、完了の切り替え、削除ができる最小限の画面です。

```jsx
import { useEffect, useState } from 'react';
import {
  login, logout, fetchMe, fetchTasks, createTask, updateTask, deleteTask, errorMessage,
} from './api';

export default function App() {
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [meta, setMeta] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  // 画面を開いたとき、すでにログイン済みか確かめる
  useEffect(() => {
    fetchMe().then(setUser).catch(() => setUser(null));
  }, []);

  // ログインしたらタスクを読み込む
  useEffect(() => {
    if (user) loadTasks(1);
  }, [user]);

  async function loadTasks(page) {
    try {
      const result = await fetchTasks({ sort: '-created_at', page });
      setTasks(result.data);
      setMeta(result.meta);
    } catch (e) {
      if (e.response?.status === 401) setUser(null);   // セッション切れ
      setError(errorMessage(e));
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      setUser(await login(form.get('email'), form.get('password')));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function handleAdd(event) {
    event.preventDefault();
    try {
      await createTask({ title, priority: 'medium' });
      setTitle('');
      setError('');
      await loadTasks(1);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function toggleDone(task) {
    const updated = await updateTask(task.id, { is_done: !task.is_done });
    setTasks(tasks.map((t) => (t.id === task.id ? updated : t)));
  }

  async function remove(task) {
    await deleteTask(task.id);
    await loadTasks(meta.current_page);
  }

  if (!user) {
    return (
      <form onSubmit={handleLogin}>
        <h1>TaskBoard ログイン</h1>
        <input name="email" type="email" placeholder="メールアドレス" defaultValue="test@example.com" />
        <input name="password" type="password" placeholder="パスワード" />
        <button>ログイン</button>
        {error && <p style={{ color: 'red', whiteSpace: 'pre-line' }}>{error}</p>}
      </form>
    );
  }

  return (
    <main>
      <h1>{user.name}さんのタスク</h1>
      <button onClick={() => logout().catch(() => {}).finally(() => setUser(null))}>ログアウト</button>

      <form onSubmit={handleAdd}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="新しいタスク" />
        <button>追加</button>
      </form>
      {error && <p style={{ color: 'red', whiteSpace: 'pre-line' }}>{error}</p>}

      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <input type="checkbox" checked={task.is_done} onChange={() => toggleDone(task)} />
            {task.title}（{task.priority}{task.due_date ? `、期限 ${task.due_date}` : ''}）
            {task.tags.map((tag) => <span key={tag.id}> #{tag.name}</span>)}
            <button onClick={() => remove(task)}>削除</button>
          </li>
        ))}
      </ul>

      {meta && (
        <p>
          <button disabled={meta.current_page <= 1} onClick={() => loadTasks(meta.current_page - 1)}>前へ</button>
          {meta.current_page} / {meta.last_page}（全{meta.total}件）
          <button disabled={meta.current_page >= meta.last_page} onClick={() => loadTasks(meta.current_page + 1)}>次へ</button>
        </p>
      )}
    </main>
  );
}
```

> つまずきポイント：Sailが5173番ポートを使っている
>
> Sailの compose.yaml は、Laravelの画面づくりに使うViteのために、パソコンの5173番ポートをコンテナーに割り当てています。このままでは、Reactの開発サーバーと同じポートを取り合います。Reactが5174番などで起動してしまい、第10章のSPA認証の設定（localhost:5173）と合わなくなります。本書のAPIはViteを使わないので、API側の compose.yaml の laravel.test の ports から `'${VITE_PORT:-5173}:${VITE_PORT:-5173}'` の行を削除し、`sail up -d` で起動し直してください。

開発用サーバーを起動します。

```bash
$ npm run dev
```

ブラウザーで http://localhost:5173 を開き、シーダーで作った test@example.com とパスワード password でログインします。127.0.0.1:5173 で開くとCookieのドメインが合わずにログインできないので、必ず localhost で開いてください。

## 15.5 ブラウザーの開発者ツールで通信を観察する

ブラウザーの開発者ツール（F12キー）のネットワークタブを開いたまま操作すると、本書で学んだ仕組みが実際に動いている様子を確認できます。

- ログイン時に、まず /sanctum/csrf-cookie が呼ばれ、XSRF-TOKEN というCookieが届く
- /login のリクエストヘッダーに X-XSRF-TOKEN が入っている
- タスクの作成や削除の前に、OPTIONSメソッドのリクエスト（プリフライト）が送られている
- 応答ヘッダーに Access-Control-Allow-Origin: http://localhost:5173 と Access-Control-Allow-Credentials: true が入っている
- 作成の応答が201、削除の応答が204になっている

うまく動かないときは、まずこのタブでステータスコードと応答の中身を見ます。よくある原因は次のとおりです。

| 症状 | 原因 |
| --- | --- |
| ブラウザーのコンソールにCORSのエラーが出る | config/cors.php の allowed\_origins や supports\_credentials の設定漏れ。設定変更後は `sail artisan config:clear` |
| /login が419を返す | CSRFトークンの不一致。/sanctum/csrf-cookie を先に呼んでいない、または withXSRFToken の設定漏れ |
| ログインは成功するのに /api/v1/me が401 | SANCTUM\_STATEFUL\_DOMAINS に localhost:5173 がない、SESSION\_DOMAIN の設定漏れ、127.0.0.1 で開いている |
| npm run dev が5174番などで起動し、ログインできない | Sailが5173番ポートを使っている。15.4節のつまずきポイントのとおり compose.yaml を直す |

> 設計判断メモ：ブラウザー版はaxios、スマートフォン版はfetch
>
> 決めたこと：ブラウザー版はaxiosで、スマートフォン版は標準のfetchで、APIを呼び出す。
>
> 選ばなかった案：両方をfetchにすると、SPA認証のCSRFトークン（XSRF-TOKEN のCookieの値をヘッダーに入れる処理）を自分で書く必要がある。両方をaxiosにしてもよいが、スマートフォン版にはCookieの処理が要らず、依存するパッケージが1つ増えるだけになる。
>
> 理由：ブラウザー版では、axiosがCSRFトークンの受け渡しを自動で行ってくれる。スマートフォン版はトークンをヘッダーに付けるだけなので、標準の機能で十分。
>
> 見直す条件：両方で同じAPIクライアントを使いたくなったら、OpenAPIの仕様書から生成したクライアントに統一する。

## 15.6 スマートフォン版のプロジェクトを作る

スマートフォンアプリは、React NativeをExpoというツールと組み合わせて作ります。Expoを使うと、手持ちのスマートフォンに「Expo Go」アプリを入れるだけで、開発中のアプリを動かせます。

```bash
$ npx create-expo-app@latest taskboard-mobile --template blank
$ cd taskboard-mobile
$ npx expo install expo-secure-store react-native-safe-area-context
```

expo-secure-store は、トークンを端末の安全な保存領域（iOSのキーチェーン、Androidのキーストア）に保存するためのパッケージです。トークンはログインの証明そのものなので、普通のファイルや設定に平文で置かないようにします。react-native-safe-area-context は、画面上部の切り欠きやステータスバーに重ならないように表示するためのパッケージです。React Native本体の SafeAreaView は非推奨になり、使うと警告が表示されるため、こちらを使います。

スマートフォンから見た localhost は、スマートフォン自身を指します。そのため、APIのURLにはパソコンのIPアドレスを指定します。

ただし、第3章でAPIのポートをパソコン自身（127.0.0.1）からだけ開けるようにしたので、このままではスマートフォンから届きません。実機で試す間だけ、API側の `.env` に次の1行を足して、同じネットワークの機器からも接続できるようにします。

```dotenv
# api/.env：実機で試す間だけ。終わったら行を消して sail up -d で戻す
APP_HOST_IP=0.0.0.0
```

```bash
$ sail up -d   # ポートの設定を変えたので、コンテナーを作り直す
```

この状態では、同じWi-Fiにつながったすべての機器からAPIに接続できます。また、通信はHTTPなので、ログインのパスワードやトークンが暗号化されずにWi-Fiを流れます。次の3つを守りましょう。

- 自宅など、信頼できるネットワークでだけ行う。カフェや会社の共用Wi-Fiでは行わない
- シーダーで作ったテスト用のアカウント（test@example.com など）でログインし、普段使いのパスワードは入力しない
- 試し終わったら、`APP_HOST_IP` の行を消して `sail up -d` で戻す

本番のアプリは、HTTPSで公開したAPIにつなぎます（第12章）。

パソコンとスマートフォンを同じWi-Fiにつなぎ、アプリのプロジェクト直下に `.env` を作ります。

```dotenv
# パソコンのIPアドレスに置き換える（macOSは「システム設定」→「Wi-Fi」→「詳細」で確認できる）
EXPO_PUBLIC_API_URL=http://192.168.1.10
```

Androidのエミュレーターでは、パソコンを指すアドレスとして http://10.0.2.2 が使えます。iOSのシミュレーターでは http://localhost のままでつながります。どちらもパソコンの中で動くので、`APP_HOST_IP` の変更は要りません。

> つまずきポイント：スマートフォンからAPIにつながらない
>
> 次の順に確かめます。API側の `.env` に `APP_HOST_IP=0.0.0.0` を足して `sail up -d` し直したか。パソコンとスマートフォンが同じWi-Fiにつながっているか。`.env` のIPアドレスが、今のパソコンのIPアドレスと一致しているか（Wi-Fiにつなぎ直すと変わることがあります）。パソコンのファイアウォールが、ポート80への接続を止めていないか。スマートフォンのブラウザーで http://（パソコンのIPアドレス）/up を開き、応答が返るかを試すと、どこまで届いているかを切り分けられます。

## 15.7 トークンでAPIを呼ぶ

`api.js` を作成します。こちらはaxiosを使わず、標準の fetch 関数で書いてみます。

```js
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
```

ブラウザー版との違いは、`request` 関数の Authorization ヘッダーだけです。APIの側は同じ `auth:sanctum` で、Cookieでもトークンでも受け付けています。

## 15.8 スマートフォンの画面

`App.js` を次の内容に置き換えます。

```jsx
import { useEffect, useState } from 'react';
import {
  Alert, Button, FlatList, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as api from './api';

// 画面の上下の切り欠きやステータスバーを避けて表示するため、全体を SafeAreaProvider で包む
export default function App() {
  return (
    <SafeAreaProvider>
      <TaskBoard />
    </SafeAreaProvider>
  );
}

function TaskBoard() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('test@example.com');
  const [password, setPassword] = useState('');
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');

  // 保存済みのトークンが有効なら、そのままログイン状態にする
  useEffect(() => {
    api.fetchMe().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function load() {
    const result = await api.fetchTasks();
    setTasks(result.data);
  }

  async function handleLogin() {
    try {
      setUser(await api.login(email, password));
    } catch (e) {
      Alert.alert('ログインできません', e.message);
    }
  }

  async function handleAdd() {
    try {
      await api.createTask(title);
      setTitle('');
      await load();
    } catch (e) {
      const detail = e.errors ? Object.values(e.errors).flat().join('\n') : e.message;
      Alert.alert('追加できません', detail);
    }
  }

  async function handleToggle(task) {
    const updated = await api.toggleTask(task);
    setTasks(tasks.map((t) => (t.id === task.id ? updated : t)));
  }

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
        <Text style={{ fontSize: 24 }}>TaskBoard</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="メールアドレス" />
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="パスワード" />
        <Button title="ログイン" onPress={handleLogin} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 24 }}>
      <Text style={{ fontSize: 20 }}>{user.name}さんのタスク</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 12 }}>
        <TextInput style={{ flex: 1 }} value={title} onChangeText={setTitle} placeholder="新しいタスク" />
        <Button title="追加" onPress={handleAdd} />
      </View>
      <FlatList
        data={tasks}
        keyExtractor={(task) => String(task.id)}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
            <Switch value={item.is_done} onValueChange={() => handleToggle(item)} />
            <Text style={{ flex: 1, marginLeft: 8 }}>{item.title}</Text>
            <Button title="削除" onPress={async () => { await api.deleteTask(item.id); await load(); }} />
          </View>
        )}
      />
      <Button title="ログアウト" onPress={() => api.logout().catch(() => {}).finally(() => setUser(null))} />
    </SafeAreaView>
  );
}
```

開発用サーバーを起動します。

```bash
$ npx expo start
```

ターミナルに表示されるQRコードを、スマートフォンのカメラ（iPhone）またはExpo Goアプリ（Android）で読み取ると、アプリが起動します。

## 15.9 フロントエンドから見たAPI設計

2つのクライアントを作ってみると、API設計の良し悪しが使う側にどう響くかが分かります。

- エラーの形がそろっているので、エラー表示の処理が1か所で済んだ
- 一覧の応答に meta があるので、ページ送りのボタンを簡単に作れた
- 更新APIが更新後のタスクを返すので、一覧を取り直さずに画面を更新できた
- 認証方式が違っても、同じAPIをそのまま使えた

逆に、使う側で不便を感じた点があれば、それは設計を見直すきっかけになります。APIは、使う人の体験から改善していくものです。

## 15.10 チームのタスクと同時編集

第11章のチーム機能を、ブラウザー版から使えるようにします。`src/api.js` に関数を追加します。

```js
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
```

画面では、上部に「個人」とチームを切り替える選択欄を置き、選んだものに応じて一覧を取り直します。`App.jsx` の主な変更は次のとおりです。

```jsx
const [teams, setTeams] = useState([]);
const [teamId, setTeamId] = useState('');   // 空なら個人のタスク

useEffect(() => {
  if (user) fetchTeams().then(setTeams);
}, [user]);

useEffect(() => {
  if (user) loadTasks(1);
}, [user, teamId]);

async function loadTasks(page) {
  const params = { sort: '-created_at', page };
  const result = teamId ? await fetchTeamTasks(teamId, params) : await fetchTasks(params);
  setTasks(result.data);
  setMeta(result.meta);
}

const currentTeam = teams.find((team) => String(team.id) === String(teamId));
const canCreate = !currentTeam || currentTeam.my_role !== 'viewer';   // 閲覧専用なら追加欄を出さない

async function handleAdd(event) {
  event.preventDefault();
  try {
    const input = { title, priority: 'medium' };
    // 選んでいるのがチームなら、チームのタスクとして作る
    await (teamId ? createTeamTask(teamId, input) : createTask(input));
    setTitle('');
    setError('');
    await loadTasks(1);
  } catch (e) {
    setError(errorMessage(e));
  }
}

async function toggleDone(task) {
  try {
    const input = { is_done: !task.is_done };
    const updated = task.team_id ? await updateTeamTask(task, input) : await updateTask(task.id, input);
    setTasks(tasks.map((t) => (t.id === task.id ? updated : t)));
  } catch (e) {
    if (e.response?.status === 412) {
      // 他の人が先に更新していた。最新の内容を取り直して知らせる
      setError('他の人がこのタスクを更新しました。最新の内容を表示しています。');
      await loadTasks(meta.current_page);
      return;
    }
    setError(errorMessage(e));   // 閲覧専用の役割なら403のメッセージが表示される
  }
}

// 一覧の上に置く切り替えの選択欄
<select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
  <option value="">個人</option>
  {teams.map((team) => (
    <option key={team.id} value={team.id}>{team.name}（{team.my_role}）</option>
  ))}
</select>
```

15.4節の handleAdd は個人のタスクを作る createTask を呼ぶので、そのままだと、チームを選んでいるときに追加したタスクが個人のタスクになってしまいます。上のように、選んでいるものに応じて作成先を切り替えます。追加の入力欄は `{canCreate && (...)}` で囲み、閲覧専用の役割では表示しないようにします。

412が返ったときに、利用者の操作をそのまま上書きで送り直してはいけません。それでは、412で防ごうとした「更新の消失」がまた起きてしまいます。最新の内容を見せたうえで、利用者にもう一度操作してもらうのが基本です。

If-Match は、ブラウザーから別のオリジンに送る独自のヘッダーなので、プリフライトの対象になります。第10章の config/cors.php で allowed\_headers を `*` にしているので、追加の設定は要りません。

## 15.11 失敗と通信の順序に備える

この章のサンプルは、APIとのやり取りを見やすくするために、失敗の扱いを最小限にしています。実際に使う画面では、次の3点を加えます。

1. すべての操作を共通の関数で包み、失敗を必ず表示する。401なら、ログインの状態を消してログイン画面に戻す
2. 古い応答を捨てる。チームやページを素早く切り替えると、先に出したリクエストの応答が後から届き、今選んでいるものと違う一覧で上書きすることがある
3. 同じボタンの連打で、同じ操作を二重に送らないようにする

```jsx
import { useRef } from 'react';

const latest = useRef(0);
const [busy, setBusy] = useState(false);

// 操作を包む共通の関数
async function run(action) {
  if (busy) return;   // 処理中の連打を無視する
  setBusy(true);
  try {
    await action();
    setError('');
  } catch (e) {
    if (e.response?.status === 401) setUser(null);   // ログイン画面に戻す
    setError(errorMessage(e));
  } finally {
    setBusy(false);
  }
}

// 一覧の取得では、最後に出したリクエストの応答だけを使う
async function loadTasks(page) {
  const requestNo = ++latest.current;
  const params = { sort: '-created_at', page };
  const result = teamId ? await fetchTeamTasks(teamId, params) : await fetchTasks(params);
  if (requestNo !== latest.current) return;   // 古い応答なので捨てる
  setTasks(result.data);
  setMeta(result.meta);
}

// 使い方の例
<button onClick={() => run(() => remove(task))} disabled={busy}>削除</button>
```

ログアウトは、サーバーでの無効化が失敗しても（トークンの期限切れや通信の失敗など）、画面と端末からは必ずログイン状態を消すようにします。15.4節と15.8節のログアウトのボタン、15.7節の logout 関数は、そのように書いてあります。

## AIに頼むなら

```text
次のReactのコンポーネントで、APIのエラー（401、403、404、412、422、429）の扱いに
漏れがないかを確かめ、足りない処理を加えてください。
429のときは Retry-After ヘッダーの秒数だけ待ってから再試行できるようにしてください。
（コンポーネントを貼り付ける）
```

- 401のときにログイン画面に戻るかを確かめる
- 412のときに、利用者の操作を勝手に送り直していないかを確かめる

APIの型定義（TypeScriptを使う場合）は、AIに書かせるより、OpenAPIの仕様書から生成するツール（openapi-typescript など）を使うほうが確実です。仕様書を変えたら、型定義も作り直すだけで済みます。

## まとめ

- ブラウザーのReactはSPA認証（Cookie、CSRF対策、CORS）、スマートフォンはトークン認証で接続する
- APIの呼び出しは1つのファイルにまとめ、エラー処理を共通化する
- トークンは端末の安全な保存領域に保存し、Authorizationヘッダーで送る
- 開発者ツールで実際の通信を観察すると、CORSやCSRFの仕組みが理解しやすい

## 演習

1. 基礎：ブラウザー版に、優先度で絞り込む選択欄を加えてください。
2. 応用：412が返ったときに、利用者が入力していた変更内容を残したまま最新の内容を取り直し、内容を確かめてから保存し直せる画面にしてください。

解答例は付録Eにあります。

## レビュー観点

- [ ] ブラウザーでは、トークンをJavaScriptから読める場所に保存していない
- [ ] スマートフォンでは、トークンをSecureStoreに保存している
- [ ] 401、403、412、422、429のエラーを画面で扱っている
- [ ] チームのタスクの更新で If-Match を送っている

---

[← 第14章 AIと一緒に開発する](14-ai-assisted-development.md) ｜ [目次](../README.md#目次) ｜ [第16章 AIエージェントから使えるAPIにする →](16-ai-agents-mcp.md)
