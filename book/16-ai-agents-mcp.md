# 第16章 AIエージェントから使えるAPIにする

第14章では、AIは開発を手伝う側でした。この章では逆に、AIエージェントがTaskBoardを「使う側」になります。利用者が「明日までのタスクを教えて」「レポートを書くタスクを追加して」と話しかけると、AIエージェントがTaskBoardを操作する、という使い方です。

## この章のゴール

- MCPの役割と、REST APIとの違いを説明できる
- Laravel MCPでツールを公開し、Sanctumのトークンで保護できる
- AIエージェントに渡す操作と権限を、必要な分だけに絞って設計できる

## 16.1 MCPとは

MCP（Model Context Protocol）は、AIエージェントとアプリをつなぐための標準の約束事です。アプリは自分の機能を「ツール」として公開し、AIエージェントはツールの一覧と説明を読んで、必要なツールを選んで呼び出します。

| 項目 | REST API | MCP |
| --- | --- | --- |
| 主な利用者 | プログラムを書く開発者と、その画面 | AIエージェント |
| 操作の単位 | URLとメソッド | ツールの名前と引数 |
| 使い方の説明 | OpenAPIの仕様書（開発者が読む） | ツールの説明文と入力の形（AIが読んで判断する） |
| 認証 | トークンやCookie | トークン（本書ではSanctum）やOAuth |

MCPのツールは、REST APIの代わりではありません。同じアプリの機能を、AIエージェント向けの入り口からも使えるようにするものです。本書では、REST APIと同じモデルとルールを使いながら、MCP用の入り口を追加します。

## 16.2 エージェント向けの設計

AIエージェントは、人が書くプログラムと違って、指示を取り違えたり、思わぬ順番で操作したりすることがあります。そこで、公開する操作を慎重に選びます。

> 設計判断メモ：APIをそのまま公開せず、操作を絞る
>
> 決めたこと：個人のタスクの「一覧」「作成」「完了」の3つだけをツールとして公開する。削除とチームのタスクの操作は公開しない。
>
> 選ばなかった案：REST APIのすべての操作を、そのままツールにする。何でもできて便利だが、エージェントが指示を取り違えたときに、取り返しのつかない操作（削除や他人に関わる変更）が起きうる。ツールが多いほど、エージェントが選び間違える可能性も上がる。
>
> 理由：やり直しのきく操作だけを任せれば、エージェントが誤っても被害が小さく、利用者が自分で直せる。
>
> 見直す条件：操作の前に利用者の承認を求める仕組みが整ったとき、または利用者からの要望と利用状況のログで必要性が確かめられたとき。

ツールを作るときの原則は次のとおりです。

- 説明文を丁寧に書く。いつ使うツールか、何を返すか、注意点は何かを書く。AIはこの文章だけを頼りに使い方を判断する
- エラーメッセージには、次に何をすればよいかを書く。AIはそれを読んで引数を直し、もう一度試す
- 読み取り専用か、何度呼んでも同じ結果になるか（冪等か）といった性質を、注釈で明示する
- 返すデータは必要な項目だけにする。多すぎるとAIが扱いにくく、情報漏えいの範囲も広がる

## 16.3 Laravel MCPを入れる

Laravelには、MCPのサーバーを作るための公式パッケージ Laravel MCP があります。

```bash
$ sail composer require laravel/mcp
$ sail artisan vendor:publish --tag=ai-routes
$ sail artisan make:mcp-server TaskBoardServer
$ sail artisan make:mcp-tool ListTasksTool
$ sail artisan make:mcp-tool CreateTaskTool
$ sail artisan make:mcp-tool CompleteTaskTool
```

2つ目のコマンドで `routes/ai.php` が作られます。MCPサーバーは、このファイルに登録します。

`app/Mcp/Servers/TaskBoardServer.php` を書きます。サーバーの説明（Instructions）も、AIが読む大切な文章です。

```php
<?php

namespace App\Mcp\Servers;

use App\Mcp\Tools\CompleteTaskTool;
use App\Mcp\Tools\CreateTaskTool;
use App\Mcp\Tools\ListTasksTool;
use Laravel\Mcp\Server;
use Laravel\Mcp\Server\Attributes\Instructions;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Version;

#[Name('TaskBoard')]
#[Version('1.0.0')]
#[Instructions('ログイン中のユーザーの個人タスクを扱います。一覧、作成、完了ができます。削除と、チームのタスクの操作はできません。')]
class TaskBoardServer extends Server
{
    protected array $tools = [
        ListTasksTool::class,
        CreateTaskTool::class,
        CompleteTaskTool::class,
    ];
}
```

