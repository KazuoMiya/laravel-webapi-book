# 付録

## 付録A HTTPステータスコード早見表

本書で使ったステータスコードと、TaskBoard APIで返す場面の一覧です。

| コード | 名前 | 意味 | TaskBoard APIで返す場面 |
| --- | --- | --- | --- |
| 200 | OK | 成功 | 一覧、詳細、更新、ログイン |
| 201 | Created | 作成した | 登録、タスクの作成（Locationヘッダー付き） |
| 204 | No Content | 成功、ボディなし | 削除、ログアウト |
| 304 | Not Modified | 前回から変わっていない | 本書では未使用（キャッシュの検証で使う） |
| 400 | Bad Request | リクエストの形が壊れている | JSONとして読めないボディ（第9章） |
| 401 | Unauthorized | 認証されていない | トークンなし、無効、期限切れ |
| 403 | Forbidden | 権限がない | トークンのアビリティ不足、権限の足りないチームのメンバー、エージェント用トークンでのREST API |
| 404 | Not Found | 見つからない | 存在しないURLやタスク、他人のタスク、メンバーでないチームのデータ、無効な招待コード |
| 405 | Method Not Allowed | メソッドが違う | URLはあるがメソッドが対応していない |
| 409 | Conflict | 今のデータの状態と矛盾する | すでにメンバーの人が招待を受けた |
| 412 | Precondition Failed | 指定した条件が合わない | If-Matchの版が古い（他の人が先に更新した） |
| 419 | （Laravel独自） | CSRFトークンの不一致 | SPA認証で /sanctum/csrf-cookie を呼んでいない |
| 422 | Unprocessable Content | 入力の内容に誤りがある | 入力検証の失敗、ログイン失敗、業務ルール違反 |
| 428 | Precondition Required | 条件付きのリクエストが必要 | チームのタスクの更新にIf-Matchがない |
| 429 | Too Many Requests | 回数制限を超えた | 回数制限（Retry-Afterヘッダー付き） |
| 500 | Internal Server Error | サーバー内部の誤り | プログラムの不具合 |
| 503 | Service Unavailable | 一時的に利用できない | メンテナンス中、過負荷 |

## 付録B よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| sail up -d、sail stop | 開発環境の起動、停止 |
| sail artisan route:list --path=api | APIのルート一覧 |
| sail artisan make:model 名前 -mf | モデル、マイグレーション、ファクトリーを作る |
| sail artisan make:controller 名前 --api | API用のコントローラーを作る |
| sail artisan make:request 名前 | フォームリクエストを作る |
| sail artisan make:resource 名前 | APIリソースを作る |
| sail artisan make:policy 名前 --model=モデル | Policyを作る |
| sail artisan make:test 名前 --phpunit | テストを作る |
| sail artisan migrate | マイグレーションを実行する |
| sail artisan migrate:fresh --seed | テーブルを作り直して初期データを入れる（開発のみ） |
| sail artisan tinker | 対話的にコードを試す |
| sail artisan pail | ログをリアルタイムに表示する |
| sail artisan config:clear | 設定のキャッシュを消す |
| sail artisan optimize | 設定、ルート、イベントをキャッシュする（本番） |
| sail artisan queue:work | キューのワーカーを起動する |
| sail artisan schedule:work | スケジューラーを動かす（開発） |
| sail test | テストを実行する |
| sail pint | コードを整形する |
| sail composer audit | 依存パッケージの脆弱性を確認する |
| sail artisan make:mcp-server 名前、make:mcp-tool 名前 | MCPのサーバーとツールを作る（第16章） |
| sail artisan mcp:inspector mcp/taskboard | MCP Inspectorで、MCPサーバーの動作を確かめる（第16章） |
| sail artisan boost:install | Laravel Boostを設定し、AIエージェントにプロジェクトの情報を渡す（第14章） |
| sail artisan model:prune | 古い監査ログなど、不要になった記録を削除する（第17章） |

## 付録C トラブルシューティング

