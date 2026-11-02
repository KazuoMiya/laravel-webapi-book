# 第10章 認証と認可

この章で、ユーザー登録、ログイン、ログアウトのAPIを作ります。さらに、ログインしたユーザーが自分のタスクだけを操作できるように、認可の仕組みをPolicyで整えます。

## この章のゴール

- トークン認証とSPA認証の違いと、使い分けを説明できる
- 登録、ログイン、ログアウトのAPIを実装できる
- Policyで認可のルールをまとめられる

## 10.1 認証と認可の違い

| 用語 | 確かめること | 失敗したとき |
| --- | --- | --- |
| 認証（Authentication） | あなたは誰か | 401 Unauthorized |
| 認可（Authorization） | あなたはそれをしてよいか | 403 Forbidden（本書では他人のタスクに404） |

認証が「入館証の確認」、認可が「その部屋に入る権限の確認」と考えると分かりやすいでしょう。

## 10.2 Sanctumの2つの方式

Laravel Sanctumには、2つの認証方式があります。

| 方式 | 仕組み | 向いている相手 |
| --- | --- | --- |
| APIトークン認証 | ログイン時に発行したトークンを、毎回 Authorization: Bearer ヘッダーで送る | スマートフォンアプリ、外部のシステム、IoTデバイス |
| SPA認証 | ログイン後はブラウザーのCookie（セッション）で認証する | 同じドメインで動く自分たちのブラウザー用アプリ |

Sanctumの公式ドキュメントは、自分たちのブラウザー用アプリ（SPA）にはAPIトークンではなくSPA認証を使うよう勧めています。トークンをブラウザーのJavaScriptから読める場所に保存すると、XSS（悪意のあるスクリプトの埋め込み）で盗まれる危険があるからです。SPA認証のCookieはJavaScriptから読めない設定で保存されます。

本書では両方を実装します。スマートフォンアプリはAPIトークン認証、ブラウザーのReactアプリはSPA認証を使います。どちらで認証したリクエストも、`auth:sanctum` で守られた同じAPIを使えます。

## 10.3 ユーザーを表すAPIリソース

```bash
$ sail artisan make:resource UserResource
```

```php
public function toArray(Request $request): array
{
    return [
        'id' => $this->id,
        'name' => $this->name,
        'email' => $this->email,
        'created_at' => $this->created_at?->toIso8601String(),
    ];
}
```

## 10.4 登録、ログイン、ログアウトのAPI

```bash
$ sail artisan make:controller Api/V1/AuthController
```

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class AuthController extends Controller
{
    // POST /api/v1/register
    public function register(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:50'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', Password::min(8)],
            'device_name' => ['sometimes', 'string', 'max:255'],
        ]);

        // passwordはモデルのcastsで自動的にハッシュ化される
        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => $validated['password'],
        ]);

        return response()->json([
            'data' => [
                'user' => new UserResource($user),
                'token' => $this->issueToken($user, $validated['device_name'] ?? 'api'),
            ],
        ], 201);
    }

    // POST /api/v1/login
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['required', 'string', 'max:255'],
        ]);

        $user = User::where('email', $validated['email'])->first();

        if (! $user || ! Hash::check($validated['password'], $user->password)) {
            // どちらが違うかは教えない（登録済みのメールアドレスを推測されないため）
            throw ValidationException::withMessages([
                'email' => [__('auth.failed')],
            ]);
        }

        return response()->json([
            'data' => [
                'user' => new UserResource($user),
                'token' => $this->issueToken($user, $validated['device_name']),
            ],
        ]);
    }

    // POST /api/v1/logout
    public function logout(Request $request): Response
    {
        $token = $request->user()->currentAccessToken();

        // SPA認証（Cookie）で呼ばれた場合は、消すべきトークンがない
        if (! $token instanceof PersonalAccessToken) {
            abort(400, 'このAPIはトークン認証用です。ブラウザーからは /logout を使ってください。');
        }

        // 今回のリクエストで使われたトークンだけを無効にする
        $token->delete();

        return response()->noContent();
    }

    // GET /api/v1/me
    public function me(Request $request): UserResource
    {
        return new UserResource($request->user());
    }

    private function issueToken(User $user, string $deviceName): string
    {
        // 有効期限30日のトークンを発行する
        return $user->createToken($deviceName, ['*'], now()->addDays(30))->plainTextToken;
    }
}
```

ポイントを確認します。

- パスワードはデータベースに平文で保存しません。Userモデルの casts で `'password' => 'hashed'` としているため、保存時に自動でハッシュ化されます。照合には `Hash::check` を使います。
- ログインに失敗したとき、「メールアドレスが違う」「パスワードが違う」を区別して返さないようにします。区別すると、そのメールアドレスが登録済みかどうかを第三者に知られてしまいます。
- トークンはデータベースにはハッシュ化して保存され、元の文字列（plainTextToken）は発行時の1回しか取り出せません。
- device\_name は、トークンを発行した端末の名前です。「どの端末からログイン中か」を一覧表示したり、端末ごとにログアウトさせたりするときに使えます。

logout では、トークンの実体を確かめてから削除しています。auth:sanctum はSPA認証のセッションも受け付けるので、ブラウザーからこのAPIが呼ばれると、currentAccessToken() はデータベースのトークンではなく、削除できない仮のトークン（TransientToken）を返すからです。確かめずに delete() を呼ぶと500になります。

`__('auth.failed')` は、言語ファイルのメッセージを取り出す関数です。`lang/ja/auth.php` を作って日本語にします。

```php
<?php