`routes/ai.php` に、Web経由で呼べるサーバーとして登録します。REST APIと同じく、Sanctumの認証と回数制限をかけます。

```php
<?php

use App\Mcp\Servers\TaskBoardServer;
use Laravel\Mcp\Facades\Mcp;

Mcp::web('/mcp/taskboard', TaskBoardServer::class)
    ->middleware(['auth:sanctum', 'throttle:mcp']);
```

回数制限の `mcp` は、第12章と同じく AppServiceProvider で定義します。

```php
RateLimiter::for('mcp', function (Request $request) {
    return Limit::perMinute(30)->by($request->user()?->id ?: $request->ip());
});
```

Laravel MCPは、OAuth 2.1（Laravel Passport）による認証にも対応しています。MCPの仕様ではOAuthが標準の認証方法とされ、対応しているAIクライアントも多いため、公式ドキュメントはPassportが使えるならそちらを勧めています。本書では、すでに使っているSanctumのトークンで進めます。OAuthにしか対応していないAIクライアントを使う必要が出たら、Passportへの切り替えを検討してください。

## 16.4 ツールを作る

タスクの一覧を返すツールです。クラス名から、ツール名は list-tasks になります。

```php
<?php

namespace App\Mcp\Tools;

use App\Models\Task;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('ログイン中のユーザーの個人タスクを、期限が近い順に最大20件返します。標準では未完了のタスクだけを返します。タスクのIDは complete-task で使います。')]
#[IsReadOnly]
class ListTasksTool extends Tool
{
    public function handle(Request $request): Response|ResponseFactory
    {
        if ($request->user()->tokenCant('tasks:read')) {
            return Response::error('このトークンにはタスクを読む権限がありません。');
        }

        $validated = $request->validate([
            'include_done' => ['sometimes', 'boolean'],
        ]);

        $tasks = $request->user()->tasks()
            ->whereNull('team_id')
            ->when(! ($validated['include_done'] ?? false), fn ($query) => $query->where('is_done', false))
            ->orderByRaw('due_date is null')   // 期限のないタスクは最後にする
            ->orderBy('due_date')
            ->limit(20)
            ->get();

        return Response::structured([
            'tasks' => $tasks->map(fn (Task $task) => [
                'id' => $task->id,
                'title' => $task->title,
                'due_date' => $task->due_date?->toDateString(),
                'priority' => $task->priority->key(),
                'is_done' => $task->is_done,
            ])->all(),
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'include_done' => $schema->boolean()
                ->description('完了済みのタスクも含めるときは true'),
        ];
    }
}
```

`Response::structured` は、AIが読み取りやすい構造化された結果（JSON）を返します。戻り値は Response ではなく ResponseFactory という型になるので、handle の戻り値の型を `Response|ResponseFactory` としています。権限がないときに返す `Response::error` は Response 型です。

`#[IsReadOnly]` は、このツールがデータを変更しないことを示す注釈です。AIクライアントは、読み取り専用のツールなら利用者の確認なしに呼ぶ、といった判断に使えます。

タスクを作るツールです。

```php
<?php

namespace App\Mcp\Tools;

use App\Enums\TaskPriority;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Validation\Rule;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;

#[Description('ログイン中のユーザーの個人タスクを1件作成し、作成したタスクを返します。同じ内容で2回呼ぶと、タスクが2件作られます。')]
class CreateTaskTool extends Tool
{
    public function handle(Request $request): Response|ResponseFactory
    {
        if ($request->user()->tokenCant('tasks:write')) {
            return Response::error('このトークンにはタスクを作成する権限がありません。');
        }

        // AIは、このメッセージを読んで引数を直す。次に何をすればよいかを書く
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:100'],
            'due_date' => ['nullable', 'date_format:Y-m-d'],
            'priority' => ['sometimes', Rule::in(TaskPriority::keys())],
        ], [
            'title.required' => 'title にタスクの内容を指定してください。例：レポートを書く',
            'title.max' => 'title は100文字以内にしてください。',
            'due_date.date_format' => 'due_date は 2026-11-20 のように YYYY-MM-DD の形式で指定してください。',
            'priority.in' => 'priority には low、medium、high のどれかを指定してください。',
        ]);

        if (isset($validated['priority'])) {
            $validated['priority'] = TaskPriority::fromKey($validated['priority']);
        }

        $task = $request->user()->tasks()->create($validated);

        return Response::structured([
            'id' => $task->id,
            'title' => $task->title,
            'due_date' => $task->due_date?->toDateString(),
            'priority' => $task->priority->key(),
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'title' => $schema->string()->description('タスクの内容（100文字以内）')->required(),
            'due_date' => $schema->string()->description('期限。YYYY-MM-DD の形式。期限がなければ省略する'),
            'priority' => $schema->string()->enum(['low', 'medium', 'high'])->description('優先度。省略すると medium'),
        ];
    }
}
```

