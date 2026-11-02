# 第11章 チームで共有する

この章では、個人用だったTaskBoardを、チームでタスクを共有できるように広げます。招待、役割ごとの権限、担当者、同時編集の衝突という、1人用のアプリでは出てこない課題に取り組みます。実務のAPIで最も設計判断が問われるのが、この「誰がどこまでできるか」の部分です。

## この章のゴール

- 役割と権限の表をもとに、Policyで認可を実装できる
- 招待のように「知っていること」が権限になる仕組みを、安全に作れる
- 同時編集による上書きを、ETagとIf-Matchヘッダーで検出できる

## 11.1 何を作るか

追加する機能は次のとおりです。

- ユーザーはチームを作れる。作った人はそのチームのオーナーになる
- オーナーと管理者は、メールアドレスを指定してメンバーを招待できる
- チームのタスクは、メンバー全員が見られる。担当者を1人割り当てられる
- 役割（owner、admin、member、viewer）によって、できる操作が変わる
- 2人が同じタスクをほぼ同時に更新したとき、後の人の更新を止めて知らせる

役割ごとの権限は次の表のとおりです。この表が、この章の実装、第13章の権限テスト、第16章でAIエージェントに任せる範囲の基準になります。

| 操作 | owner | admin | member | viewer |
| --- | --- | --- | --- | --- |
| チームとタスクの閲覧 | 可 | 可 | 可 | 可 |
| タスクの作成、自分が作ったか担当のタスクの更新 | 可 | 可 | 可 | 不可 |
| 他人のタスクの更新、削除 | 可 | 可 | 不可 | 不可 |
| チーム名の変更、メンバーの招待、役割の変更 | 可 | 可（ownerは対象外） | 不可 | 不可 |
| チームの削除 | 可 | 不可 | 不可 | 不可 |

追加するAPIは次のとおりです。

| メソッドとURL | 内容 |
| --- | --- |
| GET、POST /api/v1/teams | 所属チームの一覧、チームの作成 |
| GET、PATCH、DELETE /api/v1/teams/{team} | 詳細、名前の変更、削除 |
| GET /api/v1/teams/{team}/members | メンバーの一覧 |
| PATCH、DELETE /api/v1/teams/{team}/members/{user} | 役割の変更、チームから外す |
| POST /api/v1/teams/{team}/invitations | メンバーを招待する |
| POST /api/v1/invitations/{token}/accept | 招待を受ける |
| GET、POST /api/v1/teams/{team}/tasks | チームのタスクの一覧、作成 |

チームのタスクの詳細、更新、削除には、既存の /api/v1/tasks/{task} をそのまま使います。

## 11.2 既存のAPIを壊さずに広げる

チーム機能を加えると、タスクの持ち主が「ユーザー」だけでなく「チーム」にもなります。ここで、APIの形をどう変えるかを決めます。

> 設計判断メモ：v2にせず、APIの追加で対応する
>
> 決めたこと：既存の /api/v1/tasks はそのまま「個人のタスク」を扱い、チームのタスクは /api/v1/teams/{team}/tasks を新しく追加する。
>
> 選ばなかった案：/api/v2 を作り、すべてのタスクをチームに属させる。データの形はすっきりするが、すでに使われているアプリをすべて書き換えてもらう必要がある。
>
> 理由：第5章で決めたとおり、APIの追加は互換性を壊さない。利用者に移行の負担をかけずに機能を増やせる。
>
> 見直す条件：個人のタスクという考え方そのものをなくすなど、既存のAPIの意味が変わるとき。

> 設計判断メモ：チームはURLで指定する
>
> 決めたこと：/teams/{team}/tasks のように、操作するチームをURLに含める。
>
> 選ばなかった案：X-Team-Id のような独自ヘッダーでチームを指定し、URLは /tasks のままにする。URLは短くなるが、ログやキャッシュでチームを区別しにくく、ヘッダーの付け忘れにも気づきにくい。
>
> 理由：URLを見ればどのチームのデータかが分かり、ルートモデル結合とPolicyでそのまま権限を確認できる。
>
> 見直す条件：ほぼすべてのAPIがチーム単位になり、URLが冗長に感じられるとき（サブドメインでチームを分ける方法もある）。

もう1つ、範囲を絞る判断もしておきます。タグはユーザーごとの機能なので、最初の版ではチームのタスクにタグを付けられないことにします。機能を一度に広げすぎないことも、立派な設計判断です。

## 11.3 テーブルを追加する

```bash
$ sail artisan make:model Team -mf
$ sail artisan make:migration create_team_user_table
$ sail artisan make:model TeamInvitation -m
$ sail artisan make:migration add_team_columns_to_tasks_table
```

それぞれのマイグレーションの `up` を書きます。