return [
    'failed' => 'メールアドレスまたはパスワードが正しくありません。',
];
```

## 10.5 ルートを追加する

```php
use App\Http\Controllers\Api\V1\AuthController;

Route::prefix('v1')->group(function () {
    // ログインしていなくても呼べるAPI
    Route::post('/register', [AuthController::class, 'register'])->name('register');
    Route::post('/login', [AuthController::class, 'login'])->name('login.token');

    // ログインが必要なAPI
    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout'])->name('logout.token');
        Route::get('/me', [AuthController::class, 'me'])->name('me');
        Route::apiResource('tasks', TaskController::class)->except(['update']);
        Route::patch('/tasks/{task}', [TaskController::class, 'update'])->name('tasks.update');
        Route::get('/tags', [TagController::class, 'index'])->name('tags.index');
    });
});
```

## 10.6 トークン認証を試す

```bash
# 登録
$ curl -X POST http://localhost/api/v1/register \
    -H "Content-Type: application/json" \
    -d '{"name":"花子","email":"hanako@example.com","password":"secret-pass","password_confirmation":"secret-pass","device_name":"curl"}'

# ログイン
$ curl -X POST http://localhost/api/v1/login \
    -H "Content-Type: application/json" \
    -d '{"email":"hanako@example.com","password":"secret-pass","device_name":"curl"}'
{"data":{"user":{"id":3,"name":"花子",...},"token":"5|xYz..."}}

$ TOKEN="5|xYz..."

# 自分の情報
$ curl http://localhost/api/v1/me -H "Authorization: Bearer $TOKEN"