タスクを完了にするツールです。すでに完了しているタスクに使っても結果が変わらないので、`#[IsIdempotent]`（冪等）の注釈を付けます。

```php
<?php

namespace App\Mcp\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;

#[Description('ログイン中のユーザーの個人タスクを完了にします。すでに完了しているタスクに使っても結果は変わりません。')]
#[IsIdempotent]
class CompleteTaskTool extends Tool
{
    public function handle(Request $request): Response
    {
        if ($request->user()->tokenCant('tasks:write')) {
            return Response::error('このトークンにはタスクを更新する権限がありません。');
        }

        $validated = $request->validate([
            'task_id' => ['required', 'integer'],
        ], [
            'task_id.required' => 'task_id に完了にするタスクのIDを指定してください。IDは list-tasks で調べられます。',
        ]);

        $task = $request->user()->tasks()->whereNull('team_id')->find($validated['task_id']);

        if ($task === null) {
            return Response::error('指定したIDのタスクが見つかりません。list-tasks で正しいIDを確かめてください。');
        }

        $task->update(['is_done' => true]);

        return Response::text("「{$task->title}」を完了にしました。");
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'task_id' => $schema->integer()->description('完了にするタスクのID')->required(),
        ];
    }
}
```

どのツールも、REST APIと同じく `$request->user()->tasks()` から問い合わせを始めています。入り口がMCPに変わっても、「自分のデータだけ」という原則は変わりません。

## 16.5 エージェント用のトークン

AIエージェントに、ログインで発行した何でもできるトークンを渡すのは危険です。第10章のアビリティを使い、エージェント専用の、できることを絞ったトークンを発行するAPIを作ります。

```bash
$ sail artisan make:controller Api/V1/AgentTokenController
```

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AgentTokenController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'abilities' => ['required', 'array', 'min:1'],
            'abilities.*' => [Rule::in(['tasks:read', 'tasks:write'])],
        ]);

        // agent はエージェント用のトークンであることの印
        $abilities = ['agent', ...$validated['abilities']];

        $token = $request->user()->createToken(
            'agent: '.$validated['name'],
            $abilities,
            now()->addDays(7),   // エージェント用は有効期限を短くする
        );

        return response()->json([
            'data' => [
                'token' => $token->plainTextToken,
                'abilities' => $abilities,
                'expires_at' => $token->accessToken->expires_at->toIso8601String(),
            ],
        ], 201);
    }
}
```

ここで1つ問題があります。エージェント用のトークンも Sanctum のトークンなので、そのままでは REST API（たとえばタスクの削除）にも使えてしまいます。そこで、エージェント用のトークンを REST API では受け付けないミドルウェアを作ります。

```bash
$ sail artisan make:middleware BlockAgentTokens
```

```php
public function handle(Request $request, Closure $next): Response
{
    $user = $request->user();

    // agent の印を持ち、何でもできる権限（*）を持たないトークンは、REST APIでは使わせない
    if ($user && $user->tokenCan('agent') && $user->tokenCant('*')) {
        abort(403, 'エージェント用のトークンでは、このAPIは使えません。');
    }

    return $next($request);
}
```

ログインで発行したトークンは、すべての権限（\*）を持っているので通過します。SPA認証のリクエストも、tokenCan が常に true を返すので通過します。`bootstrap/app.php` で別名を登録し、`routes/api.php` の `auth:sanctum` のグループに加えます。トークンを発行するルートもこのグループに置くので、エージェント用のトークンで新しいトークンを作ることもできません。

```php
// bootstrap/app.php の withMiddleware の中
$middleware->alias([
    'block-agent-tokens' => \App\Http\Middleware\BlockAgentTokens::class,
]);