```php
// create_teams_table.php
Schema::create('teams', function (Blueprint $table) {
    $table->id();
    $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
    $table->string('name', 50);
    $table->timestamps();
});

// create_team_user_table.php（所属と役割の中間テーブル）
Schema::create('team_user', function (Blueprint $table) {
    $table->foreignId('team_id')->constrained()->cascadeOnDelete();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('role', 20);
    $table->timestamps();

    $table->primary(['team_id', 'user_id']);
});

// create_team_invitations_table.php
Schema::create('team_invitations', function (Blueprint $table) {
    $table->id();
    $table->foreignId('team_id')->constrained()->cascadeOnDelete();
    $table->foreignId('invited_by')->constrained('users')->cascadeOnDelete();
    $table->string('email');
    $table->string('role', 20);
    $table->string('token_hash', 64)->unique();   // 招待コードはハッシュ化して保存する
    $table->timestamp('expires_at');
    $table->timestamp('accepted_at')->nullable();
    $table->timestamps();
});
```

既存の tasks テーブルには、列を追加します。すでに共有したマイグレーションは書き換えず、新しいマイグレーションで変更するのでしたね（第7章）。

```php
// add_team_columns_to_tasks_table.php
public function up(): void
{
    Schema::table('tasks', function (Blueprint $table) {
        // null なら個人のタスク
        $table->foreignId('team_id')->nullable()->after('user_id')->constrained()->cascadeOnDelete();
        $table->foreignId('assignee_id')->nullable()->after('team_id')->constrained('users')->nullOnDelete();
        // 更新のたびに1つ増える番号。同時編集の検出に使う（11.8節）
        $table->unsignedInteger('version')->default(1)->after('is_done');

        $table->index(['team_id', 'is_done', 'due_date']);
    });
}

public function down(): void
{
    Schema::table('tasks', function (Blueprint $table) {
        $table->dropForeign(['team_id']);
        $table->dropForeign(['assignee_id']);
        $table->dropIndex(['team_id', 'is_done', 'due_date']);
        $table->dropColumn(['team_id', 'assignee_id', 'version']);
    });
}
```

```bash
$ sail artisan migrate
```

`nullOnDelete()` は、担当者のユーザーが削除されたときに、タスクを消さずに担当者だけを空にする指定です。

## 11.4 役割の列挙型とモデル

役割は第7章の優先度と同じく列挙型で表します。役割ごとに「何ができるか」をメソッドにしておくと、権限の判定を1か所にまとめられます。`app/Enums/TeamRole.php` を作成します。

```php
<?php

namespace App\Enums;

enum TeamRole: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Member = 'member';
    case Viewer = 'viewer';

    // タスクを作成し、自分が作ったか担当のタスクを更新できるか
    // 役割を増やしたときにうっかり権限が付かないよう、許す役割を並べて書く
    public function canWriteTasks(): bool
    {
        return in_array($this, [self::Owner, self::Admin, self::Member], true);
    }

    // 他人のタスクも更新、削除できるか
    public function canManageAllTasks(): bool
    {
        return in_array($this, [self::Owner, self::Admin], true);
    }

    // チーム名の変更、招待、役割の変更ができるか
    public function canManageTeam(): bool
    {
        return in_array($this, [self::Owner, self::Admin], true);
    }
}
```

`app/Models/Team.php` です。

```php
<?php

namespace App\Models;

use App\Enums\TeamRole;
use Database\Factories\TeamFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name'])]
class Team extends Model
{
    /** @use HasFactory<TeamFactory> */
    use HasFactory;

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class)->withPivot('role')->withTimestamps();
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(TeamInvitation::class);
    }

    // このチームでのユーザーの役割。メンバーでなければ null
    public function roleOf(User $user): ?TeamRole
    {
        $role = $this->members()->whereKey($user->id)->value('team_user.role');

        return $role !== null ? TeamRole::from($role) : null;
    }
}
```

`app/Models/TeamInvitation.php` です。

```php
<?php

namespace App\Models;

use App\Enums\TeamRole;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['email', 'role', 'token_hash', 'expires_at', 'invited_by', 'accepted_at'])]
class TeamInvitation extends Model
{
    protected function casts(): array
    {
        return [
            'role' => TeamRole::class,
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
        ];
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }
}
```

`app/Models/User.php` には、所属チームと、自分がオーナーのチームへのリレーションを加えます。

```php
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

public function teams(): BelongsToMany
{
    return $this->belongsToMany(Team::class)->withPivot('role')->withTimestamps();
}

public function ownedTeams(): HasMany
{
    return $this->hasMany(Team::class, 'owner_id');
}
```

`app/Models/Task.php` には、チームと担当者のリレーション、担当者の一括代入、バージョンの自動更新を加えます。変更する部分だけを示します。

```php
#[Fillable(['title', 'memo', 'due_date', 'priority', 'is_done', 'assignee_id'])]
class Task extends Model
{
    // ...

    protected $attributes = [
        'priority' => 2,
        'is_done' => false,
        'version' => 1,
    ];

    protected function casts(): array
    {
        return [
            'due_date' => 'date',
            'priority' => TaskPriority::class,
            'is_done' => 'boolean',
            'version' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        // 保存する直前に、バージョンを1つ進める
        static::updating(function (Task $task) {
            $task->version = $task->version + 1;
        });
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }
}
```

