# 第3章 Dockerで開発環境を作る

この章を終えると、ブラウザーで http://localhost を開いたときにLaravelのページが表示されます。PHPもMySQLもパソコンに直接は入れず、すべてDockerのコンテナーの中で動かします。

## この章のゴール

- イメージ、コンテナー、ボリュームの違いを説明できる
- Sailで開発環境を起動、停止できる
- .env の役割と、Gitに含めない理由を説明できる

## 3.1 なぜDockerを使うのか

開発では「自分のパソコンでは動くのに、他の人の環境や本番サーバーでは動かない」という問題がよく起きます。原因の多くは、PHPやMySQLのバージョン、設定の違いです。

Dockerを使うと、アプリを動かす環境一式を「コンテナー」という箱に閉じ込められます。箱の設計図を共有すれば、誰のパソコンでも同じ環境を再現できます。

| 用語 | 意味 |
| --- | --- |
| イメージ | コンテナーの設計図。「PHP 8.5が入ったLinux」など |
| コンテナー | イメージから起動した実体。中でPHPやMySQLが動く |
| Docker Compose | 複数のコンテナーをまとめて定義し、一度に起動する仕組み。設定は compose.yaml に書く |
| ボリューム | コンテナーを消しても残るデータの保存場所。データベースの中身を保存する |

Laravelには、Docker Composeを手軽に扱うための公式ツール「Laravel Sail」があります。Dockerに詳しくなくても、PHP、MySQL、Redisがそろった開発環境を作れます。

## 3.2 Docker Desktopをインストールする