# ログアウト後に同じトークンを使うと401になる
$ curl -X POST http://localhost/api/v1/logout -H "Authorization: Bearer $TOKEN"
$ curl -i http://localhost/api/v1/me -H "Authorization: Bearer $TOKEN"
HTTP/1.1 401 Unauthorized
```

期限切れのトークンは、データベースに残っていても使えません。たまった期限切れトークンは、第17章で定期実行の仕組みを使って削除します。

> 設計判断メモ：トークンの有効期限は30日にする
>
> 決めたこと：ログインで発行するトークンの有効期限を30日にする。
>
> 選ばなかった案：Sanctumの標準のまま、期限なしにする方法は、一度漏れると利用者が気づくまで使われ続ける。1時間ほどの短い期限と、期限を延ばすための別のトークン（リフレッシュトークン）を組み合わせる方法は安全性が高いが、仕組みが複雑になる。
>
> 理由：スマートフォンで毎回のログインを求めない便利さと、漏れたときに悪用される期間の短さの釣り合いを取った。
>
> 見直す条件：扱うデータの重要度が上がったとき（決済、個人情報など）。OAuth（Laravel Passport）による本格的な仕組みを検討する。

## 10.7 SPA認証を設定する

ブラウザーのReactアプリ（第15章）は、開発中は http://localhost:5173 で動かします。APIは http://localhost です。ポート番号は違いますが、どちらも localhost なので、Cookieを共有できます。

まず `bootstrap/app.php` で、自分たちのSPAからのリクエストにセッションを使えるようにします。

```php
->withMiddleware(function (Middleware $middleware): void {
    $middleware->statefulApi();
    $middleware->api(prepend: [
        ForceJsonResponse::class,
    ]);
})
```

`.env` に、SPAのドメインとセッションCookieのドメインを書きます。

```dotenv
SANCTUM_STATEFUL_DOMAINS=localhost:5173
SESSION_DOMAIN=localhost
```

次に、CORS（第12章で詳しく説明します）の設定ファイルを書き出し、別のポートからCookie付きで呼び出せるようにします。

```bash
$ sail artisan config:publish cors
```

```php
<?php
// config/cors.php

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie', 'login', 'logout'],
    'allowed_methods' => ['*'],
    'allowed_origins' => [env('FRONTEND_URL', 'http://localhost:5173')],
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    // 別のオリジンのJavaScriptから読めるようにする応答ヘッダー
    'exposed_headers' => ['Retry-After', 'ETag', 'X-Request-Id', 'Location', 'Idempotent-Replayed'],
    'max_age' => 0,
    'supports_credentials' => true,   // Cookieの送受信を許可する
];
```

SPA用のログインとログアウトは、セッションを扱う `routes/web.php` に作ります。

```bash
$ sail artisan make:controller SpaAuthController
```

```php
<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

class SpaAuthController extends Controller
{
    public function login(Request $request): UserResource
    {
        $credentials = $request->validate([
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
        ]);

        if (! Auth::attempt($credentials)) {
            throw ValidationException::withMessages([
                'email' => [__('auth.failed')],
            ]);
        }

        // ログインの前後でセッションIDを変える（セッション固定攻撃の対策）
        $request->session()->regenerate();

        return new UserResource($request->user());
    }

    public function logout(Request $request): Response
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }
}
```

```php
<?php
// routes/web.php

use App\Http\Controllers\SpaAuthController;
use Illuminate\Support\Facades\Route;

Route::post('/login', [SpaAuthController::class, 'login'])->name('login');
Route::post('/logout', [SpaAuthController::class, 'logout'])->name('logout');
```

SPA認証の流れは次のとおりです。

1. SPAが GET /sanctum/csrf-cookie を呼ぶ。LaravelがCSRF対策用のトークンをCookie（XSRF-TOKEN）で渡す
2. SPAが POST /login にメールアドレスとパスワードを送る。このとき XSRF-TOKEN の値を X-XSRF-TOKEN ヘッダーに入れる
3. ログインに成功すると、セッションのCookieが発行される
4. 以降、SPAは /api/v1/tasks などをCookie付きで呼ぶ。Sanctumがセッションを見てユーザーを特定する

CSRF（クロスサイトリクエストフォージェリ）は、利用者がログインしたまま悪意のあるサイトを開いたときに、勝手にリクエストを送らせる攻撃です。Cookieで認証する方式では、この対策が必須です。手順1と2のトークンがその対策で、axiosなどのライブラリは手順2のヘッダー付与を自動で行います。

APIトークンを使うスマートフォンアプリは、Cookieを使わないためCSRFの心配がありません。そのため /api/v1/login と /api/v1/logout はCSRF対策の対象外のままで問題ありません。

> つまずきポイント：401が返るときに確かめる順番
>
> 1. Authorization ヘッダーが付いているか
> 2. 「Bearer」の後にスペースが1つあり、その後にトークン全体（先頭の数字と縦棒を含む）が続いているか
> 3. トークンの有効期限が切れていないか
> 4. そのトークンでログアウトしていないか
> 5. SPA認証なら、Cookieとドメインの設定が正しいか（第15章）

## 10.8 Policyで認可を整理する

第8章では、持ち主の確認を `ensureOwner` という自作のメソッドで行いました。Laravelには、こうした「誰が何をしてよいか」をまとめる仕組みとしてPolicyがあります。

```bash
$ sail artisan make:policy TaskPolicy --model=Task
```

`app/Policies/TaskPolicy.php` を次のように書きます。使わないメソッドは削除してかまいません。

```php
<?php

