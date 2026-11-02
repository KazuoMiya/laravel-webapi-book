import { useEffect, useRef, useState } from 'react';
import {
  login, logout, fetchMe, fetchTasks, createTask, updateTask, deleteTask,
  fetchTeams, fetchTeamTasks, createTeamTask, updateTeamTask, errorMessage,
} from './api';

// 第15章のブラウザー版。15.4節の画面に、15.10節のチームの切り替えと、
// 15.11節の失敗と通信の順序への備えを加えた最終版
export default function App() {
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [meta, setMeta] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState('');   // 空なら個人のタスク
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  // 画面を開いたとき、すでにログイン済みか確かめる
  useEffect(() => {
    fetchMe().then(setUser).catch(() => setUser(null));
  }, []);

  // ログインしたら、所属しているチームを読み込む
  useEffect(() => {
    if (user) fetchTeams().then(setTeams).catch((e) => setError(errorMessage(e)));
  }, [user]);

  // ログインしたとき、個人とチームを切り替えたときに、タスクを読み込む
  useEffect(() => {
    if (user) load(1);
  }, [user, teamId]);

  // 操作を包む共通の関数。失敗を必ず表示し、401ならログイン画面に戻す
  async function run(action) {
    if (busy) return;   // 処理中の連打を無視する
    setBusy(true);
    try {
      await action();
      setError('');
    } catch (e) {
      if (e.response?.status === 401) setUser(null);   // セッション切れ
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // 一覧の読み込み。切り替えの途中でも読み込めるよう、連打の防止（busy）は通さない
  async function load(page) {
    try {
      await loadTasks(page);
    } catch (e) {
      if (e.response?.status === 401) setUser(null);
      setError(errorMessage(e));
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

  function handleLogout() {
    // サーバーでの無効化が失敗しても、画面からは必ずログイン状態を消す
    logout().catch(() => {}).finally(() => {
      setUser(null);
      setTeams([]);
      setTeamId('');
      setTasks([]);
      setMeta(null);
    });
  }

  const currentTeam = teams.find((team) => String(team.id) === String(teamId));
  const canCreate = !currentTeam || currentTeam.my_role !== 'viewer';   // 閲覧専用なら追加欄を出さない

  function handleAdd(event) {
    event.preventDefault();
    run(async () => {
      const input = { title, priority: 'medium' };
      // 選んでいるのがチームなら、チームのタスクとして作る
      await (teamId ? createTeamTask(teamId, input) : createTask(input));
      setTitle('');
      await loadTasks(1);
    });
  }

  async function toggleDone(task) {
    try {
      const input = { is_done: !task.is_done };
      const updated = task.team_id ? await updateTeamTask(task, input) : await updateTask(task.id, input);
      setTasks((current) => current.map((t) => (t.id === task.id ? updated : t)));
      setError('');
    } catch (e) {
      if (e.response?.status === 412) {
        // 他の人が先に更新していた。送り直さずに、最新の内容を取り直して知らせる
        await loadTasks(meta.current_page);
        setError('他の人がこのタスクを更新しました。最新の内容を表示しています。');
        return;
      }
      if (e.response?.status === 401) setUser(null);
      setError(errorMessage(e));   // 閲覧専用の役割なら403のメッセージが表示される
    }
  }

  function remove(task) {
    run(async () => {
      await deleteTask(task.id);
      await loadTasks(meta.current_page);
    });
  }

  if (!user) {
    return (
      <form className="login" onSubmit={handleLogin}>
        <h1>TaskBoard ログイン</h1>
        <input name="email" type="email" placeholder="メールアドレス" defaultValue="test@example.com" />
        <input name="password" type="password" placeholder="パスワード" />
        <button>ログイン</button>
        {error && <p className="error">{error}</p>}
      </form>
    );
  }

  return (
    <main>
      <h1>{user.name}さんのタスク</h1>
      <button onClick={handleLogout}>ログアウト</button>

      <p>
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">個人</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}（{team.my_role}）</option>
          ))}
        </select>
      </p>

      {canCreate && (
        <form onSubmit={handleAdd}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="新しいタスク" />
          <button disabled={busy}>追加</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}

      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <input type="checkbox" checked={task.is_done} onChange={() => toggleDone(task)} />
            {task.title}（{task.priority}{task.due_date ? `、期限 ${task.due_date}` : ''}）
            {task.assignee && <span> 担当：{task.assignee.name}</span>}
            {task.tags.map((tag) => <span key={tag.id}> #{tag.name}</span>)}
            <button onClick={() => remove(task)} disabled={busy}>削除</button>
          </li>
        ))}
      </ul>

      {meta && (
        <p>
          <button disabled={meta.current_page <= 1} onClick={() => load(meta.current_page - 1)}>前へ</button>
          {meta.current_page} / {meta.last_page}（全{meta.total}件）
          <button disabled={meta.current_page >= meta.last_page} onClick={() => load(meta.current_page + 1)}>次へ</button>
        </p>
      )}
    </main>
  );
}