| 症状 | 主な原因と対処 |
| --- | --- |
| Route \[login\] not defined というエラー | Acceptヘッダーなしで認証が必要なAPIを呼んだ。第9章の ForceJsonResponse を登録する |
| SQLSTATE\[HY000\] \[2002\] Connection refused | DB\_HOST が mysql になっていない、またはMySQLのコンテナーが起動していない。`sail ps` で確認する |
| Target class \[...\] does not exist | use 文やクラス名、名前空間の書き間違い。ファイルの場所と namespace が一致しているか確認する |
| Attempted to lazy load \[tags\] | with を書き忘れたN+1問題を、第7章の設定が検出した。with('tags') を追加する |
| Add \[user\_id\] to fillable property | #\[Fillable\] にない列を一括代入しようとした。user\_id はリレーション経由で設定する |
| .env を変えても反映されない | 設定がキャッシュされている。`sail artisan config:clear` を実行する |
| 本番で env() が null を返す | 設定のキャッシュ後は .env ファイルが読み込まれない。値は環境変数として渡し、config/ のファイル経由で読む |
| 419 Page Expired（SPA） | CSRFトークンの不一致。第15章の手順と設定を確認する |
| CORSのエラー（ブラウザー） | config/cors.php の allowed\_origins と supports\_credentials を確認する |
| テストが開発用のデータを消した | phpunit.xml の DB\_DATABASE が testing になっているか確認する |
| 412 Precondition Failed が返る | 取得した後に、他の人が先に更新した。最新の内容を取得し、新しい version で If-Match を送り直す（第11章） |
| 428 Precondition Required が返る | チームのタスクの更新に If-Match を付けていない（第11章） |
| エージェント用のトークンでは、このAPIは使えません | REST APIにエージェント用のトークンを使っている。MCPの入り口から使う（第16章） |
| /tasks/summary のような固定のURLが404になる | apiResource より後に書いている。固定の文字列のURLを先に書く（第14章） |
| /up は200なのに、APIがすべて500になる | Redisやデータベースが止まっている。/up で依存するサービスも確かめるようにする（第18章） |

## 付録D 用語集

| 用語 | 意味 |
| --- | --- |
| API | Application Programming Interface。プログラム同士が機能を呼び出し合うための約束事 |
| エンドポイント | APIの呼び出し先。メソッドとURLの組み合わせ |
| リソース | APIが扱う対象。タスク、ユーザーなど |
| ステートレス | サーバーが前のリクエストの内容を覚えていないこと |
| 冪等 | 同じリクエストを何回送っても結果が変わらない性質 |
| ペイロード | リクエストやレスポンスのボディに入るデータ |
| ORM | テーブルの行をプログラムのオブジェクトとして扱う仕組み。LaravelではEloquent |
| マイグレーション | テーブルの設計図をコードで管理する仕組み |
| ミドルウェア | コントローラーの前後で共通の処理をする部品 |
| トークン | ログインの証明となる文字列 |
| CORS | 別のオリジンからのブラウザーのアクセスを、サーバーが許可する仕組み |
| CSRF | ログイン中の利用者に、意図しないリクエストを送らせる攻撃 |
| XSS | 悪意のあるスクリプトをページに埋め込む攻撃。保存されたトークンを盗まれる危険がある |
| レート制限 | 一定時間内のリクエスト数を制限すること |
| CI | 変更のたびにテストなどを自動で実行する仕組み |
| デプロイ | 新しいバージョンを本番環境に出すこと |
| MCP | Model Context Protocol。AIエージェントがアプリの機能を「ツール」として呼び出すための標準の約束事 |
| ETag、If-Match | データの版を表す値と、「その版のときだけ更新して」という条件。同時編集の衝突を見つけるのに使う |
| 冪等キー（Idempotency-Key） | 同じ操作の送り直しを見分けるために、使う側がリクエストに付ける一意の値 |
| 監査ログ | 誰が、いつ、何をしたかの記録 |
| プロンプトインジェクション | AIが読む文章に指示を紛れ込ませ、AIに意図しない操作をさせる攻撃 |
| ふりかえり（ポストモーテム） | 障害の後に、原因と再発防止策を、人ではなく仕組みの観点でまとめる文書 |

## 付録E 演習の解答例

解答例は、考え方を確かめるための一例です。設計に関する問題には、ほかにも正しい答えがあります。自分の答えと違ったら、どちらの案にどんな利点があるかを考えてみてください。それ自体が設計判断の練習になります。

### 第1章

