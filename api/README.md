# TaskBoard API

本書で作るタスク管理APIの、全章を終えた時点の完成形です。Laravel 13とLaravel Sail（Docker）で動きます。

## はじめて動かす

ターミナルで、このフォルダー（api）に移動してから実行します。Windowsでは、第3章の手順で用意したWSL2のターミナルを使います。

```bash
# 1. 環境設定ファイルを作る
cp .env.example .env

# 2. 依存パッケージをインストールする（PHPとComposerが入ったコンテナーを一時的に使う）
docker run --rm -u "$(id -u):$(id -g)" -v "$(pwd):/app" -w /app composer:2 \
    composer install --ignore-platform-reqs

# 3. コンテナーを起動する（初回はイメージの作成に数分かかる）
./vendor/bin/sail up -d

# 4. 暗号化のキーを作り、テーブルとサンプルデータを作る
./vendor/bin/sail artisan key:generate
./vendor/bin/sail artisan migrate --seed
```

`sail` を毎回 `./vendor/bin/sail` と打たずに済むよう、第3章のエイリアスを設定しておくと便利です。以降は `sail` と書きます。

このリポジトリには composer.lock を含めていません。手順2で、その時点の最新のパッケージで作られます。チームや研修で同じバージョンをそろえたい場合は、作られた composer.lock をコミットして共有してください。

## 旧版のAPIを更新する場合

招待の取り消しに対応する前から使っているDBでは、コードの更新時に `sail artisan migrate` を実行してください。この移行時点で未使用の招待はすべて失効します。参加してほしい人には移行後に招待を再送してください。参加済みのメンバーと承諾履歴は維持されます。

## 動作の確認

| URL | 内容 |
| --- | --- |
| http://localhost/up | 稼働確認。データベースとRedisにもつながれば200（第18章） |
| http://localhost:8081 | Swagger UIで docs/openapi.yaml を表示する（第6章） |
| http://localhost/docs/api | Scrambleがコードから生成した仕様書（第6章） |

シーダーは、次のユーザーを作ります。パスワードはどちらも password です。

| メールアドレス | 内容 |
| --- | --- |
| test@example.com | 個人のタスク40件と、「開発チーム」のオーナー |
| mate@example.com | 「開発チーム」のメンバー。チームのタスクの担当者 |

```bash
# トークンを受け取る
curl -s -X POST http://localhost/api/v1/login \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"password","device_name":"curl"}'

# 受け取ったトークンで、未完了のタスクを優先度の高い順に取得する
curl -s 'http://localhost/api/v1/tasks?is_done=false&sort=-priority' \
  -H 'Accept: application/json' -H 'Authorization: Bearer （受け取ったトークン）'
```

## Web版から送る

本書のWeb版では、curl の例にある「試す」から、このAPIにリクエストを送れます。画面上部の切り替えを「手元の環境で試す」にしてから使います。

1. .env の BOOK_SITE_URL に、Web版のオリジン（https://ユーザー名.github.io のように、パスを含まない形）を書きます。
2. `sail artisan config:clear` で設定を読み直します。
3. Chrome、Edge、Firefox で開きます。httpsのページから http://localhost への送信を、Safariは止めてしまいます。Chromeで「ローカルネットワーク上のデバイスへのアクセス」を聞かれたら、許可します。

この設定は、開発環境（APP_ENV=local）でだけ使われます。

Web版から送れるのは、localhost か 127.0.0.1 の /api/ 以下だけです。手元のAPIで受け取ったトークンはページの中にだけ置き、ページを閉じると消えます。削除（DELETE）は、送り先のURLを表示したうえで、確認のボタンを押したときだけ送ります。

## ポートの公開範囲

compose.yaml では、API（80番）、MySQL（3306番）、Redis（6379番）、Swagger UI（8081番）を、パソコン自身（127.0.0.1）からだけ開けるようにしています。同じWi-Fiのほかの機器からは接続できません。

スマートフォンの実機からAPIを試すとき（第15章）だけ、.env に `APP_HOST_IP=0.0.0.0` を足して `sail up -d` で起動し直します。信頼できるネットワークで、テスト用のアカウントだけを使い、終わったら行を消して戻してください。

本番で、HTTPSを終端するロードバランサーの後ろに置くときは、.env の `TRUSTED_PROXIES` にそのサーバーのIPアドレスを書きます（第12章）。開発環境では空のままにします。

## テスト

```bash
sail artisan test        # 自動テスト（第13章）
sail pint --test         # コードの書き方のチェック
sail npx @redocly/cli lint docs/openapi.yaml   # 仕様書のチェック（第6章）
```

GitHubに送ると、リポジトリ直下の .github/workflows/api-tests.yml が同じチェックを自動で実行します。

## キューとスケジューラー

リマインダーのメール（第17章）は、キューで後から送ります。開発環境では、メールは送られずにログ（storage/logs/laravel.log）に書き出されます。

```bash
sail artisan queue:work      # キューワーカー
sail artisan schedule:work   # スケジューラー（決まった時刻の処理）
```

## AIエージェントから使う

MCPサーバーは http://localhost/mcp/taskboard です（第16章）。エージェント用のトークンは、POST /api/v1/agent-tokens で発行します。AIの開発支援ツール（Laravel Boost）の設定は、第14章の手順で `sail artisan boost:install` を実行して作ります。プロジェクト独自のルールは .ai/guidelines/taskboard.md にあります。

## 本番用のイメージ

```bash
docker build -t taskboard-api .
```

起動に必要な環境変数と、Web、キューワーカー、スケジューラーの起動のしかたは、第17章を参照してください。

## ファイルと章の対応

| 場所 | 章 |
| --- | --- |
| routes/api.php、app/Http/Controllers/Api/V1 | 第8章から第17章 |
| app/Models、database/migrations、database/factories、database/seeders | 第7章、第11章、第17章 |
| app/Http/Requests/Api/V1、lang/ja | 第9章、第11章 |
| app/Policies、app/Http/Controllers/SpaAuthController.php、config/cors.php | 第10章、第11章 |
| app/Http/Middleware | 第9章、第12章、第16章、第17章 |
| tests/Feature | 第13章、第14章、第16章から第18章 |
| app/Mcp、routes/ai.php | 第16章 |
| app/Observers、app/Jobs、routes/console.php、Dockerfile、docker | 第17章、第18章 |
| docs/openapi.yaml | 第6章（第11章、第14章、第16章の追加分を反映） |
