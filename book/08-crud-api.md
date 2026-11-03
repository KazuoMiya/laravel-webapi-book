# 第8章 CRUD APIを実装する

この章で、タスクの作成（Create）、取得（Read）、更新（Update）、削除（Delete）の4操作、いわゆるCRUDのAPIが完成します。入力検証は最小限にとどめ、第9章で本格的に整えます。

## この章のゴール

- apiResource とコントローラーでCRUDのAPIを実装できる
- APIリソースでJSONの形を整えられる
- 絞り込み、並べ替え、ページングを安全に実装できる

## 8.1 動作確認用のトークンを用意する

タスクはユーザーごとのデータなので、APIは「誰からのリクエストか」を知る必要があります。ログインAPIは第10章で作るため、この章ではTinkerでトークンを発行して代用します。

```bash
$ sail tinker
> App\Models\User::where('email', 'test@example.com')->first()->createToken('dev')->plainTextToken;
= "1|Qw3rTy..."
```

表示された文字列がトークンです。ターミナルの変数に入れておくと、以降のcurlで使い回せます。

```bash
$ TOKEN="1|Qw3rTy..."
```

## 8.2 ルートを定義する

`Route::apiResource` を使うと、CRUDに必要なルートを1行でまとめて登録できます。`routes/api.php` を次のように書き換えます。第4章のHelloControllerのルートは削除してかまいません。

```php
<?php

use App\Http\Controllers\Api\V1\TagController;
use App\Http\Controllers\Api\V1\TaskController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::middleware('auth:sanctum')->group(function () {
        Route::apiResource('tasks', TaskController::class)->except(['update']);
        Route::patch('/tasks/{task}', [TaskController::class, 'update'])->name('tasks.update');
        Route::get('/tags', [TagController::class, 'index'])->name('tags.index');
    });
});
```

`apiResource` が登録するルートは次のとおりです。

| メソッド | URL | コントローラーのメソッド | ルート名 |
| --- | --- | --- | --- |
| GET | /api/v1/tasks | index | tasks.index |
| POST | /api/v1/tasks | store | tasks.store |
| GET | /api/v1/tasks/{task} | show | tasks.show |
| PATCH | /api/v1/tasks/{task} | update | tasks.update |
| DELETE | /api/v1/tasks/{task} | destroy | tasks.destroy |

apiResource は、本来は更新にPUTとPATCHの両方を登録します。本書の更新は部分更新（PATCH）だけと決めたので（第5章）、`except(['update'])` でいったん外し、PATCHだけを登録し直しています。PUTでリクエストすると、そのメソッドのルートがないため405が返ります。

`auth:sanctum` ミドルウェアの中に入れたので、正しいトークンのないリクエストは401で拒否されます。

## 8.3 APIリソースでJSONの形を決める

APIリソースは、モデルをJSONに変換する「型紙」です。モデルをそのまま返すと、データベースの列がすべて、データベースの形のまま出てしまいます。APIリソースを挟むことで、第5章で決めたJSONの形に整えられます。

```bash
$ sail artisan make:resource TaskResource
$ sail artisan make:resource TagResource
```

`app/Http/Resources/TaskResource.php` を書きます。

```php
<?php

namespace App\Http\Resources;

use App\Models\Task;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Task
 */
class TaskResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'memo' => $this->memo,
            'due_date' => $this->due_date?->toDateString(),        // 2026-11-10
            'priority' => $this->priority->key(),                   // high
            'is_done' => $this->is_done,
            'tags' => TagResource::collection($this->whenLoaded('tags')),
            'created_at' => $this->created_at?->toIso8601String(), // 2026-11-03T09:00:00+00:00
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
```

`whenLoaded('tags')` は「tags が事前に読み込まれているときだけ出力する」という意味です。うっかりN+1問題を起こさないための書き方です。

`app/Http/Resources/TagResource.php` は次のとおりです。

```php
public function toArray(Request $request): array
{
    return [
        'id' => $this->id,
        'name' => $this->name,
    ];
}
```

APIリソースを返すと、Laravelは自動で全体を data というキーで包みます。第5章で決めた形はこれで実現できます。

## 8.4 コントローラーを作る

```bash
$ sail artisan make:controller Api/V1/TaskController --api --model=Task
$ sail artisan make:controller Api/V1/TagController
```