namespace App\Policies;

use App\Models\Task;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class TaskPolicy
{
    public function view(User $user, Task $task): Response
    {
        return $this->owns($user, $task);
    }

    public function update(User $user, Task $task): Response
    {
        return $this->owns($user, $task);
    }

    public function delete(User $user, Task $task): Response
    {
        return $this->owns($user, $task);
    }

    private function owns(User $user, Task $task): Response
    {
        // 持ち主でなければ、403ではなく404として拒否する
        return $user->id === $task->user_id
            ? Response::allow()
            : Response::denyAsNotFound();
    }
}
```

`Response::denyAsNotFound()` は「拒否するが、404として応答する」という指定です。第5章で決めた「他人のタスクは存在しないものとして扱う」方針を、そのまま表現できます。

Policyは、`app/Policies` に「モデル名 + Policy」という名前で置くと自動で見つけてもらえます。コントローラーでは、`ensureOwner` の呼び出しを `Gate::authorize` に置き換え、`ensureOwner` メソッドは削除します。

```php
use Illuminate\Support\Facades\Gate;

public function show(Task $task): TaskResource
{
    Gate::authorize('view', $task);

    return new TaskResource($task->load('tags'));
}

public function update(UpdateTaskRequest $request, Task $task): TaskResource
{
    Gate::authorize('update', $task);
    // ...
}

public function destroy(Task $task): Response
{
    Gate::authorize('delete', $task);

    $task->delete();

    return response()->noContent();
}
```

認可のルールがPolicyに集まったので、「タスクを操作できるのは誰か」を知りたいときは、このファイルだけを読めば分かります。将来「チームのメンバーも閲覧できる」といったルールが加わっても、変更はPolicyの中で完結します。

## 10.9 トークンの権限（アビリティ）

APIトークンには、できることの範囲（アビリティ）を付けられます。たとえば、外部の集計システムに「読むだけ」のトークンを渡したい場合です。

```php
// 読み取り専用のトークンを発行する
$token = $user->createToken('report-system', ['tasks:read'])->plainTextToken;

// コントローラーやPolicyで確かめる
if ($request->user()->tokenCant('tasks:write')) {
    abort(403);
}
```

SPA認証でのリクエストでは、`tokenCan` は常に true を返します。そのため、アビリティの確認とPolicyの確認を組み合わせて使うのが基本です。

第16章では、このアビリティを使って、AIエージェント専用の、できることを絞ったトークンを発行します。

## AIに頼むなら

```text
AuthController の login メソッドを貼り付けます。セキュリティ上の問題がないかレビューしてください。
指摘には、根拠となるLaravelの公式ドキュメントの該当箇所も示してください。
（コードを貼り付ける）
```

- 指摘をうのみにせず、根拠のドキュメントを自分で読んで確かめる
- 認証の仕組みそのものをAIに一から書かせない。Sanctum、Hash、Authといった、Laravelの標準の機能を使う方針を守る

## まとめ

- 認証は「誰か」、認可は「してよいか」を確かめる
- スマートフォンや外部システムにはAPIトークン、自分たちのブラウザーアプリにはSPA認証を使う
- パスワードはハッシュ化して保存し、ログイン失敗の理由は詳しく返さない
- 認可のルールはPolicyにまとめ、他人のデータは `denyAsNotFound` で404にする

## 演習

1. 基礎：/api/v1/me の応答に、そのユーザーのタスクの件数 tasks\_count を加えてください（withCount を使います）。
2. 応用：ログイン中の端末の一覧を返す GET /api/v1/tokens と、端末ごとにログアウトさせる DELETE /api/v1/tokens/{id} を作ってください。他人のトークンは消せないようにします。

解答例は付録Eにあります。

## レビュー観点

- [ ] パスワードをハッシュ化して保存している
- [ ] ログインに失敗した理由を詳しく返していない
- [ ] トークンに有効期限がある
- [ ] 他人のデータへの操作をPolicyで拒否している
- [ ] SPA認証で、CSRF対策をしている

---

[← 第9章 入力検証とエラーハンドリング](09-validation-errors.md) ｜ [目次](../README.md#目次) ｜ [第11章 チームで共有する →](11-teams.md)
