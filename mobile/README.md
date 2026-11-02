# TaskBoard スマートフォン版

第15章で作る、スマートフォン版のアプリです（React NativeとExpo）。APIとはトークンでやり取りし、トークンは端末の安全な保存領域（expo-secure-store）に保存します。

## 動かす

先に api フォルダーのAPIを起動し、`sail artisan migrate --seed` まで済ませておきます。スマートフォンに「Expo Go」アプリを入れ、パソコンと同じWi-Fiにつないでください。

```bash
cp .env.example .env    # EXPO_PUBLIC_API_URL を、パソコンのIPアドレスに書き換える
npm install
npx expo start
```

表示されたQRコードを、スマートフォンのカメラ（iPhone）またはExpo Go（Android）で読み取ると、アプリが開きます。test@example.com とパスワード password でログインします。

つながらないときは、スマートフォンのブラウザーで http://（パソコンのIPアドレス）/up を開き、応答が返るかを確かめてください（15.6節のつまずきポイント）。

## ファイル

| ファイル | 内容 |
| --- | --- |
| api.js | APIを呼ぶ関数。fetchで書いている（15.7節） |
| App.js | 画面（15.8節） |
| .env.example | APIのURL |
