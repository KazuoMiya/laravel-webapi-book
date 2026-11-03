# 第12章 Web APIのセキュリティ

Web APIはインターネットに公開された入り口です。この章では、APIでよく狙われる弱点と、Laravelでの対策を整理します。これまでの章ですでに対策済みのものも多いので、振り返りながら足りない部分を補います。

## この章のゴール

- APIの代表的な脆弱性と、その対策を説明できる
- CORSと回数制限を正しく設定できる
- 公開前のチェックリストで、設定の漏れを確かめられる

## 12.1 APIの代表的な脆弱性

セキュリティの国際的なコミュニティOWASPは、Web APIで特に多い脆弱性を「OWASP API Security Top 10」としてまとめています。2023年版の主な項目と、本書での対策を対応させると次のようになります。

| 脆弱性 | 内容 | 本書の対策 |
| --- | --- | --- |
| オブジェクトレベルの認可の不備 | IDを変えるだけで他人のデータを操作できる | Policyで持ち主を確認（第10章） |
| 認証の不備 | パスワードの総当たり、トークンの漏えい | ログインの回数制限、トークンの期限（本章、第10章） |
| プロパティレベルの認可の不備 | 見せてはいけない項目が見える、変えてはいけない項目を変えられる | APIリソース、#\[Hidden\]、#\[Fillable\]（本章） |
| リソースの無制限な消費 | 大量のリクエストや巨大な入力でサーバーを止める | 回数制限、件数や文字数の上限（本章、第9章） |
| 機能レベルの認可の不備 | 一般ユーザーが管理者用のAPIを呼べる | ルートごとのミドルウェアとPolicy |
| セキュリティ設定の不備 | デバッグ表示、緩すぎるCORS、HTTP通信 | APP\_DEBUG、CORS、HTTPS（本章） |
| APIの棚卸し不足 | 古いバージョンや試験用のAPIが放置される | バージョン管理と仕様書（第5章、第6章） |

このうち最も多く見つかるのが、最初の「オブジェクトレベルの認可の不備」です。第13章で、他人のタスクにアクセスできないことを自動テストで必ず確かめます。

## 12.2 CORS

ブラウザーには「同一オリジンポリシー」という安全のための制限があります。オリジンとは、スキーム（http）、ホスト（localhost）、ポート番号（5173）の組み合わせです。あるオリジンのページで動くJavaScriptは、原則として別のオリジンのAPIの応答を読めません。

CORS（Cross-Origin Resource Sharing）は、サーバーが「このオリジンからなら読んでよい」と許可を出す仕組みです。http://localhost:5173 のReactから http://localhost のAPIを呼ぶには、APIの側でこのオリジンを許可する必要があります。第10章で設定した `config/cors.php` がそれです。

PATCHやDELETEのようなメソッドを使うリクエスト、Content-Type が application/json のリクエスト、Authorization や X-XSRF-TOKEN のような独自のヘッダーを付けたリクエストでは、ブラウザーは本番のリクエストの前に、OPTIONSメソッドで「送ってよいか」を問い合わせます。Cookieを付けただけの単純なGETでは、この問い合わせは行われません。これをプリフライトリクエストと呼びます。Laravelは、このOPTIONSリクエストに自動で応答します。

CORSの設定で注意する点は次の3つです。

- allowed\_origins に `*`（すべて許可）を使わない。許可するオリジンを具体的に書く
- Cookieを使う場合（supports\_credentials が true）は、`*` を使うことはそもそもできない
- CORSはブラウザーを守る仕組みで、サーバーを守る仕組みではない。curlやスマートフォンアプリはCORSの影響を受けないので、認証と認可は必ず別に行う

もう1つ、別のオリジンのJavaScriptから読める応答ヘッダーは、標準ではごく一部に限られます。開発者ツールに表示されていても、画面のコードからは読めないことがあります。Retry-After や X-Request-Id を画面のコードで使うなら、config/cors.php の exposed\_headers に並べておきます（第10章の設定）。

本番では、`.env` の `FRONTEND_URL` に本番のフロントエンドのURLを設定します。

> つまずきポイント：curlでは動くのに、ブラウザーではCORSのエラーになる
>
> CORSはブラウザーだけが行う確認なので、curlでは起きません。ブラウザーの開発者ツールで、OPTIONSのリクエスト（プリフライト）の応答を確かめます。よくある原因は、allowed\_origins の値がスキームやポート番号まで正確に一致していない（http と https、5173 の付け忘れ）、Cookieを使うのに supports\_credentials が false のまま、設定を変えた後に `sail artisan config:clear` をしていない、の3つです。