assignee\_id を #\[Fillable\] に加えていますが、team\_id は加えていません。チームは必ずリレーション経由で設定し、利用者が送った値でタスクの所属を変えられないようにします。担当者の値は、11.7節の検証ルールで「同じチームのメンバー」に限定します。

テスト用に `database/factories/TeamFactory.php` も書いておきます。

```php
// ファイルの先頭の use の並びに追加する（User::factory() を使うため）
use App\Models\User;

// definition の中身を書き換える
public function definition(): array
{
    return [
        'owner_id' => User::factory(),
        'name' => fake()->company(),
    ];
}
```

## 11.5 チームのAPIとPolicy

まずチームそのものの権限を、Policyにまとめます。

```bash
$ sail artisan make:policy TeamPolicy --model=Team
```

```php
<?php

namespace App\Policies;

use App\Enums\TeamRole;
use App\Models\Team;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class TeamPolicy
{
    public function view(User $user, Team $team): Response
    {
        return $this->decide($team->roleOf($user), fn () => true, '');
    }

    public function update(User $user, Team $team): Response
    {
        return $this->decide($team->roleOf($user),
            fn (TeamRole $role) => $role->canManageTeam(), 'チームを変更する権限がありません。');
    }

    public function delete(User $user, Team $team): Response
    {
        return $this->decide($team->roleOf($user),
            fn (TeamRole $role) => $role === TeamRole::Owner, 'チームを削除できるのはオーナーだけです。');
    }

    // 招待、役割の変更、メンバーを外す
    public function manageMembers(User $user, Team $team): Response
    {
        return $this->update($user, $team);
    }

    public function createTask(User $user, Team $team): Response
    {
        return $this->decide($team->roleOf($user),
            fn (TeamRole $role) => $role->canWriteTasks(), '閲覧専用の役割ではタスクを作成できません。');
    }

    private function decide(?TeamRole $role, callable $rule, string $message): Response
    {
        // メンバーでなければ、チームの存在そのものを見せない
        if ($role === null) {
            return Response::denyAsNotFound();
        }

        return $rule($role) ? Response::allow() : Response::deny($message);
    }
}
```

メンバー以外には404、メンバーだが権限が足りない場合は403を返している点に注目してください。

> つまずきポイント：メンバーなのに404、メンバー以外なのに403になる
>
> 404と403の使い分けを逆にしてしまう誤りがよくあります。メンバー以外の人にとって、そのチームは「存在しない」ものです。403を返すと「そのIDのチームは存在する」と伝わってしまいます。一方、メンバーはチームもタスクも見えているので、隠す意味はありません。403で「権限が足りない」と正直に伝えるほうが、使う側は原因を理解できます。

チームの情報を返すAPIリソースを作ります。

```bash
$ sail artisan make:resource TeamResource
```

```php
public function toArray(Request $request): array
{
    return [
        'id' => $this->id,
        'name' => $this->name,
        // 一覧では中間テーブルから、それ以外は問い合わせて、自分の役割を返す
        'my_role' => $this->pivot?->role ?? $this->roleOf($request->user())?->value,
        'created_at' => $this->created_at?->toIso8601String(),
    ];
}
```

コントローラーです。

