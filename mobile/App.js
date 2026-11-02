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