## 12.3 回数制限（レート制限）

回数制限は、一定時間内に受け付けるリクエストの数を制限する仕組みです。パスワードの総当たり攻撃や、大量のリクエストによるサービス停止を防ぎます。

`app/Providers/AppServiceProvider.php` の `boot` メソッドで、制限のルールを定義します。

```php
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

public function boot(): void
{
    Model::preventLazyLoading(! $this->app->isProduction());

    // 通常のAPI：ログイン中はユーザーごと、未ログインはIPアドレスごとに1分60回
    RateLimiter::for('api', function (Request $request) {
        return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
    });

    // ログインと登録：アカウントごとに1分5回、IPアドレスごとに1分20回。どちらかを超えたら429
    RateLimiter::for('login', function (Request $request) {
        return [
            Limit::perMinute(5)->by('email:'.Str::lower((string) $request->input('email'))),
            Limit::perMinute(20)->by('ip:'.$request->ip()),
        ];
    });
}
```

ログインの制限は、2つの数え方を配列で返しています。アカウントごとの制限は、1つのアカウントのパスワードを、IPアドレスを変えながら試す攻撃を止めます。IPアドレスごとの制限は、1か所から多くのアカウントを順に試す攻撃を止めます。メールアドレスとIPアドレスの組で数えると、どちらか一方を変えるだけで数え直しになってしまいます。`by()` に渡す値の先頭に `email:` と `ip:` を付けているのは、2つの記録が混ざらないようにするためです。

ルートに `throttle` ミドルウェアで適用します。

```php
Route::prefix('v1')->middleware('throttle:api')->group(function () {
    Route::middleware('throttle:login')->group(function () {
        Route::post('/register', [AuthController::class, 'register'])->name('register');
        Route::post('/login', [AuthController::class, 'login'])->name('login.token');
    });

    Route::middleware('auth:sanctum')->group(function () {
        // ... 第10章と同じ
    });
});
```

SPA用の `routes/web.php` の /login にも、同じように `->middleware('throttle:login')` を付けておきましょう。

制限を超えると、429 Too Many Requests が返ります。応答のヘッダーには、使う側が調整に使える情報が入ります。

| ヘッダー | 意味 |
| --- | --- |
| X-RateLimit-Limit | 時間内に許可される回数 |
| X-RateLimit-Remaining | 残りの回数 |
| Retry-After | 何秒後に再試行してよいか（429のとき） |

回数の記録には、Laravelのキャッシュが使われます。サーバーを複数台に増やす場合は、全台で同じ記録を共有できるようにRedisを使います（第17章）。

> 設計判断メモ：回数制限の単位
>
> 決めたこと：通常のAPIは、ログイン中ならユーザーごと、未ログインならIPアドレスごとに数える。ログインと登録は、アカウントごと（1分5回）とIPアドレスごと（1分20回）の2つで数える。
>
> 選ばなかった案：IPアドレスだけで数える方法は、会社や学校のように多くの人が同じIPアドレスを使う場所で、無関係な人まで制限してしまう。トークンごとに数える方法は、1人がトークンをいくつも作れば制限をすり抜けられる。ログインをメールアドレスとIPアドレスの組で数える方法は、どちらか一方を変えれば数え直しになる。
>
> 理由：正しい利用者を巻き込まずに、攻撃や過剰なリクエストだけを止めやすい。アカウントごとの制限には、他人が間違ったパスワードを送り続けると本人も1分間ログインできなくなる副作用がある。1分で解けることと、総当たりを止める効果を比べて受け入れている。
>
> 見直す条件：第18章のように、429の分布を見て攻撃の傾向が変わったとき。

## 12.4 見せない項目、変えさせない項目

プロパティレベルの認可の不備には、2つの方向があります。

見せてはいけない項目が見える問題には、APIリソースで出力する項目を明示的に列挙して対策しています。モデルをそのまま返すと、将来テーブルに追加した列（社内用のメモなど）まで自動で公開されてしまいます。APIリソースなら、書いた項目しか出力されません。