```bash
$ sail artisan make:controller Api/V1/TeamController --api --model=Team
```

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TeamRole;
use App\Http\Controllers\Controller;
use App\Http\Resources\TeamResource;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class TeamController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return TeamResource::collection($request->user()->teams()->orderBy('name')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate(['name' => ['required', 'string', 'max:50']]);
        $user = $request->user();

        // チームの作成と、作成者をオーナーとして登録する処理をまとめる
        $team = DB::transaction(function () use ($user, $validated) {
            $team = $user->ownedTeams()->create($validated);
            $team->members()->attach($user->id, ['role' => TeamRole::Owner->value]);

            return $team;
        });

        return (new TeamResource($team))
            ->response()
            ->setStatusCode(201)
            ->header('Location', route('teams.show', $team));
    }

    public function show(Team $team): TeamResource
    {
        Gate::authorize('view', $team);

        return new TeamResource($team);
    }

    public function update(Request $request, Team $team): TeamResource
    {
        Gate::authorize('update', $team);

        $team->update($request->validate(['name' => ['required', 'string', 'max:50']]));

        return new TeamResource($team);
    }

    public function destroy(Team $team): Response
    {
        Gate::authorize('delete', $team);

        $team->delete();   // チームのタスク、所属、招待も外部キーの設定で削除される

        return response()->noContent();
    }
}
```

## 11.6 招待

招待は、「招待コードを知っていること」がチームに入る権限になる仕組みです。コードが漏れたり推測されたりすると、知らない人がチームに入れてしまいます。そこで次の4つの対策をします。

- 推測できない十分に長いランダムな文字列にする
- データベースにはハッシュ化した値だけを保存する（データベースが漏れても使えない）
- 有効期限を設け、1回使ったら無効にする
- 招待したメールアドレスと、受け取るユーザーのメールアドレスが一致することを確かめる

第5章の設計判断メモで「招待のように知っていること自体が権限になるものには、推測されやすいIDを使わない」と書いたのは、この場面のことです。

```bash
$ sail artisan make:controller Api/V1/TeamInvitationController
$ sail artisan make:controller Api/V1/AcceptInvitationController --invokable
```

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class TeamInvitationController extends Controller
{
    public function store(Request $request, Team $team): JsonResponse
    {
        Gate::authorize('manageMembers', $team);

        $validated = $request->validate([
            'email' => ['required', 'string', 'email', 'max:255'],
            'role' => ['required', Rule::in(['admin', 'member', 'viewer'])],
        ]);

        $plainToken = Str::random(40);

        $invitation = $team->invitations()->create([
            'email' => Str::lower($validated['email']),
            'role' => $validated['role'],
            'token_hash' => hash('sha256', $plainToken),
            'expires_at' => now()->addDays(7),
            'invited_by' => $request->user()->id,
        ]);

        // 招待コードはメールでだけ伝え、APIの応答には含めない
        Mail::raw(
            "「{$team->name}」に招待されました。\nアプリで次の招待コードを入力してください（7日間有効）。\n\n{$plainToken}",
            fn ($message) => $message->to($invitation->email)->subject('TaskBoardのチームへの招待'),
        );

        return response()->json([
            'data' => [
                'id' => $invitation->id,
                'email' => $invitation->email,
                'role' => $invitation->role->value,
                'expires_at' => $invitation->expires_at->toIso8601String(),
            ],
        ], 201);
    }
}
```

招待を受けるAPIです。

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\TeamResource;
use App\Models\TeamInvitation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AcceptInvitationController extends Controller
{
    public function __invoke(Request $request, string $token): TeamResource
    {
        $user = $request->user();

        $team = DB::transaction(function () use ($user, $token) {
            // 同じ招待を同時に使われないよう、行をロックして読む
            $invitation = TeamInvitation::query()
                ->with('team')
                ->where('token_hash', hash('sha256', $token))
                ->whereNull('accepted_at')
                ->where('expires_at', '>', now())
                ->lockForUpdate()
                ->first();

            // 存在しない、期限切れ、使用済み、宛先が違う。どれも同じ404にする
            if (! $invitation || $invitation->email !== Str::lower($user->email)) {
                abort(404);
            }

            if ($invitation->team->members()->whereKey($user->id)->exists()) {
                abort(409, 'すでにこのチームのメンバーです。');
            }

            $invitation->team->members()->attach($user->id, ['role' => $invitation->role->value]);
            $invitation->update(['accepted_at' => now()]);

            return $invitation->team;
        });

        return new TeamResource($team);
    }
}
```

失敗の理由（期限切れ、使用済み、宛先違い）をあえて区別せずに404で返しています。理由を細かく返すと、第三者が招待コードを試すときの手がかりになるからです。ログイン失敗の理由を詳しく返さなかった第10章と同じ考え方です。

すでにメンバーの人が招待を受けたときは、409 Conflict を返します。リクエストは正しいが、今のデータの状態と矛盾していて処理できない、という意味のステータスコードです。

## 11.7 チームのタスク

チームのタスクの一覧でも、個人用と同じ絞り込みと並べ替えを使いたいところです。同じ処理を2か所に書かないように、第8章でコントローラーに書いた絞り込みを、モデルのスコープに移します。スコープは、よく使う検索条件に名前を付けてモデルに置く仕組みです。`app/Models/Task.php` に追加します。

```php
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;