1. 404 Not Found が返り、ボディには「見つからない」ことを示すJSONが入ります。1.4節の表の4xx（クライアント側の誤り）に当たります。ボディの項目は、GitHubのAPIが独自に決めたものです。
2. GitHubのREST APIを選んだ場合の例です。名詞のURLとメソッドの組み合わせになっており、作成には201を返すなど、RESTらしい設計になっています。

| 操作 | メソッド | URL | 成功時 |
| --- | --- | --- | --- |
| ユーザーのリポジトリの一覧 | GET | /users/{username}/repos | 200 |
| Issueの作成 | POST | /repos/{owner}/{repo}/issues | 201 |
| Issueの更新 | PATCH | /repos/{owner}/{repo}/issues/{issue\_number} | 200 |

### 第2章

1.

```php
function formatTask(string $title, int $priority): string
{
    $label = match ($priority) {
        3 => '高',
        2 => '中',
        default => '低',
    };

    return "[{$label}] {$title}";
}
```

2.

```php
public function label(): string
{
    return match ($this) {
        self::Low => '低',
        self::Medium => '中',
        self::High => '高',
    };
}
```

### 第3章

1. MySQLのデータは、compose.yaml で指定したボリューム（sail-mysql）に保存されています。sail stop で止まるのはコンテナーだけで、ボリュームは残るので、マイグレーションの記録も消えません。ボリュームまで消すのは `docker compose down -v` のように、明示的に削除したときです。
2. `sail artisan sail:add` で mailpit を選び、`sail up -d` で起動し直します。.env の MAIL\_MAILER が smtp、MAIL\_HOST が mailpit、MAIL\_PORT が 1025 になっているかを確かめてから、http://localhost:8025 を開きます。

### 第4章

1. `sail artisan make:controller Api/V1/PingController --invokable` で作ります。メソッドが1つだけのコントローラーです。

```php
public function __invoke(): JsonResponse
{
    return response()->json(['now' => now()->toIso8601String()]);
}

// routes/api.php の v1 のグループの中
Route::get('/ping', PingController::class);
```

2.

```php
public function index(Request $request): JsonResponse
{
    $validated = $request->validate([
        'lang' => ['sometimes', 'in:ja,en'],
    ]);

    $message = ($validated['lang'] ?? 'ja') === 'en' ? 'Hello' : 'こんにちは';

    return response()->json(['message' => $message]);
}
```

### 第5章

1. 例：POST /api/v1/tasks/{task}/copies とし、「複製」というリソースを新しく作る操作と捉えます。成功時は201を返し、新しいタスクのURLをLocationヘッダーに入れます。既存のタスクは変更しないので、PATCHは使いません。元のタスクのIDを送って POST /api/v1/tasks で作る設計もありえます。
2. 例：

| メソッドとURL | 内容 | 成功時 |
| --- | --- | --- |
| GET /api/v1/tasks/{task}/comments | コメントの一覧 | 200 |
| POST /api/v1/tasks/{task}/comments | コメントの作成 | 201 |
| PATCH /api/v1/comments/{comment} | 本人だけが更新できる | 200 |
| DELETE /api/v1/comments/{comment} | 本人だけが削除できる | 204 |

コメント単体の操作は /comments/{comment} にして、階層を浅く保ちます。タスクを見られない人には404、タスクは見えるが他人のコメントを変えようとした人には403を返します。レスポンスは `{"data": {"id": 1, "body": "...", "author": {"id": 3, "name": "太郎"}, "created_at": "..."}}` のような形にします。

### 第6章

1.

```yaml
  /tags:
    get:
      tags: [タスク]
      summary: 自分のタグの一覧を取得する
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items: { $ref: '#/components/schemas/Tag' }
        '401': { $ref: '#/components/responses/Unauthorized' }
```

2. /teams/{team}/tasks に get と post を追加し、/tasks/{task} の patch に次の記述を加えます。

```yaml
      parameters:
        - name: If-Match
          in: header
          required: false
          description: チームのタスクでは必須。取得したときの ETag（例："v3"）
          schema: { type: string }
      responses:
        '412':
          description: 他の人が先に更新した
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
        '428':
          description: If-Match がない（チームのタスクのみ）
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
```

### 第7章

1.

```php
public function overdue(): static
{
    return $this->state(fn () => [
        'due_date' => now()->subDays(fake()->numberBetween(1, 10))->toDateString(),
        'is_done' => false,
    ]);
}
```