// routes/api.php
Route::middleware(['auth:sanctum', 'block-agent-tokens'])->group(function () {
    // ... これまでのルート
    Route::post('/agent-tokens', [AgentTokenController::class, 'store'])->name('agent-tokens.store');
});
```

## 16.6 再試行による二重登録を減らす

AIエージェントや通信の不安定なスマートフォンは、応答が返ってこないと同じリクエストを送り直すことがあります。POSTは冪等ではないので、送り直すとタスクが2件できてしまいます。

これを減らすのが Idempotency-Key ヘッダーです。使う側は、操作ごとに一意な値（UUIDなど）をこのヘッダーに付けて送ります。サーバーは、同じ値のリクエストが来たら、処理をやり直さずに前回の応答を返します。決済サービスなどで広く使われている方法で、IETFでHTTPの標準として定める作業が進められている段階です（まだ確定した規格ではありません）。

本書では、対象を個人のタスクの作成（POST /api/v1/tasks）に絞ります。どのAPIにも一律にかけると、たとえば同じキーで送られたログアウトに、前回のタスク作成の応答を返してしまうからです。また、同じキーで違う内容が送られてきたら、前回の応答を返さずにエラーにします。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class EnsureIdempotency
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');

        if ($key === null) {
            return $next($request);
        }

        // 利用者、操作（メソッドとURL）、キーの組で記録する
        $scope = implode('|', [$request->user()->id, $request->method(), $request->path(), $key]);
        $cacheKey = 'idempotency:'.hash('sha256', $scope);

        // 入力の内容は「指紋」（ハッシュ値）にして一緒に残す
        $fingerprint = hash('sha256', $request->getContent());

        // 同じキーのリクエストが同時に来ても、1つずつ処理する
        return Cache::lock($cacheKey.':lock', 30)->block(10, function () use ($request, $next, $cacheKey, $fingerprint) {
            if ($saved = Cache::get($cacheKey)) {
                if ($saved['fingerprint'] !== $fingerprint) {
                    abort(422, '同じ Idempotency-Key で、違う内容のリクエストが送られました。新しいキーを使ってください。');
                }

                return response($saved['body'], $saved['status'], $saved['headers'])
                    ->header('Idempotent-Replayed', 'true');
            }

            $response = $next($request);

            // 成功した応答だけを24時間覚えておく
            if ($response->isSuccessful()) {
                Cache::put($cacheKey, [
                    'fingerprint' => $fingerprint,
                    'body' => $response->getContent(),
                    'status' => $response->getStatusCode(),
                    'headers' => array_filter([
                        'Content-Type' => $response->headers->get('Content-Type'),
                        'Location' => $response->headers->get('Location'),
                    ]),
                ], now()->addDay());
            }

            return $response;
        });
    }
}
```

ルートは、第8章の apiResource から store を外し、このミドルウェアを付けて登録し直します。キャッシュにはRedisを使います（第17章）。

```php
// bootstrap/app.php の withMiddleware の中
$middleware->alias([
    'block-agent-tokens' => \App\Http\Middleware\BlockAgentTokens::class,
    'idempotent' => \App\Http\Middleware\EnsureIdempotency::class,
]);

// routes/api.php（auth:sanctum のグループの中）
Route::apiResource('tasks', TaskController::class)->except(['store', 'update']);
Route::post('/tasks', [TaskController::class, 'store'])->middleware('idempotent')->name('tasks.store');
Route::patch('/tasks/{task}', [TaskController::class, 'update'])->name('tasks.update');
```

```bash
# 同じキーで2回送っても、タスクは1件だけ作られる
$ curl -i -X POST http://localhost/api/v1/tasks \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -H "Idempotency-Key: 0b6e2c1a-8f1d-4a57-9c1e-2f4f3a7d9b10" \
    -d '{"title":"請求書を送る"}'
```

2回目の応答には `Idempotent-Replayed: true` が付き、1回目と同じタスクが返ります。同じキーのままタイトルを変えて送ると、422になります。

この仕組みには限界もあります。

- タスクを保存した直後、応答をキャッシュに記録する前にサーバーが止まると、再試行でもう1件作られることがある。必ず1件にしたいなら、冪等キーを記録するテーブルを作り、タスクの保存と同じトランザクションの中で、一意の制約付きで記録する
- この仕組みはREST APIのタスク作成に対するもので、MCPの create-task には効かない。MCPのツールで再試行に備えるなら、ツールの引数で操作ごとのキーを受け取り、同じ考え方で記録する
- チームのタスクの作成に広げる場合は、前回の応答を返す前に、今もそのチームのメンバーかを確かめ直す必要がある

## 16.7 テストと動作確認

MCPのツールも、自動テストで確かめます。サーバーのクラスから、ツールを直接呼び出せます。