// 一覧の絞り込みと並べ替え。検証済みの値（validated）を受け取る
#[Scope]
protected function filterForList(Builder $query, array $filters): void
{
    $query
        ->when(isset($filters['is_done']), fn ($q) => $q->where(
            'is_done', filter_var($filters['is_done'], FILTER_VALIDATE_BOOLEAN)))
        ->when(isset($filters['priority']), fn ($q) => $q->where(
            'priority', TaskPriority::fromKey($filters['priority'])))
        ->when(isset($filters['tag']), fn ($q) => $q->whereHas(
            'tags', fn ($tag) => $tag->where('name', $filters['tag'])))
        ->when(isset($filters['q']), function ($q) use ($filters) {
            $keyword = '%'.addcslashes($filters['q'], '%_\\').'%';
            $q->where(fn ($w) => $w->where('title', 'like', $keyword)->orWhere('memo', 'like', $keyword));
        })
        ->when(isset($filters['due_before']), fn ($q) => $q->whereDate(
            'due_date', '<=', $filters['due_before']));

    $sort = $filters['sort'] ?? '-created_at';
    $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';

    $query->orderBy(ltrim($sort, '-'), $direction)->orderBy('id', $direction);
}
```

個人用の一覧（TaskController の index）は、スコープを使って短くなります。あわせて、チームのタスクが個人の一覧に混ざらないように `whereNull('team_id')` を加えます。この1行を忘れると、既存のAPIの意味が変わってしまいます。`applySort` と `sortOptions` のメソッドは削除します。

```php
public function index(IndexTaskRequest $request): AnonymousResourceCollection
{
    $tasks = $request->user()->tasks()
        ->whereNull('team_id')   // 個人のタスクだけ
        ->with(['tags', 'assignee'])
        ->filterForList($request->validated())
        ->paginate($request->integer('per_page', 15))
        ->withQueryString();

    return TaskResource::collection($tasks);
}
```

チームのタスクを作るときの入力検証は、StoreTaskRequest を継承して作ります。

```bash
$ sail artisan make:request Api/V1/StoreTeamTaskRequest
```

```php
<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class StoreTeamTaskRequest extends StoreTaskRequest
{
    // 入力検証より先に権限を確かめる（メンバー以外には入力の誤りも見せない）
    public function authorize(): bool
    {
        Gate::authorize('createTask', $this->route('team'));

        return true;
    }

    public function rules(): array
    {
        $rules = parent::rules();
        unset($rules['tags.*']);
        $rules['tags'] = ['prohibited'];   // チームのタスクにはタグを付けない
        $rules['assignee_id'] = [
            'sometimes', 'nullable', 'integer',
            // 担当者は、このチームのメンバーに限る
            Rule::exists('team_user', 'user_id')->where('team_id', $this->route('team')->id),
        ];

        return $rules;
    }

    public function attributes(): array
    {
        return parent::attributes() + ['assignee_id' => '担当者'];
    }
}
```

フォームリクエストの `authorize` は、入力検証より前に実行されます。ここでPolicyを呼んでおくと、メンバー以外のリクエストは入力の中身を見る前に404で止まります。

一覧も同じ考え方で、チーム用のフォームリクエストを作り、入力検証より先にメンバーかどうかを確かめます。IndexTaskRequest を継承するので、検証ルールはそのまま使えます。

```bash
$ sail artisan make:request Api/V1/IndexTeamTaskRequest
```

```php
<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Support\Facades\Gate;

class IndexTeamTaskRequest extends IndexTaskRequest
{
    public function authorize(): bool
    {
        Gate::authorize('view', $this->route('team'));

        return true;
    }
}
```

チームのタスク用のコントローラーです。

```bash
$ sail artisan make:controller Api/V1/TeamTaskController
```

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\IndexTeamTaskRequest;
use App\Http\Requests\Api\V1\StoreTeamTaskRequest;
use App\Http\Resources\TaskResource;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class TeamTaskController extends Controller
{
    public function index(IndexTeamTaskRequest $request, Team $team): AnonymousResourceCollection
    {
        // メンバーかどうかは、IndexTeamTaskRequest で入力検証より先に確かめている

        // 必ずチームから始めて問い合わせる。他のチームのタスクは混ざらない
        $tasks = $team->tasks()
            ->with(['tags', 'assignee'])
            ->filterForList($request->validated())
            ->paginate($request->integer('per_page', 15))
            ->withQueryString();

        return TaskResource::collection($tasks);
    }

    public function store(StoreTeamTaskRequest $request, Team $team): JsonResponse
    {
        $task = $team->tasks()->make($request->taskAttributes());   // team_id が入る
        $task->user()->associate($request->user());                 // 作成者
        $task->save();

        return (new TaskResource($task->load(['tags', 'assignee'])))
            ->response()
            ->setStatusCode(201)
            ->header('Location', route('tasks.show', $task));
    }
}
```

TaskResource には、チーム、担当者、バージョンの項目を追加します。項目の追加は互換性を壊さない変更です。

```php
'team_id' => $this->team_id,
'assignee' => $this->whenLoaded('assignee', fn () => $this->assignee
    ? ['id' => $this->assignee->id, 'name' => $this->assignee->name]
    : null),
'version' => $this->version,
```

assignee がいつも応答に含まれるよう、TaskController の store でも `$task->load(['tags', 'assignee'])` にそろえます（show と update は11.8節で変更します）。第6章の仕様書の Task にも、同じ項目を追加しておきましょう。仕様書を約束として扱う以上、実装を変えたら仕様書も同時に直します。

```yaml
        team_id: { type: [integer, 'null'], description: null なら個人のタスク }
        assignee:
          type: [object, 'null']
          properties:
            id: { type: integer }
            name: { type: string }
        version: { type: integer, description: 更新のたびに増える版。If-Match に使う }
```

タスクのPolicyは、個人のタスクとチームのタスクで判定を分けます。`app/Policies/TaskPolicy.php` を次のように書き換えます。