2. 新しいマイグレーションで `$table->timestamp('completed_at')->nullable()->after('is_done');` を追加し、down で `dropColumn('completed_at')` します。completed\_at は利用者に送らせず、サーバーで決める値なので #\[Fillable\] には入れません。casts に `'completed_at' => 'datetime'` を加え、モデルの booted で次のように記録します。

```php
static::saving(function (Task $task) {
    if ($task->isDirty('is_done')) {
        $task->completed_at = $task->is_done ? now() : null;
    }
});
```

TaskResource にも completed\_at を追加します。

### 第8章

1. total は条件に合う件数、per\_page は1ページの件数（5）、last\_page は total を per\_page で割って切り上げた値です。たとえば total が12なら、last\_page は3になります。
2. 入力の検証に `'overdue' => ['sometimes', 'in:true,false,1,0']` を加え、絞り込みに次の条件を加えます（第11章以降はモデルのスコープに加えます）。

```php
->when($request->boolean('overdue'), fn ($query) => $query
    ->where('is_done', false)
    ->whereDate('due_date', '<', today()))
```

### 第9章

1. `'after_or_equal' => ':attributeは:date以降の日付を指定してください。',`
2. StoreTaskRequest の due\_date を `['nullable', 'date_format:Y-m-d', 'after_or_equal:today']` にします。UpdateTaskRequest では due\_date のルールを上書きしているので、更新時は過去の日付も通ります。更新で許す理由は、期限を過ぎたタスクのメモだけを直すときに、画面が元の期限も一緒に送ってくることがあるからです。そのとき422になると、利用者は何も直せなくなります。

### 第10章

1. me を `return new UserResource($request->user()->loadCount('tasks'));` にし、UserResource に `'tasks_count' => $this->whenCounted('tasks'),` を加えます。
2.

```php
use Laravel\Sanctum\PersonalAccessToken;

// GET /api/v1/tokens
public function index(Request $request): JsonResponse
{
    $current = $request->user()->currentAccessToken();

    $tokens = $request->user()->tokens()->latest()->get()->map(fn (PersonalAccessToken $token) => [
        'id' => $token->id,
        'name' => $token->name,
        'last_used_at' => $token->last_used_at?->toIso8601String(),
        'is_current' => $current instanceof PersonalAccessToken && $current->id === $token->id,
    ]);

    return response()->json(['data' => $tokens]);
}

// DELETE /api/v1/tokens/{id}
public function destroy(Request $request, int $id): Response
{
    // 自分のトークンの中から探すので、他人のトークンのIDを指定しても404になる
    $request->user()->tokens()->whereKey($id)->firstOrFail()->delete();

    return response()->noContent();
}
```

### 第11章

1. IndexTaskRequest に `'assignee' => ['sometimes', 'in:me']` を加え、TeamTaskController の index に次の条件を加えます。

```php
->when($request->query('assignee') === 'me',
    fn ($query) => $query->where('assignee_id', $request->user()->id))
```

2. TeamRole に `case Guest = 'guest';` を加えます。本文の canWriteTasks は許す役割を並べて書いているので、Guest を足しても作成の権限は付きません。TaskPolicy では、Guest を次のように扱います。11.1節の表には「ゲスト：自分が担当のタスクの閲覧と更新だけ。作成と削除はできない」の行を足します。

```php
// view と update の中で、役割を取得した後に
if ($role === TeamRole::Guest) {
    return $task->assignee_id === $user->id
        ? Response::allow()
        : Response::denyAsNotFound();   // ゲストには担当外のタスクは見えない
}

// delete は update に任せきりにせず、ゲストを先に判定する
public function delete(User $user, Task $task): Response
{
    if ($task->team_id !== null && $this->roleIn($user, $task) === TeamRole::Guest) {
        return $task->assignee_id === $user->id
            ? Response::deny('ゲストはタスクを削除できません。')
            : Response::denyAsNotFound();
    }

    return $this->update($user, $task);
}
```

あわせて、TeamTaskController の index で、ゲストのときは `where('assignee_id', $request->user()->id)` を加え、一覧にも担当のタスクだけが出るようにします。招待とメンバーの役割変更の検証ルール（Rule::in）に guest を加えることも忘れないでください。テストでは、ゲストの「作成は403、担当のタスクの閲覧と更新は200、削除は403、担当外は404」を確かめます。