変えてはいけない項目を変えられる問題（マスアサインメント）には、#\[Fillable\] で一括代入できる列を限定して対策しています。さらに、コントローラーでは `$request->all()` ではなく、検証を通った値（`$request->validated()`）だけを使います。検証ルールにない項目は validated() に含まれないので、二重の防御になります。

開発中は、Fillableにない項目を代入しようとしたときにエラーにすると、設定漏れに気づきやすくなります。

```php
// AppServiceProvider の boot() に追加
Model::preventSilentlyDiscardingAttributes($this->app->isLocal());
```

## 12.5 SQLインジェクション

SQLインジェクションは、入力値にSQLの一部を紛れ込ませ、意図しないSQLを実行させる攻撃です。Eloquentのメソッド（where など）に値を渡す限り、値は自動で安全に処理されます。

危険なのは、SQLの文字列を自分で組み立てるときです。

```php
// 危険：入力値をSQLに直接埋め込んでいる
$tasks = DB::select("SELECT * FROM tasks WHERE title = '{$request->input('title')}'");

// 安全：値は ? の位置に「バインド」して渡す
$tasks = DB::select('SELECT * FROM tasks WHERE title = ?', [$request->input('title')]);

// whereRaw や orderByRaw でも同じ
$query->whereRaw('YEAR(due_date) = ?', [$year]);
```

列名や並び順のように、バインドで渡せない部分は、第8章の並べ替えのように許可リストで確認します。

## 12.6 秘密情報の管理

- `.env` はGitに含めない。本番の値は、サーバーの環境変数やクラウドの秘密情報管理サービスで設定する
- APP\_KEY は暗号化とセッションの署名に使う鍵。漏れたら再発行する
- パスワードやトークンをログに出さない。リクエストの内容をログに残すときは、該当する項目を伏せる（第17章）
- APIトークンをURLのクエリ文字列に入れない。URLはサーバーのアクセスログやブラウザーの履歴に残るため、必ずAuthorizationヘッダーで送る

## 12.7 HTTPSと応答ヘッダー

APIトークンやCookieは、それ自体がログインの証明です。通信が暗号化されていないと、途中で盗み見られてそのまま悪用されます。本番環境では必ずHTTPSを使います。

HTTPSの終端をロードバランサーなどの前段で行う構成では、Laravelからは通信がHTTPに見えます。利用者のIPアドレスも、前段のサーバーのものに見えます。その場合は前段のサーバーを信頼する設定をして、前段が付ける X-Forwarded-For などのヘッダーから、本来の値を読めるようにします。あわせて、生成するURLを https にそろえます。

```php
// config/app.php に追加する
'trusted_proxies' => env('TRUSTED_PROXIES'),   // 例：10.0.0.0/8 や 10.0.1.5,10.0.1.6
```

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Support\Facades\URL;

public function boot(): void
{
    // ...12.3節の回数制限などはそのまま

    if ($this->app->isProduction()) {
        URL::forceScheme('https');
    }

    // 前段のサーバーだけを信頼する。未設定なら、どのプロキシも信頼しない
    if ($proxies = config('app.trusted_proxies')) {
        TrustProxies::at(array_map(trim(...), explode(',', $proxies)));
    }
}
```

信頼するのは、前段のサーバーのIPアドレスだけにします。`'*'`（すべてを信頼する）にすると、利用者が自分で X-Forwarded-For ヘッダーを付けるだけで、好きなIPアドレスになりすませます。12.3節のIPアドレスごとの回数制限も、リクエストのたびに別のIPアドレスを名乗ればすり抜けられてしまいます。開発環境のように前段のサーバーがないときは、`TRUSTED_PROXIES` を空のままにします。値を `.env` から直接 `env()` で読まず、config/app.php を通しているのは、`sail artisan config:cache` で設定をキャッシュした本番環境では、`env()` が `.env` の値を返さないためです。

あわせて、ブラウザーに安全な扱いを指示する応答ヘッダーを付けるミドルウェアを用意します。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // Content-Typeを推測させない
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        // 個人のデータをブラウザーや中継サーバーにキャッシュさせない
        $response->headers->set('Cache-Control', 'no-store');
        // HTTPSでの接続を1年間強制する（本番のみ）
        if (app()->isProduction()) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }
}
```

`bootstrap/app.php` の `$middleware->api(prepend: [...])` に、ForceJsonResponse と並べて登録します。

## 12.8 依存パッケージの脆弱性

