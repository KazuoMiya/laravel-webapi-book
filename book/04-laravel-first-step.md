# 第4章 Laravelの基本とAPIの第一歩

この章では、最初のWeb APIを作ってcurlで呼び出します。その過程で、Laravelのフォルダー構成、ルーティング、コントローラー、ミドルウェアという4つの基本部品を学びます。

## この章のゴール

- ルート、コントローラー、ミドルウェアの役割を説明できる
- リクエストから値を取り出し、JSONで応答を返せる
- route:list で、登録したルートを確かめられる

## 4.1 Laravelの役割分担

Laravelでは、1つのリクエストを複数の部品が分担して処理します。Web APIで主に使う部品は次のとおりです。

| 部品 | 役割 | 置き場所 |
| --- | --- | --- |
| ルート | どのURLとメソッドを、どの処理に渡すかを決める | routes/api.php |
| ミドルウェア | 処理の前後で共通のチェックをする（認証、回数制限など） | app/Http/Middleware |
| コントローラー | リクエストを受けて、必要な処理を呼び出し、レスポンスを返す | app/Http/Controllers |
| モデル | データベースのテーブルとやり取りする | app/Models |
| APIリソース | モデルをJSONの形に整える | app/Http/Resources |

画面を返すアプリでは、これに「ビュー」が加わります。本書ではビューを使わず、APIリソースでJSONを作ります。

## 4.2 フォルダー構成

プロジェクトの中で、本書がよく触るフォルダーとファイルは次のとおりです。

| パス | 内容 |
| --- | --- |
| app/ | アプリ本体のコード。コントローラーやモデルを置く |
| bootstrap/app.php | アプリの組み立て。ルート、ミドルウェア、例外処理の設定を書く |
| config/ | 各種設定ファイル。多くの値は .env から読み込む |
| database/migrations/ | テーブルの設計図（マイグレーション） |
| database/factories/、database/seeders/ | テスト用、開発用のデータを作る仕組み |
| routes/ | ルートの定義。api.php にAPIを書く |
| storage/logs/ | ログファイルの出力先 |
| tests/ | 自動テスト |
| vendor/ | Composerで入れたパッケージ（編集しない） |

## 4.3 APIを使えるようにする

作ったばかりのLaravelには、APIのルートを書く `routes/api.php` がありません。次のコマンドでAPI機能を有効にします。

```bash
$ sail artisan install:api
```

このコマンドは3つのことを行います。認証用パッケージのLaravel Sanctumをインストールし、`routes/api.php` を作り、トークンを保存するテーブルのマイグレーションを追加します。途中でマイグレーションを実行するか聞かれたら、yes を選びます。

`bootstrap/app.php` を開くと、`api:` の行が追加されています。

```php
<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',   // ← 追加された
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        //
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
```

`routes/api.php` に書いたルートには、自動で `/api` という接頭辞が付きます。また、`health: '/up'` は、アプリが動いているかを確認するための /up というURLを用意する設定です。第17章の監視で使います。`withExceptions` の中の `shouldRenderJsonWhen` は、/api 以下で起きたエラーをJSONで返すための設定で、最初から書かれています。第9章で詳しく扱います。

## 4.4 最初のAPI

`routes/api.php` の中身を次のように書き換えます。

```php
<?php

use Illuminate\Support\Facades\Route;

Route::get('/hello', function () {
    return ['message' => 'Hello, API'];
});
```

`Route::get` は「GETメソッドで /hello に来たリクエストを、この関数で処理する」という意味です。関数が連想配列を返すと、Laravelが自動でJSONに変換し、`Content-Type: application/json` を付けて返します。

```bash
$ curl -i http://localhost/api/hello
HTTP/1.1 200 OK
Content-Type: application/json

{"message":"Hello, API"}
```

これで最初のWeb APIが完成しました。

## 4.5 ルートパラメーター

URLの一部を変数として受け取るには、`{ }` で囲みます。

```php
Route::get('/hello/{name}', function (string $name) {
    return ['message' => "Hello, {$name}"];
});
```

```bash
$ curl http://localhost/api/hello/Taro
{"message":"Hello, Taro"}
```

第8章では、この仕組みで `/tasks/{task}` のIDからタスクを取り出します。

## 4.6 コントローラーに処理を移す

ルートファイルに処理を書き続けると、すぐに読みにくくなります。処理はコントローラーに移すのが基本です。artisanでひな形を作ります。

```bash
$ sail artisan make:controller Api/V1/HelloController
```

`app/Http/Controllers/Api/V1/HelloController.php` ができるので、次のように書きます。

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HelloController extends Controller
{
    // GET /api/v1/hello?name=Taro
    public function index(Request $request): JsonResponse
    {
        $name = $request->query('name', 'World');   // 第2引数は省略時の値

        return response()->json(['message' => "Hello, {$name}"]);
    }

    // POST /api/v1/hello
    public function store(Request $request): JsonResponse
    {
        $name = $request->input('name');

        return response()->json(
            ['message' => "{$name}さんを登録しました"],
            201,   // ステータスコード
        );
    }
}
```

ルートからコントローラーを呼び出します。`Route::prefix('v1')` でまとめると、中のルートすべてに `/v1` が付きます。

```php
<?php

use App\Http\Controllers\Api\V1\HelloController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('/hello', [HelloController::class, 'index']);
    Route::post('/hello', [HelloController::class, 'store']);
});
```

```bash
$ curl "http://localhost/api/v1/hello?name=Hanako"
{"message":"Hello, Hanako"}