`--api` を付けると、apiResourceに対応する5つのメソッドのひな形が作られます。`app/Http/Controllers/Api/V1/TaskController.php` を次のように書きます。少し長いので、後で1つずつ説明します。

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TaskPriority;
use App\Http\Controllers\Controller;
use App\Http\Resources\TaskResource;
use App\Models\Task;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TaskController extends Controller
{
    private const SORTABLE = ['due_date', 'priority', 'created_at'];

    // GET /api/v1/tasks
    public function index(Request $request): AnonymousResourceCollection
    {
        $request->validate([
            'is_done' => ['sometimes', 'in:true,false,1,0'],
            'priority' => ['sometimes', Rule::in(TaskPriority::keys())],
            'tag' => ['sometimes', 'string', 'max:50'],
            'q' => ['sometimes', 'string', 'max:100'],
            'due_before' => ['sometimes', 'date_format:Y-m-d'],
            'sort' => ['sometimes', Rule::in($this->sortOptions())],
            'per_page' => ['sometimes', 'integer', 'between:1,100'],
        ]);

        $tasks = $request->user()->tasks()
            ->with('tags')
            ->when($request->has('is_done'),
                fn ($query) => $query->where('is_done', $request->boolean('is_done')))
            ->when($request->filled('priority'),
                fn ($query) => $query->where('priority', TaskPriority::fromKey($request->query('priority'))))
            ->when($request->filled('tag'),
                fn ($query) => $query->whereHas('tags', fn ($tag) => $tag->where('name', $request->query('tag'))))
            ->when($request->filled('q'), function ($query) use ($request) {
                // % と _ はLIKE検索の特殊文字なので、文字そのものとして扱うよう処理する
                $keyword = '%'.addcslashes($request->query('q'), '%_\\').'%';
                $query->where(fn ($where) => $where
                    ->where('title', 'like', $keyword)
                    ->orWhere('memo', 'like', $keyword));
            })
            ->when($request->filled('due_before'),
                fn ($query) => $query->whereDate('due_date', '<=', $request->query('due_before')))
            ->tap(fn ($query) => $this->applySort($query, $request->query('sort', '-created_at')))
            ->paginate($request->integer('per_page', 15))
            ->withQueryString();

        return TaskResource::collection($tasks);
    }

    // POST /api/v1/tasks
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:100'],
            'memo' => ['nullable', 'string', 'max:2000'],
            'due_date' => ['nullable', 'date_format:Y-m-d'],
            'priority' => ['sometimes', Rule::in(TaskPriority::keys())],
            'is_done' => ['sometimes', 'boolean'],
            'tags' => ['sometimes', 'array', 'max:10'],
            'tags.*' => ['string', 'max:50'],
        ]);

        $user = $request->user();

        // タスクとタグの保存を「全部成功か、全部取り消し」にする
        $task = DB::transaction(function () use ($user, $validated) {
            $task = $user->tasks()->create($this->toAttributes($validated));

            if (array_key_exists('tags', $validated)) {
                $this->syncTags($user, $task, $validated['tags']);
            }

            return $task;
        });

        return (new TaskResource($task->load('tags')))
            ->response()
            ->setStatusCode(201)
            ->header('Location', route('tasks.show', $task));
    }

    // GET /api/v1/tasks/{task}
    public function show(Request $request, Task $task): TaskResource
    {
        $this->ensureOwner($request, $task);

        return new TaskResource($task->load('tags'));
    }

    // PATCH /api/v1/tasks/{task}
    public function update(Request $request, Task $task): TaskResource
    {
        $this->ensureOwner($request, $task);

        $validated = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:100'],
            'memo' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'due_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'priority' => ['sometimes', Rule::in(TaskPriority::keys())],
            'is_done' => ['sometimes', 'boolean'],
            'tags' => ['sometimes', 'array', 'max:10'],
            'tags.*' => ['string', 'max:50'],
        ]);

        DB::transaction(function () use ($request, $task, $validated) {
            $task->update($this->toAttributes($validated));

            if (array_key_exists('tags', $validated)) {
                $this->syncTags($request->user(), $task, $validated['tags']);
            }
        });

        return new TaskResource($task->load('tags'));
    }

    // DELETE /api/v1/tasks/{task}
    public function destroy(Request $request, Task $task): Response
    {
        $this->ensureOwner($request, $task);

        $task->delete();

        return response()->noContent();   // 204
    }

    // 他人のタスクは「存在しない」ものとして404にする（第10章でPolicyに置き換える）
    private function ensureOwner(Request $request, Task $task): void
    {
        abort_if($task->user_id !== $request->user()->id, 404);
    }

    // 検証済みの入力を、モデルに保存できる形に変換する
    private function toAttributes(array $validated): array
    {
        $attributes = Arr::except($validated, ['tags']);

        if (isset($attributes['priority'])) {
            $attributes['priority'] = TaskPriority::fromKey($attributes['priority']);
        }

        return $attributes;
    }

    // タグ名の配列から、必要ならタグを作り、タスクに付け替える
    private function syncTags(User $user, Task $task, array $names): void
    {
        $tagIds = collect($names)
            ->map(fn (string $name) => trim($name))
            ->filter()
            ->unique()
            ->map(fn (string $name) => $user->tags()->firstOrCreate(['name' => $name])->id);

        $task->tags()->sync($tagIds);
    }

    /** @return list<string> */
    private function sortOptions(): array
    {
        return collect(self::SORTABLE)
            ->flatMap(fn (string $column) => [$column, "-{$column}"])
            ->all();
    }

    private function applySort($query, string $sort): void
    {
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $column = ltrim($sort, '-');

        // 同じ値が並んだときの順序を安定させるため、最後にidでも並べる
        $query->orderBy($column, $direction)->orderBy('id', $direction);
    }
}
```

## 8.5 コードを読み解く

ルートモデル結合。show や update の引数に `Task $task` と書くと、URLの {task} の値をIDとしてタスクを探し、見つかったモデルを渡してくれます。見つからなければ自動で404になります。

自分のデータに限定する。一覧と作成では、必ず `$request->user()->tasks()` から始めています。こうすると、検索条件に「自分のタスク」が自動で付き、作成時の user\_id も自動で入ります。詳細、更新、削除では、`ensureOwner` で持ち主を確かめています。この確認を忘れると、IDを変えるだけで他人のデータを読み書きできてしまいます。これは実際のサービスでも頻繁に見つかる重大な脆弱性です。

条件付きの絞り込み。`when(条件, 処理)` は「条件が真のときだけ処理を加える」メソッドです。パラメーターが指定されたものだけ、検索条件に加えています。

並べ替えの安全性。sort の値は、あらかじめ決めた一覧（SORTABLE）にあるものだけを許可しています。利用者が送った値をそのまま orderBy に渡すと、意図しない列で並べ替えられたり、エラーで内部情報が漏れたりするおそれがあるからです。

トランザクション。`DB::transaction` の中の処理は、途中で例外が起きるとすべて取り消されます。タスクは作られたのにタグの保存に失敗した、という中途半端な状態を防ぎます。

作成時の応答。作成成功時は201を返し、Locationヘッダーに新しいタスクのURLを入れています。第5章の設計どおりです。

> 設計判断メモ：ページングはページ番号方式にする
>
> 決めたこと：paginate を使い、page と per\_page で取得する「ページ番号方式」にする。
>
> 選ばなかった案：cursorPaginate を使う「カーソル方式」。前回の最後の位置を手がかりに次を取るので、件数が非常に多くても速く、途中でデータが追加されても重複や抜けが起きにくい。ただし総件数や「3ページ目」への移動は扱えない。
>
> 理由：総件数とページ番号を画面に表示でき、初学者にも仕組みが分かりやすい。個人やチームのタスクの件数なら、速さも十分。
>
> 見直す条件：件数が数十万を超えて一覧が遅くなったとき、または無限スクロールの画面で重複や抜けが問題になったとき。

## 8.6 タグ一覧

`app/Http/Controllers/Api/V1/TagController.php` を書きます。

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\TagResource;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class TagController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return TagResource::collection(
            $request->user()->tags()->orderBy('name')->get()
        );
    }
}
```