### 第12章

1. 例：APP\_ENV（local から production）、APP\_DEBUG（true から false）、APP\_URL と FRONTEND\_URL（本番のURL）、SANCTUM\_STATEFUL\_DOMAINS と SESSION\_DOMAIN（本番のドメイン）、LOG\_CHANNEL（stderr）、CACHE\_STORE と QUEUE\_CONNECTION（redis）、データベースとRedisの接続情報。
2.

```php
// AppServiceProvider の boot()
RateLimiter::for('invitations', function (Request $request) {
    // 回数制限の時点では、{team} がまだモデルになっていないことがある
    $team = $request->route('team');
    $teamId = $team instanceof Team ? $team->id : $team;

    return Limit::perHour(20)->by('team:'.$teamId);
});

// routes/api.php
Route::post('/teams/{team}/invitations', [TeamInvitationController::class, 'store'])
    ->middleware('throttle:invitations')
    ->name('teams.invitations.store');
```

### 第13章

1.

```php
public function test_tasks_can_be_sorted_by_priority(): void
{
    $user = User::factory()->create();
    Task::factory()->for($user)->create(['title' => 'low', 'priority' => TaskPriority::Low]);
    Task::factory()->for($user)->create(['title' => 'high', 'priority' => TaskPriority::High]);
    Task::factory()->for($user)->create(['title' => 'medium', 'priority' => TaskPriority::Medium]);
    Sanctum::actingAs($user);

    $this->getJson('/api/v1/tasks?sort=-priority')
        ->assertOk()
        ->assertJsonPath('data.0.title', 'high')
        ->assertJsonPath('data.1.title', 'medium')
        ->assertJsonPath('data.2.title', 'low');
}
```

2.

```php
public static function manageTeamProvider(): array
{
    // 役割、名前の変更、招待、削除の期待するステータス
    return [
        'owner' => [TeamRole::Owner, 200, 201, 204],
        'admin' => [TeamRole::Admin, 200, 201, 403],
        'member' => [TeamRole::Member, 403, 403, 403],
        'viewer' => [TeamRole::Viewer, 403, 403, 403],
    ];
}

#[DataProvider('manageTeamProvider')]
public function test_managing_team_depends_on_role(TeamRole $role, int $rename, int $invite, int $delete): void
{
    $team = Team::factory()->create();
    Sanctum::actingAs($this->memberOf($team, $role));

    $this->patchJson("/api/v1/teams/{$team->id}", ['name' => '新しい名前'])->assertStatus($rename);
    $this->postJson("/api/v1/teams/{$team->id}/invitations", ['email' => 'new@example.com', 'role' => 'member'])
        ->assertStatus($invite);
    $this->deleteJson("/api/v1/teams/{$team->id}")->assertStatus($delete);
}
```

テスト中のメールは、phpunit.xml の設定（MAIL\_MAILER が array）により、実際には送られません。

### 第14章

1. 例：「チームのタスクを更新するAPIでは If-Match ヘッダーを必須にし、版が合わなければ412、ヘッダーがなければ428を返す」
2. 問題点は次のとおりです。修正版は、11.9節の TeamMemberController の update です。

- 認可がない。メンバーでない人や、viewer でも役割を変えられる
- 入力を検証していない。存在しない役割や、owner への変更も通ってしまう
- オーナーの役割も変えられてしまう
- `$request->all()` をそのまま中間テーブルに渡しているので、role 以外の項目まで書き換えられ、存在しない列ならエラーになる
- 指定したユーザーがメンバーでなくても、エラーにならず成功したように見える
- APIリソースを通さずに返しているので、ユーザーのすべての項目がそのまま出る

### 第15章

1.

```jsx
const [priority, setPriority] = useState('');

// loadTasks の params に加え、useEffect の依存にも priority を加える
const params = { sort: '-created_at', page, ...(priority ? { priority } : {}) };

<select value={priority} onChange={(e) => setPriority(e.target.value)}>
  <option value="">すべての優先度</option>
  <option value="high">高</option>
  <option value="medium">中</option>
  <option value="low">低</option>
</select>
```