```php
<?php

namespace Tests\Feature\Mcp;

use App\Mcp\Servers\TaskBoardServer;
use App\Mcp\Tools\CreateTaskTool;
use App\Mcp\Tools\ListTasksTool;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskBoardServerTest extends TestCase
{
    use RefreshDatabase;

    public function test_list_tasks_returns_my_open_tasks(): void
    {
        $user = User::factory()->create();
        Task::factory()->for($user)->create(['title' => 'Buy milk']);
        Sanctum::actingAs($user, ['agent', 'tasks:read']);

        TaskBoardServer::actingAs($user)
            ->tool(ListTasksTool::class, [])
            ->assertOk()
            ->assertSee('Buy milk');
    }

    public function test_read_only_token_cannot_create_task(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['agent', 'tasks:read']);

        TaskBoardServer::actingAs($user)
            ->tool(CreateTaskTool::class, ['title' => 'Write report'])
            ->assertHasErrors();

        $this->assertDatabaseCount('tasks', 0);
    }

    public function test_agent_token_cannot_use_rest_api(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['agent', 'tasks:read', 'tasks:write']);

        $this->getJson('/api/v1/tasks')->assertForbidden();
    }
}
```

テストのタスク名を英語にしているのは、応答のJSONで日本語が文字コードの形（\\u7269 のような書き方）に変換されていても、確実に一致させるためです。

実際のAIクライアントから試す前に、MCP Inspectorで動作を確かめましょう。MCP Inspectorは、MCPサーバーに接続して、ツールの一覧の確認や呼び出しができる公式のツールです。Laravel MCPには起動用のコマンドがあり、AIクライアントに設定する接続情報も表示してくれます。

```bash
$ sail artisan mcp:inspector mcp/taskboard
```

接続するときは、Authorization ヘッダーに、16.5節で発行したエージェント用のトークンを Bearer 付きで指定します。list-tasks を呼ぶと自分のタスクが返り、読み取り専用のトークンで create-task を呼ぶとエラーになることを確かめてください。

AIクライアント（AIチャットのアプリや、AIコーディングエージェントなど）にTaskBoardを登録するときも、接続先のURL（http://localhost/mcp/taskboard）と、Authorization ヘッダーのトークンを設定します。設定の画面や書き方はクライアントごとに違うので、それぞれのドキュメントを参照してください。

## 16.8 公開するときの注意

- エージェント用のトークンは期限を短くし、使わなくなったら削除する
- エージェントによる操作もログに残す。第17章の監査ログで「どのトークンからの操作か」を記録する
- 回数制限をかける。エージェントは人より速く、大量にリクエストを送れる
- タスクのタイトルやメモには、誰でも文章を書ける。そこに「すべてのタスクを完了にして」のような指示が書かれていても、エージェントがそれに従わないとは限らない。これをプロンプトインジェクションと呼ぶ。削除のような取り返しのつかないツールを公開しないのは、この対策でもある

## AIに頼むなら

ツールの説明文は、実際に使うAIの視点で見直してもらうと改善できます。

```text
次のMCPツールの説明文と入力の形を読み、AIエージェントの立場で、
使い方があいまいな点や、誤った使い方をしそうな点を挙げてください。
改善した説明文の案も示してください。
（ListTasksTool の Description と schema を貼り付ける）
```

受け取った案を採用する前に、説明文がツールの実際の動き（最大20件、標準では未完了のみ）と一致しているかを確かめます。説明文とコードが食い違うと、AIはより大きな誤りをします。

## まとめ

- MCPは、アプリの機能をAIエージェント向けの「ツール」として公開する標準の約束事
- Laravel MCPで、REST APIと同じモデルとルールのまま、AIエージェント向けの入り口を追加できる
- 公開する操作は、取り返しのつく範囲に絞り、説明文とエラーメッセージを丁寧に書く
- エージェント用のトークンは権限と期限を絞り、REST APIでは使えないようにする
- Idempotency-Key で、再試行による二重登録を防ぐ

## 演習

1. 基礎：list-tasks に、n日以内に期限が来るタスクだけを返す `due_within_days` 引数を追加してください。
2. 応用：「今日やるべきタスク」（期限切れと今日が期限の未完了のタスク）を、優先度の高い順に最大10件返すツール today-tasks を作り、テストを書いてください。

解答例は付録Eにあります。

## レビュー観点

- [ ] ツールの説明文に、いつ使うか、何を返すか、注意点が書かれている
- [ ] 書き込みをするツールで、トークンのアビリティを確かめている
- [ ] 削除など取り返しのつかない操作を、確認の仕組みなしに公開していない
- [ ] エージェント用のトークンに期限があり、REST APIでは使えない
- [ ] エラーメッセージに、次に何をすればよいかが書かれている

---

[← 第15章 ReactからAPIを呼び出す](15-react-clients.md) ｜ [目次](../README.md#目次) ｜ [第17章 運用 →](17-operations.md)