> つまずきポイント：Call to a member function key() on null
>
> 優先度を指定せずにタスクを作成したときにこのエラーが出たら、Taskモデルに `$attributes`（第7章）があるかを確かめてください。データベースの初期値は保存した後のデータベースの中にしかないため、作成直後のモデルの priority は null のままです。そのため、APIリソースの `$this->priority->key()` で失敗します。

## 8.7 curlで動作を確かめる

リクエストには必ず `Accept: application/json` を付けてください。付けないと、エラーのときにJSONではなく画面向けの応答が返ることがあります。第9章で、付け忘れてもJSONを返すように改善します。

```bash
# 一覧（未完了、優先度が高い順）
$ curl "http://localhost/api/v1/tasks?is_done=false&sort=-priority" \
    -H "Accept: application/json" \
    -H "Authorization: Bearer $TOKEN"

# 作成
$ curl -i -X POST http://localhost/api/v1/tasks \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"title":"レポートを書く","due_date":"2026-11-20","priority":"high","tags":["仕事","急ぎ"]}'

# 完了にする（部分更新）
$ curl -X PATCH http://localhost/api/v1/tasks/41 \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"is_done":true}'

# 削除
$ curl -i -X DELETE http://localhost/api/v1/tasks/41 \
    -H "Accept: application/json" \
    -H "Authorization: Bearer $TOKEN"
```