```php
<?php

namespace App\Policies;

use App\Enums\TeamRole;
use App\Models\Task;
use App\Models\Team;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class TaskPolicy
{
    public function view(User $user, Task $task): Response
    {
        if ($task->team_id === null) {
            return $this->owns($user, $task);
        }

        return $this->roleIn($user, $task) !== null
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    public function update(User $user, Task $task): Response
    {
        if ($task->team_id === null) {
            return $this->owns($user, $task);
        }

        $role = $this->roleIn($user, $task);
        if ($role === null) {
            return Response::denyAsNotFound();
        }

        // 11.1節の表：owner と admin はすべて、member は自分が作ったか担当のタスクだけ
        $isMine = $task->user_id === $user->id || $task->assignee_id === $user->id;
        $allowed = $role->canManageAllTasks() || ($role->canWriteTasks() && $isMine);

        return $allowed ? Response::allow() : Response::deny('このタスクを変更する権限がありません。');
    }

    public function delete(User $user, Task $task): Response
    {
        return $this->update($user, $task);
    }

    private function owns(User $user, Task $task): Response
    {
        return $user->id === $task->user_id ? Response::allow() : Response::denyAsNotFound();
    }

    private function roleIn(User $user, Task $task): ?TeamRole
    {
        return Team::query()->find($task->team_id)?->roleOf($user);
    }
}
```

更新の入力検証（UpdateTaskRequest）にも、個人とチームで違うルールを加えます。個人のタスクには担当者を、チームのタスクにはタグを付けられないようにします。

```php
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

// 入力検証より先に、このタスクを更新してよいかを確かめる
public function authorize(): bool
{
    Gate::authorize('update', $this->route('task'));

    return true;
}

public function rules(): array
{
    $rules = parent::rules();

    $rules['title'] = ['sometimes', 'required', 'string', 'max:100'];
    $rules['memo'] = ['sometimes', 'nullable', 'string', 'max:2000'];
    $rules['due_date'] = ['sometimes', 'nullable', 'date_format:Y-m-d'];

    $task = $this->route('task');

    if ($task->team_id === null) {
        $rules['assignee_id'] = ['prohibited'];
    } else {
        unset($rules['tags.*']);
        $rules['tags'] = ['prohibited'];
        $rules['assignee_id'] = [
            'sometimes', 'nullable', 'integer',
            Rule::exists('team_user', 'user_id')->where('team_id', $task->team_id),
        ];
    }

    return $rules;
}
```

authorize で先に権限を確かめているので、他人や他のチームのタスクに不正な入力を送っても、422ではなく404が返ります。担当者の検証結果から、他のチームのメンバー構成を推測されることもありません。コントローラーの `Gate::authorize('update', $task)` は、そのまま残しておいてもかまいません。

## 11.8 同時編集の衝突を防ぐ

チームでは、2人が同じタスクをほぼ同時に開いて編集することがあります。何も対策しないと、次のことが起きます。

1. 太郎と花子が、同じタスクを取得する（どちらもバージョン1）
2. 太郎がタイトルを変えて保存する（バージョン2になる）
3. 花子が、太郎の変更を知らないまま期限を変えて保存する
4. 花子の画面には古いタイトルが残っていたため、保存時に太郎のタイトルを上書きしてしまう

これを「更新の消失」と呼びます。防ぐには、「自分が見たときから変わっていなければ保存する」という条件付きの更新にします。HTTPには、そのための仕組みが用意されています。

| 仕組み | 向き | 役割 |
| --- | --- | --- |
| ETag ヘッダー | レスポンス | データの版を表す値。本書では "v3" のようにバージョン番号から作る |
| If-Match ヘッダー | リクエスト | 「この版のときだけ更新して」という条件 |
| 412 Precondition Failed | レスポンス | 条件が合わなかった（他の人が先に更新した） |
| 428 Precondition Required | レスポンス | 条件付きでないリクエストは受け付けない |

TaskController の show と update を次のように変えます。

```php
public function show(Task $task): JsonResponse
{
    Gate::authorize('view', $task);

    return (new TaskResource($task->load(['tags', 'assignee'])))
        ->response()
        ->header('ETag', $this->etagFor($task));
}

public function update(UpdateTaskRequest $request, Task $task): JsonResponse
{
    Gate::authorize('update', $task);

    $ifMatch = $request->header('If-Match');

    // チームのタスクは同時に編集されうるので、条件付きの更新だけを受け付ける
    if ($task->team_id !== null && $ifMatch === null) {
        abort(428, 'If-Match ヘッダーに、取得したときの ETag を指定してください。');
    }

    $task = DB::transaction(function () use ($request, $task, $ifMatch) {
        // 確認から保存までの間に他の更新が割り込まないよう、行をロックして読み直す
        $locked = Task::query()->lockForUpdate()->findOrFail($task->id);

        if ($ifMatch !== null && $ifMatch !== $this->etagFor($locked)) {
            abort(412, '他の人がこのタスクを更新しました。最新の内容を取得してからやり直してください。');
        }

        $locked->update($request->taskAttributes());

        if ($request->tagNames() !== null) {
            $this->syncTags($request->user(), $locked, $request->tagNames());

            // タグだけを変えた場合も版を進める（touch は updating イベントを通る）
            if (! $locked->wasChanged()) {
                $locked->touch();
            }
        }

        return $locked;
    });

    return (new TaskResource($task->load(['tags', 'assignee'])))
        ->response()
        ->header('ETag', $this->etagFor($task));
}

private function etagFor(Task $task): string
{
    return '"v'.$task->version.'"';
}
```

