# Laravelで学ぶ Web APIの作り方

タスク管理APIを題材に、考える・つくる・確かめる・届ける

ログイン機能付きのタスク管理API「TaskBoard API」を、PHPとLaravelで最後まで作り上げる入門書の原稿と、そのサンプルコードです。仕様を考え、Laravelで形にし、テストで確かめ、本番で動かして見守るまでを、1つのアプリを少しずつ大きくしながら体験します。

## 目次

- [はじめに](book/00-introduction.md)

**第1部 準備**

- [第1章 Web APIとは何か](book/01-what-is-web-api.md)
- [第2章 本書で使うPHPの基礎](book/02-php-basics.md)
- [第3章 Dockerで開発環境を作る](book/03-docker.md)
- [第4章 Laravelの基本とAPIの第一歩](book/04-laravel-first-step.md)

**第2部 設計**

- [第5章 Web APIを設計する](book/05-api-design.md)
- [第6章 OpenAPIで仕様書を書く](book/06-openapi.md)

**第3部 実装**

- [第7章 データベースとEloquent ORM](book/07-database-eloquent.md)
- [第8章 CRUD APIを実装する](book/08-crud-api.md)
- [第9章 入力検証とエラーハンドリング](book/09-validation-errors.md)
- [第10章 認証と認可](book/10-auth.md)
- [第11章 チームで共有する](book/11-teams.md)
- [第12章 Web APIのセキュリティ](book/12-security.md)

**第4部 品質と開発の進め方**

- [第13章 自動テスト](book/13-testing.md)
- [第14章 AIと一緒に開発する](book/14-ai-assisted-development.md)

**第5部 利用と運用**

- [第15章 ReactからAPIを呼び出す](book/15-react-clients.md)
- [第16章 AIエージェントから使えるAPIにする](book/16-ai-agents-mcp.md)
- [第17章 運用](book/17-operations.md)
- [第18章 障害対応ドリル](book/18-incident-drill.md)

**付録**

- [付録](book/appendix.md)

## リポジトリの構成

| フォルダー | 内容 |
| --- | --- |
| [book](book) | 原稿。章ごとのMarkdownファイル |
| [api](api) | TaskBoard API（Laravel 13）。全章を終えた時点の完成形 |
| [web](web) | ブラウザー版のReactアプリ（第15章） |
| [mobile](mobile) | スマートフォン版のアプリ（React NativeとExpo、第15章） |
| [.github/workflows](.github/workflows) | APIのテストを自動で実行するGitHub Actions（第13章） |

サンプルコードは、本文のコードを章の順に積み重ねた最終的な状態です。章の途中の状態は、本文の手順に沿って自分で作りながら確かめてください。動かし方は、各フォルダーのREADMEにまとめています。

## 動かすのに必要なもの

| 項目 | バージョン |
| --- | --- |
| Docker Desktop | 最新版（PHP 8.5、MySQL 8.4、Redisはコンテナーで動く） |
| Node.js | LTS版（web と mobile でのみ使用） |
| Expo Go | スマートフォン版を実機で試す場合 |

## 読み方

GitHubの画面で、目次から各章を開いて読めます。図はGitHubがそのまま描画します。各章の最後に、前後の章と目次へのリンクがあります。

手元で読む場合は、このリポジトリをクローンして、Markdownを表示できるエディター（Visual Studio Codeなど）で book フォルダーを開いてください。
