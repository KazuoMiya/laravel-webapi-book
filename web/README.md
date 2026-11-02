# TaskBoard ブラウザー版

第15章で作る、ブラウザー版のReactアプリです。APIとはCookie（SanctumのSPA認証）でやり取りします。15.4節の画面に、15.10節のチームの切り替えと、15.11節の失敗と通信の順序への備えを加えた最終版です。

## 動かす

先に api フォルダーのAPIを起動し、`sail artisan migrate --seed` まで済ませておきます。

```bash
cp .env.example .env
npm install
npm run dev
```

ブラウザーで http://localhost:5173 を開き、test@example.com とパスワード password でログインします。127.0.0.1:5173 ではCookieのドメインが合わずにログインできないので、必ず localhost で開いてください。

npm run dev が 5173 ではなく 5174 などで起動した場合は、5173番ポートを別のアプリが使っています。APIの設定（SANCTUM_STATEFUL_DOMAINS と FRONTEND_URL）は 5173 を前提にしているので、そのアプリを止めてから起動し直してください。

## ファイル

| ファイル | 内容 |
| --- | --- |
| src/api.js | APIを呼ぶ関数（15.3節、15.10節） |
| src/App.jsx | 画面（15.4節、15.10節、15.11節） |
| .env.example | APIのURL |