個人のタスクでは、If-Match は「付いていれば確かめる」だけにしています。第8章から使っているアプリは If-Match を送っていないので、必須にすると動かなくなるからです。チームのタスクは新しい機能なので、最初から必須にできます。

version は、タスクの行が保存されるときに増えます。タグは別の中間テーブルに保存されるので、タグだけを変えたときは、`touch()` で更新日時を書き換えて版を進めています。本書のETagが表すのは「タスクとタグの版」です。担当者の名前のように、関連する別のデータが変わってもETagは変わりません。また、If-Match には1つの値だけを受け付け、HTTPの仕様にある複数の値の指定や `*` には対応していません。

レスポンスの data には version も含めているので、一覧から取得したタスクでも `If-Match: "v" + version` を組み立てて送れます。

> 設計判断メモ：衝突は412で返す
>
> 決めたこと：ETagとIf-Matchを使い、衝突は412 Precondition Failed、If-Matchのないリクエストは428 Precondition Required で返す。
>
> 選ばなかった案：リクエストのJSONに version を入れて送らせ、合わなければ409 Conflict を返す。分かりやすいが、HTTPの標準の仕組みではないため、使う側は本書独自の約束を覚える必要がある。
>
> 理由：HTTPの標準に従うと、使う側のライブラリや第三者のツールでも意味が通じる。
>
> 見直す条件：ETagを扱いにくい利用者（一部の外部システムなど）が多い場合は、JSONの version で受け付ける方法も併用する。

## 11.9 メンバーの管理

メンバーの一覧、役割の変更、チームから外す操作です。

```bash
$ sail artisan make:controller Api/V1/TeamMemberController
$ sail artisan make:resource MemberResource
```

```php
// MemberResource の toArray
return [
    'id' => $this->id,
    'name' => $this->name,
    'email' => $this->email,
    'role' => $this->pivot?->role,
    'joined_at' => $this->pivot?->created_at?->toIso8601String(),
];
```

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TeamRole;
use App\Http\Controllers\Controller;
use App\Http\Resources\MemberResource;
use App\Models\Team;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class TeamMemberController extends Controller
{
    public function index(Team $team): AnonymousResourceCollection
    {
        Gate::authorize('view', $team);

        return MemberResource::collection($team->members()->orderBy('name')->get());
    }

    public function update(Request $request, Team $team, User $user): MemberResource
    {
        Gate::authorize('manageMembers', $team);

        $validated = $request->validate([
            'role' => ['required', Rule::in(['admin', 'member', 'viewer'])],
        ]);

        $current = $team->roleOf($user);
        abort_if($current === null, 404);
        abort_if($current === TeamRole::Owner, 422, 'オーナーの役割は変更できません。');

        $team->members()->updateExistingPivot($user->id, ['role' => $validated['role']]);

        return new MemberResource($team->members()->findOrFail($user->id));
    }

    public function destroy(Request $request, Team $team, User $user): Response
    {
        // 自分がチームを抜けるのはいつでもできる。他人を外すには管理の権限が必要
        Gate::authorize($request->user()->is($user) ? 'view' : 'manageMembers', $team);

        abort_if($team->roleOf($user) === TeamRole::Owner, 422, 'オーナーはチームから外せません。');

        $team->members()->detach($user->id);

        return response()->noContent();
    }
}
```

## 11.10 ルートを追加して動作を確かめる

`routes/api.php` の、`auth:sanctum` のグループの中に追加します。

```php
use App\Http\Controllers\Api\V1\AcceptInvitationController;
use App\Http\Controllers\Api\V1\TeamController;
use App\Http\Controllers\Api\V1\TeamInvitationController;
use App\Http\Controllers\Api\V1\TeamMemberController;
use App\Http\Controllers\Api\V1\TeamTaskController;

// チーム（第11章）
Route::apiResource('teams', TeamController::class);
Route::get('/teams/{team}/members', [TeamMemberController::class, 'index'])->name('teams.members.index');
Route::patch('/teams/{team}/members/{user}', [TeamMemberController::class, 'update'])->name('teams.members.update');
Route::delete('/teams/{team}/members/{user}', [TeamMemberController::class, 'destroy'])->name('teams.members.destroy');
Route::post('/teams/{team}/invitations', [TeamInvitationController::class, 'store'])->name('teams.invitations.store');
Route::post('/invitations/{token}/accept', AcceptInvitationController::class)->name('invitations.accept');
Route::get('/teams/{team}/tasks', [TeamTaskController::class, 'index'])->name('teams.tasks.index');
Route::post('/teams/{team}/tasks', [TeamTaskController::class, 'store'])->name('teams.tasks.store');
```

シーダーにもチームのデータを加えます。`DatabaseSeeder` の `run` の最後に追加します。

```php
use App\Enums\TeamRole;