[Docker Desktop](https://www.docker.com/products/docker-desktop/) の公式サイトから、自分のOS用のインストーラーをダウンロードして実行します。macOSの場合は、Apple シリコン（M1以降）とIntel のどちらのMacかを選んでください。

Windowsでは、先にWSL2（Windows上でLinuxを動かす仕組み）を用意します。PowerShellを管理者として開き、次のコマンドを実行してから再起動します。

```powershell
PS> wsl --install
```

再起動するとUbuntuの初期設定が始まるので、ユーザー名とパスワードを決めます。その後Docker Desktopをインストールし、設定画面の Resources から WSL integration を開いて Ubuntu を有効にします。以降のコマンドは、すべてUbuntuのターミナルで実行します。

Windowsでは、プロジェクトを必ずUbuntu側のホームフォルダー（`~/`）に置いてください。`/mnt/c/` 以下のWindows側フォルダーに置くと、ファイルの読み込みが極端に遅くなります。

インストールできたら、ターミナルで確認します。

```bash
$ docker --version
$ docker compose version
```

どちらもバージョン番号が表示されれば準備完了です。

## 3.3 Laravelプロジェクトを作る

プロジェクトを置きたいフォルダーで、次のコマンドを実行します。`taskboard` の部分がプロジェクト名になります。

```bash
$ curl -s "https://laravel.build/taskboard?with=mysql,redis" | bash
```

このコマンドは、Laravel公式のスクリプトをダウンロードして実行します。スクリプトの中では、PHPとComposerが入ったコンテナーを一時的に起動し、その中でLaravelのインストールとSailの設定を行います。手元のパソコンにPHPがなくても動くのはこのためです。

`?with=` の後には、使うサービスを指定します。本書ではMySQL（データベース）とRedis（第17章のキャッシュとキューで使う）を選びます。

初回はイメージのダウンロードとビルドに数分かかります。最後にパスワードを聞かれたら、パソコンのログインパスワードを入力します。ファイルの所有者を整えるために使われます。

> 設計判断メモ：開発環境にLaravel Sailを使う
>
> 決めたこと：Laravel公式のSailで、PHP、MySQL、Redisの開発環境を作る。
>
> 選ばなかった案：compose.yaml を自分で一から書く方法は、自由度は高いが、初学者には設定項目が多すぎる。Laravel Herd はmacOSとWindowsで手軽かつ高速に動くが、MySQLやRedisを使うには有料版や別の道具が必要で、Dockerの知識も身につかない。
>
> 理由：公式の構成で、MySQLとRedisまでがコマンド1つでそろう。Dockerの基本も、実際に使いながら学べる。
>
> 見直す条件：本番と同じ構成で開発したくなったとき（第17章の本番用イメージに寄せる）。Dockerの動作が重く、開発の妨げになるとき。

## 3.4 Sailを起動する

```bash
$ cd taskboard
$ ./vendor/bin/sail up -d
```

`up` はコンテナーの起動、`-d` は裏側で動かし続けるという意味です。ブラウザーで http://localhost を開き、Laravelのページが表示されれば成功です。

毎回 `./vendor/bin/sail` と打つのは大変なので、短い別名（エイリアス）を登録しておきます。macOSなら `~/.zshrc`、Ubuntuなら `~/.bashrc` の末尾に次の1行を追加し、ターミナルを開き直します。

```bash
alias sail='sh $([ -f sail ] && echo sail || echo vendor/bin/sail)'
```

以降、本書では `sail` と短く書きます。

> つまずきポイント：sail: command not found と表示される
>
> 別名（エイリアス）を書いた設定ファイルが、まだ読み込まれていません。ターミナルを開き直すか、`source ~/.zshrc`（Ubuntuなら `source ~/.bashrc`）を実行します。それでも動かないときは、プロジェクトのフォルダーにいるかを確かめ、`./vendor/bin/sail` と書いて実行してください。Windowsでは、PowerShellではなくUbuntuのターミナルで実行しているかも確認しましょう。

## 3.5 compose.yamlを読む

プロジェクト直下の `compose.yaml` に、起動するコンテナーが定義されています。主な部分を抜き出すと次のとおりです。

```yaml
services:
    laravel.test:                # アプリ本体（PHPが動く）
        build:
            context: './vendor/laravel/sail/runtimes/8.5'
        image: 'sail-8.5/app'
        ports:
            - '${APP_HOST_IP:-127.0.0.1}:${APP_PORT:-80}:80'   # パソコンの80番 → コンテナーの80番
        volumes:
            - '.:/var/www/html'      # プロジェクトフォルダーをコンテナーと共有
        depends_on:
            - mysql
            - redis
    mysql:
        image: 'mysql:8.4'
        ports:
            - '127.0.0.1:${FORWARD_DB_PORT:-3306}:3306'
        volumes:
            - 'sail-mysql:/var/lib/mysql'  # データをボリュームに保存
    redis:
        image: 'redis:alpine'
```

`ports` の先頭の `127.0.0.1` は、パソコン自身からの接続だけを受け付けるという指定です。Sailが作る compose.yaml にはこの指定がなく、そのままだと、同じWi-Fiにつながったほかの機器からも、APIやデータベースに接続できてしまいます。カフェや会社のネットワークで開発することもあるので、本書では compose.yaml の laravel.test、mysql、redis の `ports` を上のように書き換えておきます（redis は `'127.0.0.1:${FORWARD_REDIS_PORT:-6379}:6379'`）。書き換えたら `sail up -d` で起動し直します。スマートフォンの実機から試すとき（第15章）だけ、`.env` で `APP_HOST_IP=0.0.0.0` にして開けます。

`volumes` で手元のフォルダーとコンテナーをつないでいるため、エディターでファイルを保存すると、すぐにコンテナー内のPHPに反映されます。

コンテナー同士は、サービス名をホスト名として通信できます。アプリからMySQLに接続するときのホスト名が `localhost` ではなく `mysql` になるのはこのためです。

## 3.6 環境設定ファイル .env

プロジェクト直下の `.env` には、環境ごとに変わる設定を書きます。Sailの設定で、データベース接続の部分は自動で書き換えられています。

```dotenv
APP_NAME=TaskBoard
APP_ENV=local
APP_KEY=base64:...        # 暗号化に使う鍵。自動生成される
APP_DEBUG=true            # エラーの詳細を表示する。本番では必ずfalse
APP_URL=http://localhost

DB_CONNECTION=mysql
DB_HOST=mysql             # compose.yamlのサービス名
DB_PORT=3306
DB_DATABASE=laravel
DB_USERNAME=sail
DB_PASSWORD=password

REDIS_HOST=redis
```

`.env` にはパスワードなどの秘密情報が入るため、Gitには含めません。最初から `.gitignore` に登録されています。代わりに、項目の見本として `.env.example` を共有します。

## 3.7 データベースを準備する

Laravelが最初から用意しているテーブル（ユーザーなど）をMySQLに作ります。

```bash
$ sail artisan migrate
```

`artisan` はLaravelに付属するコマンドラインツールです。テーブルの作成、ファイルのひな形づくり、キャッシュの削除など、開発中のさまざまな作業を担当します。`sail artisan` と書くと、コンテナーの中のPHPでartisanが実行されます。

SailのMySQLには、開発用のデータベースとは別に、自動テスト専用の `testing` というデータベースも作られています。第13章のテストはこちらを使うため、開発中のデータが消える心配はありません。

## 3.8 よく使うSailのコマンド

| コマンド | 内容 |
| --- | --- |
| sail up -d | コンテナーを裏側で起動する |
| sail stop | コンテナーを停止する |
| sail artisan （コマンド） | artisanを実行する |
| sail composer （コマンド） | Composerを実行する |
| sail php （ファイル） | PHPファイルを実行する |
| sail test | 自動テストを実行する |
| sail tinker | 対話的にPHPを試せる画面を開く |
| sail shell | コンテナーの中に入る |
| sail mysql | MySQLに接続する |

データベースの中身を画面で見たい場合は、TablePlusなどのデータベースクライアントで接続できます。ホストは `127.0.0.1`、ポートは `3306`、ユーザー名とパスワードは `.env` の値です。

## 3.9 うまく動かないとき

| 症状 | 原因と対処 |
| --- | --- |
| sail up で port is already allocated と出る | 80番や3306番を別のアプリが使っている。`.env` に `APP_PORT=8080` や `FORWARD_DB_PORT=33060` を追加し、http://localhost:8080 で開く |
| Cannot connect to the Docker daemon と出る | Docker Desktopが起動していない。アプリを起動してから再実行する |
| ページが非常に遅い（Windows） | プロジェクトが `/mnt/c/` 以下にある。Ubuntuのホームフォルダーに作り直す |
| ファイルの権限エラーが出る（Linux） | `.env` に `WWWUSER` と `WWWGROUP` が自分のIDになっているか確認する |

## 3.10 Gitで管理を始める

以降の章でコードを変更していくので、この時点の状態をGitに記録しておきます。うまくいかなくなったときに、いつでもこの状態に戻れます。

Gitを初めて使う場合は、先に名前とメールアドレスを設定しておきます。コミットの記録に使われます。

```bash
$ git config --global user.name "Taro Yamada"
$ git config --global user.email "taro@example.com"
```

```bash
$ git init
$ git add .
$ git commit -m "Laravelプロジェクトを作成"
```

## AIに頼むなら

環境構築のエラーは、メッセージをそのまま見せて原因の候補を挙げてもらうと早く解決できます。

```text
sail up -d を実行したら、次のエラーが出ました。
原因の候補を可能性の高い順に3つ挙げ、それぞれの確かめ方を教えてください。
（エラーを貼り付ける）
```

- 貼り付ける前に、.env の値やパスワードが含まれていないかを確かめる
- 提案されたコマンドが何をするかを理解してから実行する。たとえば `docker compose down -v` は、ボリューム（データベースの中身）まで消してしまう

## まとめ

- Dockerを使うと、誰のパソコンでも同じ開発環境を再現できる
- Laravel Sailは、PHP、MySQL、Redisのコンテナーをまとめて扱うツール
- コマンドは `sail artisan`、`sail composer` のようにSail経由で実行する
- 秘密情報は `.env` に書き、Gitには含めない

## 演習

1. 基礎：`sail stop` と `sail up -d` を実行した後で `sail artisan migrate:status` を実行し、マイグレーションの記録が消えていないことを確かめてください。コンテナーを止めてもデータが残る理由を、「ボリューム」という言葉を使って説明してください。
2. 応用：`sail artisan sail:add` でMailpitを追加し、http://localhost:8025 でメールの確認画面を開いてください。

解答例は付録Eにあります。

## レビュー観点

- [ ] .env がGitに含まれていない
- [ ] .env.example に必要な項目がそろっている
- [ ] 環境を作る手順を、READMEなどに書き残している

---

[← 第2章 本書で使うPHPの基礎](02-php-basics.md) ｜ [目次](../README.md#目次) ｜ [第4章 Laravelの基本とAPIの第一歩 →](04-laravel-first-step.md)