LaravelやComposerのパッケージにも、脆弱性が見つかることがあります。既知の脆弱性がないかは、次のコマンドで確認できます。

```bash
$ sail composer audit
```

第13章で作るCIでもこのコマンドを実行し、定期的に確認します。Laravelのマイナーバージョンには互換性を壊す変更が含まれないので、`sail composer update` でこまめに更新しましょう。

## 12.9 公開前のチェックリスト

- [ ] APP\_ENV=production、APP\_DEBUG=false になっている
- [ ] すべての通信がHTTPSになっている
- [ ] CORSの allowed\_origins が本番のフロントエンドだけになっている
- [ ] ログインと登録に回数制限がかかっている
- [ ] 他人のデータにアクセスできないことを自動テストで確認している
- [ ] APIリソースで出力する項目を明示している
- [ ] トークンに有効期限がある
- [ ] `composer audit` で既知の脆弱性がない
- [ ] ログにパスワードやトークンが出ていない
- [ ] 開発用のドキュメント画面（/docs/api）が本番で公開されていない、または認可で守られている

## 12.10 チーム機能とAIエージェントへの備え

第11章のチーム機能と、第16章のAIエージェント向けの入り口には、それぞれ特有の注意点があります。

| 機能 | 危険 | 対策 |
| --- | --- | --- |
| チームのデータ | IDを変えると、別のチームのデータが見える | 問い合わせを `$team->tasks()` のようにチームから始め、Policyで役割を確かめる。第13章の権限テストで保証する |
| タスクの所属 | team\_id を書き換えて、タスクを別のチームへ移す | team\_id を #\[Fillable\] に入れず、リレーション経由でだけ設定する |
| 招待 | 招待コードの総当たりや漏えい | 長いランダムな値、ハッシュ化、有効期限、1回限りの使用、宛先の一致、招待APIの回数制限 |
| 担当者 | 別のチームのユーザーを担当者にして、情報を見せる | exists ルールで、同じチームのメンバーに限定する |
| エージェント用のトークン | 権限の広すぎるトークンや、REST APIでの悪用 | アビリティを絞り、期限を短くし、REST APIでは受け付けない |
| プロンプトインジェクション | タスクの文章に書かれた指示に、エージェントが従ってしまう | 取り返しのつかない操作をツールにしない。エージェントの操作をログに残す（第17章） |

どれも「自分の権限の範囲の外にあるデータや操作に、どうすれば届いてしまうか」を考えると見つけられる問題です。新しい機能を加えるたびに、この問いを繰り返しましょう。

## AIに頼むなら

```text
次のコントローラーとPolicyを、OWASP API Security Top 10 の観点でレビューしてください。
指摘ごとに、どの項目に当たるか、どう悪用されうるか、修正案を示してください。
（コードを貼り付ける）
```

- AIの指摘には誤検知もある。実際に悪用できるかを、テストを書いて確かめる
- 逆に、AIの「問題なし」でセキュリティの確認を終わらせない

## まとめ

- 最も多い脆弱性は「IDを変えると他人のデータが見える」問題。Policyとテストで防ぐ
- CORSはブラウザーのための仕組みで、認証と認可の代わりにはならない
- 回数制限で総当たり攻撃と過剰なリクエストを防ぐ
- 秘密情報はGitに入れず、トークンはヘッダーで、通信は必ずHTTPSで送る

## 演習

1. 基礎：12.9節のチェックリストを使い、自分の開発環境の設定を確かめてください。本番では値を変える必要がある項目を挙げましょう。
2. 応用：招待API（POST /api/v1/teams/{team}/invitations）に、チームごとに1時間20回までの回数制限をかけてください。

解答例は付録Eにあります。

## レビュー観点

- [ ] 自分やチームから始まる問い合わせで、他人のデータを取得できないようにしている
- [ ] CORSの許可を、具体的なオリジンに絞っている
- [ ] 信頼するプロキシを、前段のサーバーのIPアドレスに絞っている（`'*'` にしていない）
- [ ] ログイン、登録、招待に回数制限がある
- [ ] SQLの文字列に入力値を直接埋め込んでいない
- [ ] 秘密情報がGitやログに出ていない

---

[← 第11章 チームで共有する](11-teams.md) ｜ [目次](../README.md#目次) ｜ [第13章 自動テスト →](13-testing.md)