2. 方針の例です。編集中の内容を `draft` という状態に持っておき、412が返ったら GET /api/v1/tasks/{id} で最新の内容を取得します。画面には最新の内容と自分の変更を並べて表示し、利用者が「この内容で保存」を押したら、最新の version を If-Match に入れて送り直します。自動で送り直さないことが大切です。

### 第16章

1. 検証に `'due_within_days' => ['sometimes', 'integer', 'between:1,365']` を加え、問い合わせに次の条件を加えます。schema にも `$schema->integer()->description('この日数以内に期限が来るタスクだけを返す')` を加えます。

```php
->when(isset($validated['due_within_days']), fn ($query) => $query
    ->whereNotNull('due_date')
    ->whereDate('due_date', '<=', today()->addDays($validated['due_within_days'])))
```

2.

```php
#[Description('今日やるべきタスク（期限切れと、今日が期限の未完了のタスク）を、優先度の高い順に最大10件返します。')]
#[IsReadOnly]
class TodayTasksTool extends Tool
{
    public function handle(Request $request): Response
    {
        if ($request->user()->tokenCant('tasks:read')) {
            return Response::error('このトークンにはタスクを読む権限がありません。');
        }

        $tasks = $request->user()->tasks()
            ->whereNull('team_id')
            ->where('is_done', false)
            ->whereDate('due_date', '<=', today())
            ->orderByDesc('priority')
            ->orderBy('due_date')
            ->limit(10)
            ->get();

        return Response::structured([
            'tasks' => $tasks->map(fn (Task $task) => [
                'id' => $task->id,
                'title' => $task->title,
                'due_date' => $task->due_date->toDateString(),
                'priority' => $task->priority->key(),
            ])->all(),
        ]);
    }
}
```

サーバーの $tools に加え、テストでは `travelTo` で今日を固定して、期限切れ、今日、明日のタスクを作り、明日のタスクが含まれないことを確かめます。

### 第17章

1.

```php
public function test_tag_cache_is_cleared_when_tags_change(): void
{
    Sanctum::actingAs(User::factory()->create());

    $task = $this->postJson('/api/v1/tasks', ['title' => 'a', 'tags' => ['仕事']])->json('data');
    $this->getJson('/api/v1/tags')->assertJsonCount(1, 'data');   // ここでキャッシュされる

    $this->patchJson("/api/v1/tasks/{$task['id']}", ['tags' => ['仕事', '急ぎ']])->assertOk();
    $this->getJson('/api/v1/tags')->assertJsonCount(2, 'data');   // 古いキャッシュが使われていない
}
```

2. 検証に `'action' => ['sometimes', 'string', 'max:50']`、`'from' => ['sometimes', 'date_format:Y-m-d']`、`'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from']` を加え、問い合わせには when で、action の一致と、created\_at の範囲の条件を加えます。期間は whereDate を使わずに、「created\_at が from の0時以上、to の翌日の0時より前」という範囲で指定すると、インデックス（team\_id、created\_at）を使いやすくなります。実際に使われるかどうかは、対象のMySQLで EXPLAIN を実行して確かめてください。

### 第18章

1. 例：送信元のIPアドレスの数と偏り、試されているメールアドレスの数（同じアドレスばかりか、多数か）、User-Agent（アプリのバージョン）、リクエストの時刻の間隔（機械的に等間隔か）。
2. シナリオ1の例です。概要「11月20日、デプロイ後にタスクの保存が失敗した」、影響「10時05分から10時25分、保存を試みた約300人」、原因「新しい設定値 MAIL\_FOOTER を、本番の環境変数に追加し忘れた。必要な環境変数を起動時に確かめる仕組みがなかった」、対応「10時12分に切り戻し、修正版を14時にデプロイ」、再発防止策「entrypoint.sh の必須の環境変数の確認に MAIL\_FOOTER を追加（担当：山田、期限：11月27日）」のように、18.8節のひな形を埋めます。

## 付録F 研修カリキュラムの例

10日間の新人研修を想定した目安です。1日の後半は、その日の章の演習とコードレビューに充てます。受講者の経験に合わせて予備日を設け、Reactが初めての受講者には、第15章の前にReactの基本を学ぶ時間を取ってください。週1回の勉強会なら、1回に1〜2章ずつ進めて約12回で終えられます。