作成のリクエストでは、`HTTP/1.1 201 Created` と、`Location: http://localhost/api/v1/tasks/41` のようなヘッダーが返ります。IDは環境によって異なるので、自分の環境で返ってきた値に読み替えてください。

次の3つも試してみましょう。

- Authorizationヘッダーを外す → 401と `{"message":"Unauthenticated."}` が返る
- シーダーで作った他人のタスクのIDを指定する → 404が返る
- `{"title":""}` で作成する → 422とエラーの詳細が返る

## 8.8 一覧のレスポンスを確認する

ページ分けした一覧をAPIリソースで返すと、data に加えて links と meta が自動で付きます。

```json
{
  "data": [ { "id": 40, "title": "...", "tags": [] } ],
  "links": { "first": "...?page=1", "last": "...?page=3", "prev": null, "next": "...?page=2" },
  "meta": {
    "current_page": 1, "from": 1, "last_page": 3,
    "links": [ ],
    "path": "http://localhost/api/v1/tasks",
    "per_page": 15, "to": 15, "total": 40
  }
}
```

meta には、第5章の例よりも多くの項目（from、to、path など）が入ります。項目が増えるのは互換性を壊さない変更なので問題ありません。

`withQueryString()` を付けているため、links のURLには is\_done などの絞り込み条件も引き継がれます。使う側は next のURLをそのまま呼ぶだけで次のページを取得できます。

なお、Laravel 13には、JSON:APIという別の標準形式でレスポンスを作るためのリソースも用意されています。外部に公開するAPIでJSON:APIに合わせる必要がある場合は、公式ドキュメントのJSON:API Resourcesを参照してください。

## AIに頼むなら

```text
TaskController の一覧（index）に、期限切れのタスクだけを返す overdue=true の絞り込みを追加してください。
自分のタスクだけに限定する条件と、並べ替えの許可リストは変えないでください。
入力の検証ルールとテストも追加してください。
```

- 問い合わせが `$request->user()->tasks()` から始まったままかを確かめる
- 新しいパラメーターが入力の検証ルールに追加されているかを確かめる
- 第11章以降なら、`whereNull('team_id')` が消されていないかも確かめる

## まとめ

- `apiResource` でCRUDのルートをまとめて登録できる
- APIリソースで、モデルとAPIのJSONの形を切り離す
- 一覧と作成は `$request->user()->tasks()` から始め、他人のデータには404を返す
- 並べ替えの列は許可リストで制限し、複数の保存はトランザクションでまとめる

## 演習

1. 基礎：一覧APIを `is_done=true&per_page=5` で呼び出し、meta の total、per\_page、last\_page の関係を確かめてください。
2. 応用：期限切れ（期限が今日より前で、未完了）のタスクだけを返す `overdue=true` の絞り込みを追加してください。

解答例は付録Eにあります。

## レビュー観点

- [ ] 自分のデータだけに限定している
- [ ] 並べ替えの列など、利用者が送った値を許可リストで確かめている
- [ ] 一覧の件数に上限がある
- [ ] 複数の保存をトランザクションでまとめている
- [ ] 作成時に201とLocationヘッダーを返している

---

[← 第7章 データベースとEloquent ORM](07-database-eloquent.md) ｜ [目次](../README.md#目次) ｜ [第9章 入力検証とエラーハンドリング →](09-validation-errors.md)