$ curl -i -X POST http://localhost/api/v1/hello \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d '{"name":"Taro"}'
HTTP/1.1 201 Created
...
{"message":"Taroさんを登録しました"}
```

行末の `\` は、長いコマンドを複数行に分けて書くための記号です。

> 設計判断メモ：処理はコントローラーに書く
>
> 決めたこと：ルートファイルにはURLとコントローラーの対応だけを書き、処理はコントローラーに書く。
>
> 選ばなかった案：ルートファイルに関数（クロージャ）で処理を書く。小さなAPIなら手軽だが、APIが増えるとルートファイルが長くなり、どんなAPIがあるかを見渡せなくなる。
>
> 理由：ルートファイルを「APIの目次」として保てる。処理はクラスとメソッドに整理され、読みやすく、テストもしやすい。
>
> 見直す条件：動作確認用の1行で済むルートなど、ごく小さな処理だけの場合。

## 4.7 リクエストから値を取り出す

コントローラーの引数に `Request $request` と書くと、Laravelがリクエストの情報を渡してくれます。この「必要なものを引数に書くと自動で渡してくれる」仕組みを依存性注入と呼びます。

| 書き方 | 取り出すもの |
| --- | --- |
| $request->query('page') | URLの ? 以降（クエリ文字列）の値 |
| $request->input('title') | ボディ（JSON）またはクエリの値 |
| $request->all() | すべての入力値を連想配列で |
| $request->header('Accept') | ヘッダーの値 |
| $request->user() | ログイン中のユーザー（第10章） |

## 4.8 レスポンスを返す

| 書き方 | 結果 |
| --- | --- |
| return \['a' => 1\]; | 200 OK でJSONを返す |
| return response()->json($data, 201); | ステータスコードを指定してJSONを返す |
| return response()->json($data)->header('X-Foo', 'bar'); | ヘッダーを追加する |
| return response()->noContent(); | 204 No Content（ボディなし）を返す |
| abort(404); | 処理を中断して404を返す |

## 4.9 登録したルートを確認する

```bash
$ sail artisan route:list --path=api
```

メソッド、URL、呼び出されるコントローラーが一覧で表示されます。「URLを書いたのに404になる」ときは、まずこのコマンドで登録されているかを確かめましょう。

> つまずきポイント：URLを書いたのに404になる
>
> よくある原因は3つです。1つ目は、URLの先頭の /api の付け忘れです。2つ目は、prefix('v1') のグループの中でも /v1/hello と書いてしまい、実際のURLが /api/v1/v1/hello になっている場合です。3つ目はメソッドの違いで、この場合は404ではなく405が返ります。どの場合も、`sail artisan route:list --path=api` で実際に登録されているURLを確かめるのが近道です。

## 4.10 リクエストライフサイクル

リクエストがLaravelに届いてからレスポンスが返るまでの流れを、リクエストライフサイクルと呼びます。

1. Webサーバーが、すべてのリクエストを `public/index.php` に渡す
2. `bootstrap/app.php` でアプリが組み立てられる
3. 全体に共通するミドルウェア（CORSの処理など）を通る
4. ルーターがURLとメソッドから担当のルートを探す。見つからなければ404
5. ルートに付いたミドルウェア（認証、回数制限など）を通る
6. コントローラーが処理し、レスポンスを返す
7. レスポンスはミドルウェアを逆順にたどってクライアントへ返る

どこかで例外が起きると、その時点で例外処理の仕組みに引き継がれ、エラーのレスポンスに変換されます（第9章）。

## 4.11 ミドルウェア

ミドルウェアは、コントローラーの手前に置く「関所」です。条件を満たさないリクエストはここで止め、コントローラーまで届かせません。

```php
Route::middleware('auth:sanctum')->group(function () {
    // ここに書いたルートは、ログインしていないと401になる
});
```

`routes/api.php` のルートには、最初から `api` というミドルウェアグループが付いています。本書では、認証の `auth:sanctum`（第10章）と回数制限の `throttle`（第12章）を追加で使います。

## 4.12 Tinkerで試す

Tinkerは、Laravelのコードをその場で1行ずつ試せる道具です。

```bash
$ sail tinker
> now()->toIso8601String();
= "2026-11-03T02:00:00+00:00"
> config('app.name');
= "TaskBoard"
```

終了するときは `exit` と入力します。次章以降、モデルやデータベースの動きを確かめるときに便利です。

## AIに頼むなら

```text
routes/api.php の内容を貼り付けます。
各ルートのメソッド、実際のURL、呼び出されるコントローラーとメソッドを表にしてください。
（ファイルの内容を貼り付ける）
```

- AIの表と、`sail artisan route:list --path=api` の結果が一致するかを確かめる。prefix の付き方をAIが誤解していることがある

## まとめ

- `install:api` でAPI用のルートファイルとSanctumが用意される
- ルートでURLとメソッドを決め、処理はコントローラーに書く
- 連想配列を返すと自動でJSONになる
- ミドルウェアは、コントローラーの手前で共通のチェックをする関所

## 演習

1. 基礎：現在時刻をISO 8601形式で返す GET /api/v1/ping を、コントローラーを使って作ってください。
2. 応用：GET /api/v1/hello で lang（ja または en）を受け取り、日本語か英語のあいさつを返すようにしてください。それ以外の値が来たら422を返します。

解答例は付録Eにあります。

## レビュー観点

- [ ] ルートを prefix でまとめている
- [ ] 処理をルートファイルではなくコントローラーに書いている
- [ ] コントローラーのメソッドに戻り値の型がある
- [ ] 意図したとおりのステータスコードを返している

---

[← 第3章 Dockerで開発環境を作る](03-docker.md) ｜ [目次](../README.md#目次) ｜ [第5章 Web APIを設計する →](05-api-design.md)