| 日 | 章 | 到達目標 | 成果物 |
| --- | --- | --- | --- |
| 1日目 | はじめに、第1章、第2章 | HTTPの仕組みとPHPの基本を説明できる | curlの実行結果、PHPの小さなプログラム |
| 2日目 | 第3章、第4章 | 開発環境を作り、最初のAPIを動かせる | 動く /api/v1/hello |
| 3日目 | 第5章、第6章 | 要件からAPIを設計し、仕様書に書ける | コメント機能の設計と仕様書 |
| 4日目 | 第7章、第8章 | テーブルとCRUDのAPIを作れる | タスクのAPI |
| 5日目 | 第9章、第10章 | 入力検証と認証を組み込める | ログイン付きのAPI |
| 6日目 | 第11章 | 役割に応じた権限を実装できる | チーム機能 |
| 7日目 | 第12章、第13章 | 脆弱性を説明し、テストで守れる | 権限のテスト、CIの設定 |
| 8日目 | 第14章、第15章 | AIを使って開発し、生成されたコードをレビューできる | レビューの記録、Reactの画面 |
| 9日目 | 第16章、第17章 | AIエージェントに公開し、運用の準備ができる | MCPサーバー、本番用のイメージ |
| 10日目 | 第18章、成果発表 | 障害に対応し、ふりかえりを書ける | ふりかえりの文書、発表 |

進め方のこつは3つあります。設計判断メモは、結論を読む前に「自分ならどうするか」を数分考えさせ、グループで意見を出し合ってから本文を読むと、判断の観点が身につきます。演習の応用問題は、ペアで取り組み、相手のコードを章末のレビュー観点でレビューさせます。第18章は、講師が症状だけを伝え、受講者に調べ方を考えさせます。

## 付録G 評価の観点

研修の評価や、コードレビューの基準に使える観点です。各章末のレビュー観点が、それぞれの具体的なチェック項目になります。

| 観点 | 合格の目安 |
| --- | --- |
| 設計の説明 | URLとステータスコードを選んだ理由を、選ばなかった案と比べて説明できる |
| 認可の確実さ | 他人や他のチームのデータに触れられないことを、テストで示せる |
| 入力検証 | 想定外の入力を送っても500にならず、422で理由を返せる |
| テスト | 正常な場合、入力の誤り、権限の組み合わせをテストしている |
| 運用の視点 | ログとリクエストIDから、障害の原因を絞り込める |
| AIの使い方 | AIが生成したコードの誤りや危険な箇所を指摘できる |

## 参考資料

本書の内容は、2026年11月時点の次の公式ドキュメントなどをもとに確認しました。最新の情報は各ページを参照してください。

- [Laravel 13.x Release Notes](https://laravel.com/docs/13.x/releases.md)（バージョンとサポート期間）
- [Laravel 13.x Installation](https://laravel.com/docs/13.x/installation)
- [Laravel 13.x Laravel Sail](https://laravel.com/docs/13.x/sail)（Sailの標準PHPは8.5）
- [Laravel Sail の MySQL 設定（GitHub）](https://github.com/laravel/sail/blob/1.x/stubs/mysql.stub)（MySQL 8.4）
- [Laravel 13.x Routing](https://laravel.com/docs/13.x/routing)（install:api、回数制限、CORS）
- [Laravel 13.x Sanctum](https://laravel.com/docs/13.x/sanctum)（トークン認証、SPA認証）
- [Laravel 13.x Eloquent](https://laravel.com/docs/13.x/eloquent)（#\[Fillable\] などのアトリビュート）
- [Laravel 13 の User モデル（GitHub）](https://github.com/laravel/laravel/blob/13.x/app/Models/User.php)
- [Laravel 13 Released（Laravel News）](https://laravel-news.com/laravel-13-released)
- [PHP Supported Versions](https://php.he.net/supported-versions)
- [Scramble Installation & setup](https://scramble.dedoc.co/installation)
- [Swagger launches support for OpenAPI 3.2.0](https://swagger.io/blog/swagger-launches-support-for-openapi-3-2-0/)（OpenAPI 3.2の対応状況）

改訂にあたって、次の資料も確認しました。

- [Laravel 13.x MCP](https://laravel.com/docs/13.x/mcp)（Laravel MCPのサーバー、ツール、認証、テスト）

---

[← 第18章 障害対応ドリル](18-incident-drill.md) ｜ [目次](../README.md#目次)