// チームのデータ（第11章）
$mate = User::factory()->create(['name' => 'チームメイト', 'email' => 'mate@example.com']);

$team = $user->ownedTeams()->create(['name' => '開発チーム']);
$team->members()->attach([
    $user->id => ['role' => TeamRole::Owner->value],
    $mate->id => ['role' => TeamRole::Member->value],
]);

Task::factory()->count(10)->for($team)->for($user)->create(['assignee_id' => $mate->id]);
```

```bash
$ sail artisan migrate:fresh --seed
```

test@example.com のトークンを TOKEN、mate@example.com のトークンを MATE\_TOKEN に入れて試します（パスワードはどちらも password です）。

```bash
# チームの一覧（開発チームがオーナーとして表示される）
$ curl http://localhost/api/v1/teams -H "Authorization: Bearer $TOKEN"

# チームのタスクを1件取得して、ETagを確かめる
$ curl -i http://localhost/api/v1/tasks/46 -H "Authorization: Bearer $TOKEN"
ETag: "v1"

# オーナーが v1 を条件に更新する → 成功して v2 になる
$ curl -i -X PATCH http://localhost/api/v1/tasks/46 \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -H 'If-Match: "v1"' -d '{"title":"仕様を確定する"}'
HTTP/1.1 200 OK
ETag: "v2"

# チームメイトが古い v1 のまま更新する → 412で止まる
$ curl -i -X PATCH http://localhost/api/v1/tasks/46 \
    -H "Authorization: Bearer $MATE_TOKEN" -H "Content-Type: application/json" \
    -H 'If-Match: "v1"' -d '{"is_done":true}'
HTTP/1.1 412 Precondition Failed
```

タスクのIDは、シーダーで作られた順に振られます。チームのタスクのIDは `GET /api/v1/teams/1/tasks` で確かめてください。

招待も試してみましょう。開発環境ではメールは送られず、ログに書き出されます。別のターミナルで `sail artisan pail` を動かしておくと、招待コードを確認できます。

```bash
# 第10章で登録した hanako@example.com を招待する
$ curl -X POST http://localhost/api/v1/teams/1/invitations \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"email":"hanako@example.com","role":"viewer"}'

# 花子のトークンで、ログに出た招待コードを使う
$ curl -X POST http://localhost/api/v1/invitations/招待コード/accept \
    -H "Authorization: Bearer $HANAKO_TOKEN"
```

`migrate:fresh` でデータを作り直した場合は、花子をもう一度登録してから試してください。viewer として参加した花子がタスクを作成しようとすると、403が返ることも確かめましょう。

## AIに頼むなら

権限の実装は、表とコードの突き合わせをAIに手伝ってもらうと効率的です。

```text
次の「役割と権限の表」と TaskPolicy のコードを渡します。
表の行ごとに、コードがそのとおりに判定しているかを確認し、
食い違いがあれば、表のどの行とコードのどの部分かを示してください。
表にない権限を追加する提案はしないでください。
（表とコードを貼り付ける）
```

受け取った結果では、次の点を確かめます。

- 指摘が本当に表と食い違っているか、自分で表とコードを読み直して確認する
- 最終的な確認は、第13章で作る権限のテストで行う。AIの「問題ありません」をテストの代わりにしない

## まとめ

- 既存のAPIは変えず、チーム用のAPIを追加して機能を広げる
- 役割と権限を表で決め、列挙型とPolicyでその表をコードにする
- メンバー以外には404、権限が足りないメンバーには403を返す
- 招待コードは長くランダムにし、ハッシュ化して保存し、期限と使用回数を制限する
- 同時編集による上書きは、ETag、If-Match、412で防ぐ

## 演習

1. 基礎：チームのタスク一覧に、自分が担当のタスクだけを返す `assignee=me` の絞り込みを追加してください。IndexTaskRequest へのルールの追加も必要です。
2. 応用：「ゲスト」という役割を追加してください。ゲストは、自分が担当のタスクだけを閲覧と更新ができ、それ以外のタスクは見えません。11.1節の表に行を足してから実装しましょう。

解答例は付録Eにあります。

## レビュー観点

- [ ] チームのデータは `$team->tasks()` のように、チームから始まる問い合わせで取得している
- [ ] team\_id を利用者の入力から設定していない
- [ ] メンバー以外には404、権限が足りないメンバーには403を返している
- [ ] 招待コードを平文で保存したり、APIの応答に含めたりしていない
- [ ] チームのタスクの更新で If-Match を確かめている

---

[← 第10章 認証と認可](10-auth.md) ｜ [目次](../README.md#目次) ｜ [第12章 Web APIのセキュリティ →](12-security.md)
