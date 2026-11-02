# 第9章 入力検証とエラーハンドリング

APIに届く入力は、すべて「信用できないもの」として扱います。この章では、入力検証をフォームリクエストに整理し、どんなエラーでも第5章で決めた形のJSONを返すようにします。

## この章のゴール

- フォームリクエストで、入力検証をまとめられる
- どんなエラーでも、決めた形のJSONで返せる
- 業務ルールのエラーを、独自の例外クラスで表せる

## 9.1 なぜ入力検証が必要か

APIは、自分たちが作ったアプリ以外からも呼び出せます。curlで直接、想定外の値を送ることも簡単です。入力検証がないと、次のような問題が起きます。

- 文字数の上限を超えた値でデータベースのエラーになる（500）
- 存在しない優先度などの、ありえない値が保存される
- 巨大なデータを送りつけられ、サーバーが重くなる

入力検証の目的は、こうした入力を処理の入り口で止め、何が悪いかを422で分かりやすく返すことです。

## 9.2 フォームリクエストに検証を移す

第8章では検証ルールをコントローラーに直接書きました。ルールが増えるとコントローラーが読みにくくなるため、フォームリクエストという専用のクラスに移します。

```bash
$ sail artisan make:request Api/V1/IndexTaskRequest
$ sail artisan make:request Api/V1/StoreTaskRequest
$ sail artisan make:request Api/V1/UpdateTaskRequest
```

`app/Http/Requests/Api/V1/StoreTaskRequest.php` を書きます。

```php
<?php

namespace App\Http\Requests\Api\V1;

use App\Enums\TaskPriority;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Arr;
use Illuminate\Validation\Rule;

class StoreTaskRequest extends FormRequest
{
    // 誰が実行できるかは、第10章のPolicyで判定する
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:100'],
            'memo' => ['nullable', 'string', 'max:2000'],
            'due_date' => ['nullable', 'date_format:Y-m-d'],
            'priority' => ['sometimes', Rule::in(TaskPriority::keys())],
            'is_done' => ['sometimes', 'boolean'],
            'tags' => ['sometimes', 'array', 'max:10'],
            'tags.*' => ['string', 'distinct', 'max:50'],
        ];
    }

    // エラーメッセージで使う項目名
    public function attributes(): array
    {
        return [
            'title' => 'タイトル',
            'memo' => 'メモ',
            'due_date' => '期限',
            'priority' => '優先度',
            'is_done' => '完了状態',
            'tags' => 'タグ',
            'tags.*' => 'タグ',
        ];
    }

    // 検証済みの値を、モデルに保存できる形に変換して返す
    public function taskAttributes(): array
    {
        $attributes = Arr::except($this->validated(), ['tags']);

        if (isset($attributes['priority'])) {
            $attributes['priority'] = TaskPriority::fromKey($attributes['priority']);
        }

        return $attributes;
    }

    // tags が送られていればタグ名の配列、送られていなければ null
    public function tagNames(): ?array
    {
        return $this->has('tags') ? $this->validated('tags', []) : null;
    }
}
```

`UpdateTaskRequest` は StoreTaskRequest を継承し、ルールだけを部分更新向けに変えます。

```php
<?php

namespace App\Http\Requests\Api\V1;

class UpdateTaskRequest extends StoreTaskRequest
{
    public function rules(): array
    {
        $rules = parent::rules();

        // 部分更新なので、すべての項目を「送られてきたときだけ検証する」に変える
        $rules['title'] = ['sometimes', 'required', 'string', 'max:100'];
        $rules['memo'] = ['sometimes', 'nullable', 'string', 'max:2000'];
        $rules['due_date'] = ['sometimes', 'nullable', 'date_format:Y-m-d'];

        return $rules;
    }
}
```

`IndexTaskRequest` は、ファイル全体を次のように書きます。`make:request` で作ったフォームリクエストの `authorize()` は、最初は false を返すようになっています。false のままだと、ログインしていても403になってしまうので、必ず書き換えます（StoreTaskRequest も同じです）。

```php
<?php

namespace App\Http\Requests\Api\V1;

use App\Enums\TaskPriority;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class IndexTaskRequest extends FormRequest
{
    // 自分のタスクの一覧なので、ログインしていれば誰でもよい
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'is_done' => ['sometimes', 'in:true,false,1,0'],
            'priority' => ['sometimes', Rule::in(TaskPriority::keys())],
            'tag' => ['sometimes', 'string', 'max:50'],
            'q' => ['sometimes', 'string', 'max:100'],
            'due_before' => ['sometimes', 'date_format:Y-m-d'],
            'sort' => ['sometimes', Rule::in([
                'due_date', '-due_date', 'priority', '-priority', 'created_at', '-created_at',
            ])],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'between:1,100'],
        ];
    }
}
```

コントローラーでは、引数の型を `Request` からフォームリクエストに変えるだけです。メソッドが呼ばれる前に検証が自動で行われ、失敗すれば422が返ります。コントローラーの中には、検証を通った正しい入力だけが届きます。

```php
use App\Http\Requests\Api\V1\IndexTaskRequest;
use App\Http\Requests\Api\V1\StoreTaskRequest;
use App\Http\Requests\Api\V1\UpdateTaskRequest;

public function index(IndexTaskRequest $request): AnonymousResourceCollection
{
    $tasks = $request->user()->tasks()
        // ... 第8章と同じ絞り込みと並べ替え（$request->validate(...) の呼び出しは削除）
}

public function store(StoreTaskRequest $request): JsonResponse
{
    $user = $request->user();

    $task = DB::transaction(function () use ($user, $request) {
        $task = $user->tasks()->create($request->taskAttributes());

        if ($request->tagNames() !== null) {
            $this->syncTags($user, $task, $request->tagNames());
        }

        return $task;
    });

    return (new TaskResource($task->load('tags')))
        ->response()
        ->setStatusCode(201)
        ->header('Location', route('tasks.show', $task));
}

public function update(UpdateTaskRequest $request, Task $task): TaskResource
{
    $this->ensureOwner($request, $task);

    DB::transaction(function () use ($request, $task) {
        $task->update($request->taskAttributes());

        if ($request->tagNames() !== null) {
            $this->syncTags($request->user(), $task, $request->tagNames());
        }
    });

    return new TaskResource($task->load('tags'));
}
```

変換の処理をフォームリクエストに移したので、コントローラーの `toAttributes` メソッドは削除できます。

## 9.3 よく使う検証ルール

| ルール | 意味 |
| --- | --- |
| required | 必須。null や空文字は不可 |
| sometimes | 項目が送られてきたときだけ、残りのルールで検証する |
| nullable | null を許可する |
| string、integer、boolean、array | 型 |
| max:100、min:8、between:1,100 | 文字数、数値の大きさ、配列の要素数の範囲 |
| email | メールアドレスの形式 |
| date\_format:Y-m-d | 指定した形式の日付 |
| in:a,b,c または Rule::in(\[...\]) | 一覧のどれか |
| unique:users,email | 指定したテーブルの列に同じ値がない |
| confirmed | 「項目名\_confirmation」と一致する（パスワードの確認入力など） |
| distinct | 配列の中に重複がない |
| tags.\* | 配列の各要素に対するルール |

`sometimes` と `required` の組み合わせは、部分更新でよく使います。「送らなければ変更しない、送るなら空にはできない」という意味になります。

Laravelは、すべてのリクエストで文字列の前後の空白を取り除き、空文字を null に変換しています。そのため `{"title":"  "}` は null とみなされ、required で弾かれます。

> つまずきポイント：sometimes と nullable の違い
>
> sometimes は「その項目が送られてこなければ、残りのルールで検証しない」という意味です。nullable は「項目が送られてきて、値が null でもよい」という意味です。部分更新で memo に `sometimes` と `nullable` を両方付けると、「memo を送らなければ変更しない、null を送ればメモを消す」という動きになります。実は nullable だけでも、送らなかった項目は validated() に含まれず、null を送った項目は含まれるので、この2つは区別されます。sometimes を付けると「送られたときだけ検証する」という意図がルールから読み取れます。title のように required と組み合わせれば、「省略は許すが、空にはさせない」という指定もできます。

## 9.4 エラーメッセージを日本語にする

`.env` で言語を日本語にします。

```dotenv
APP_LOCALE=ja
```

Laravelの標準メッセージは英語のファイルしかないので、日本語のファイルを用意します。まず英語のファイルを書き出します。

```bash
$ sail artisan lang:publish
```

`lang/en/validation.php` ができるので、同じ場所に `lang/ja/validation.php` を作り、本書で使うルールのメッセージを訳します。訳していないルールは英語のメッセージになります。

```php
<?php
// lang/ja/validation.php

return [
    'required' => ':attributeは必須です。',
    'string' => ':attributeは文字列で指定してください。',
    'boolean' => ':attributeはtrueかfalseで指定してください。',
    'array' => ':attributeは配列で指定してください。',
    'email' => ':attributeは正しいメールアドレスの形式で指定してください。',
    'unique' => 'その:attributeはすでに使われています。',
    'confirmed' => ':attributeが確認用の値と一致しません。',
    'distinct' => ':attributeに重複した値があります。',
    'in' => '選択された:attributeは正しくありません。',
    'integer' => ':attributeは整数で指定してください。',
    'date_format' => ':attributeは:formatの形式で指定してください。',
    'max' => [
        'string' => ':attributeは:max文字以内で指定してください。',
        'array' => ':attributeは:max個以内で指定してください。',
        'numeric' => ':attributeは:max以下で指定してください。',
    ],
    'min' => [
        'string' => ':attributeは:min文字以上で指定してください。',
    ],
    'between' => [
        'numeric' => ':attributeは:minから:maxの間で指定してください。',
    ],
    'attributes' => [
        'name' => '名前',
        'email' => 'メールアドレス',
        'password' => 'パスワード',
    ],
];
```

`:attribute` の部分には、フォームリクエストの `attributes()` か、このファイルの `attributes` で決めた項目名が入ります。

複数のエラーがあるとき、message の末尾には「(and 1 more error)」が付きます。この部分は `lang/ja.json` に次のように書くと日本語になります。

```json
{
  "(and :count more error)": "（ほか:count件のエラー）",
  "(and :count more errors)": "（ほか:count件のエラー）"
}
```

すべてのメッセージを自分で訳す代わりに、コミュニティが翻訳を管理しているパッケージ（Laravel Lang）を使う方法もあります。

## 9.5 エラーを必ずJSONで返す

第8章では、リクエストに `Accept: application/json` を付けるよう注意しました。付け忘れると、認証エラーのときにログイン画面へ転送しようとして、別のエラーが起きることがあります。APIを使う側の付け忘れでAPIの応答が変わるのは困るので、APIのリクエストは常にJSONを求めているものとして扱います。

ミドルウェアを作ります。

```bash
$ sail artisan make:middleware ForceJsonResponse
```

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ForceJsonResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        // 「JSONで返してほしい」というヘッダーを必ず付けた状態にする
        $request->headers->set('Accept', 'application/json');

        // JSONとして読めないボディ（書きかけのJSONなど）は、入力検証に進まずに400にする
        $body = $request->getContent();
        if ($request->isJson() && $body !== '' && ! json_validate($body)) {
            abort(400, 'リクエストのJSONの形式が正しくありません。');
        }

        return $next($request);
    }
}
```

あわせて、JSONとして読めないボディ（書きかけの `{"title":` など）を受け取ったら、入力検証に進まずに400を返すようにしています。Laravelは読めないJSONを空の入力として扱うため、この確認がないと、必須項目の不足として422になったり、部分更新では何も変えずに成功したりしてしまいます。`json_validate` は、PHP 8.3から使える関数です。

`bootstrap/app.php` で、APIのミドルウェアグループの先頭に追加します。

```php
use App\Http\Middleware\ForceJsonResponse;

->withMiddleware(function (Middleware $middleware): void {
    $middleware->api(prepend: [
        ForceJsonResponse::class,
    ]);
})
```

ただし、このミドルウェアはルートが決まった後に動きます。対応していないメソッドでのリクエスト（405）や、メンテナンス中の応答のように、ルートが決まる前に起きる失敗には効きません。9.7節で、例外の側でもJSONで返す設定を加えます。

> 設計判断メモ：エラーの形はLaravelの標準に合わせる
>
> 決めたこと：エラーは message、入力の誤りは message と errors という、Laravelの標準の形で返す。
>
> 選ばなかった案：RFC 9457（Problem Details）の形式。type、title、status、detail といった項目でエラーの種類を機械的に判別でき、標準規格なので外部の利用者にも説明しやすい。ただし、Laravelの標準の応答をすべて変換する仕組みが必要になる。
>
> 理由：追加の実装なしに、すべてのエラーを同じ形にそろえられる。使う側も1つの関数でエラーを扱える（第15章）。
>
> 見直す条件：複数の組織に公開するAPIで、エラーの種類を機械的に判別させたいとき。

## 9.6 例外とステータスコードの対応

Laravelは、処理中に投げられた例外を自動でHTTPレスポンスに変換します。主な対応は次のとおりです。

| 例外 | ステータス | 主な発生場面 |
| --- | --- | --- |
| ValidationException | 422 | 入力検証の失敗 |
| AuthenticationException | 401 | トークンがない、無効 |
| AuthorizationException | 403 | Policyで拒否された（第10章） |
| ModelNotFoundException、NotFoundHttpException | 404 | ルートモデル結合で見つからない、URLが存在しない |
| MethodNotAllowedHttpException | 405 | URLはあるがメソッドが違う |
| abort(409) など | 409 | データの今の状態と矛盾する（すでにメンバーなど、第11章） |
| abort(412) | 412 | 同時編集の衝突（第11章） |
| abort(428) | 428 | If-Matchのない更新（第11章） |
| ThrottleRequestsException | 429 | 回数制限を超えた（第12章） |
| 上記以外の例外 | 500 | プログラムの誤りなど |

## 9.7 エラーの応答を整える

存在しないタスクを指定したときの404の応答を見てみましょう。

```json
{ "message": "No query results for model [App\\Models\\Task] 9999" }
```

これでは内部のクラス名が利用者に見えてしまいます。`bootstrap/app.php` の `withExceptions` に、APIの404の応答を差し替える処理を加えます。`shouldRenderJsonWhen` の部分は、第4章で見たとおり最初から書かれています。

```php
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

->withExceptions(function (Exceptions $exceptions): void {
    // /api 以下で起きた例外は、ルートが決まる前の失敗（405など）も含めてJSONで返す
    $exceptions->shouldRenderJsonWhen(
        fn (Request $request, Throwable $e) => $request->is('api/*') || $request->expectsJson()
    );

    // 404はすべて同じ応答にする
    $exceptions->render(function (HttpExceptionInterface $e, Request $request) {
        if ($e->getStatusCode() === 404 && $request->is('api/*')) {
            return response()->json([
                'message' => 'リソースが見つかりません。',
            ], 404);
        }
    });
})
```

`render` に渡した関数は、指定した種類の例外が起きたときに呼ばれます。条件に合わないときに何も返さなければ、Laravelの標準の処理に任されます。

ここでは、404を表す例外をすべて同じ応答にしています。第10章のPolicyで「他人のタスクは404にする」と拒否したときも、Laravelは404の例外を投げます。そのときのメッセージが、本当に存在しないときと違っていると、メッセージを見比べるだけで「このIDのタスクは存在する」と分かってしまいます。存在を隠すために404を返すなら、応答の中身までそろえておきます。

500エラーの応答は、`.env` の `APP_DEBUG` によって変わります。true のときは、例外のメッセージ、発生したファイル、呼び出しの履歴（スタックトレース）がJSONに含まれます。開発中には便利ですが、本番で表示するとサーバーの内部構造が攻撃者に知られてしまいます。本番環境では必ず `APP_DEBUG=false` にしてください。false のときは `{"message":"Server Error"}` だけが返り、詳細はログに記録されます（第17章）。

## 9.8 業務上のエラーを自分で定義する

入力の形式は正しくても、業務のルールに反するリクエストもあります。たとえば「未完了のタスクは1人100件まで」というルールを考えます。こうしたエラーは、自分で例外クラスを作ると分かりやすく書けます。

```bash
$ sail artisan make:exception TaskLimitExceededException
```

```php
<?php

namespace App\Exceptions;

use Exception;
use Illuminate\Http\JsonResponse;

class TaskLimitExceededException extends Exception
{
    public function __construct(private int $limit)
    {
        parent::__construct("未完了のタスクは{$limit}件までです。");
    }

    // この例外が起きたときの応答を、例外クラス自身が決める
    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage()], 422);
    }
}
```

コントローラーの store の先頭で、ルールを確かめます。

```php
use App\Exceptions\TaskLimitExceededException;

// クラスの先頭に定数を追加する
private const MAX_OPEN_TASKS = 100;

// store メソッドの先頭に追加する
// 第11章でチームのタスクを加えたら、whereNull('team_id') も足して個人のタスクだけを数える
$openCount = $request->user()->tasks()->where('is_done', false)->count();

// 完了済みとして作るタスクは数に入らないので、確かめない
if (! $request->boolean('is_done') && $openCount >= self::MAX_OPEN_TASKS) {
    throw new TaskLimitExceededException(self::MAX_OPEN_TASKS);
}
```

例外クラスに `render` メソッドを書いておくと、Laravelはそのメソッドで応答を作ります。どこで投げても同じ形のエラーが返るので、エラーの形がそろいます。

なお、この例は例外クラスの使い方を示すためのもので、上限のルールとしてはまだ不完全です。99件の状態で2つの作成が同時に届くと、どちらも確認を通って101件になります。完了済みのタスクを未完了に戻す更新や、第16章のMCPからの作成も確認していません。業務のルールとして厳密に守るなら、ユーザーごとにロックを取り、件数の確認と保存を同じトランザクションの中で行う共通の処理を作り、REST APIとMCPの両方から使います。

## 9.9 動作を確かめる

```bash
$ curl -X POST http://localhost/api/v1/tasks \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"title":"","due_date":"11/20","priority":"urgent"}'
```

Accept ヘッダーを付けていなくても、次のようなJSONが422で返れば成功です。

```json
{
  "message": "タイトルは必須です。（ほか2件のエラー）",
  "errors": {
    "title": ["タイトルは必須です。"],
    "due_date": ["期限はY-m-dの形式で指定してください。"],
    "priority": ["選択された優先度は正しくありません。"]
  }
}
```

## AIに頼むなら

```text
StoreTaskRequest の検証ルールを貼り付けます。
仕様書（docs/openapi.yaml の TaskInput）と比べて、抜けている検証や食い違いを指摘してください。
（ルールと仕様書の該当部分を貼り付ける）
```

- 指摘が仕様書の内容と一致しているかを確かめる
- 既存のアプリが送っている値まで弾くほど、ルールを厳しくしていないかを確かめる（互換性）

## まとめ

- 入力検証はフォームリクエストにまとめ、コントローラーには正しい入力だけを届ける
- `sometimes` と `required` の組み合わせで、部分更新の検証を表す
- APIのリクエストは常にJSONで応答するようにし、内部情報を含むメッセージは差し替える
- 業務ルールのエラーは独自の例外クラスにし、応答の形をそろえる
- 本番では必ず `APP_DEBUG=false` にする

## 演習

1. 基礎：`lang/ja/validation.php` に、after\_or\_equal ルールの日本語メッセージを追加してください。
2. 応用：タスクの作成時だけ、過去の日付を期限にできないルールを追加してください。更新時には過去の日付を許す理由も考えてみましょう。

解答例は付録Eにあります。

## レビュー観点

- [ ] 入力をフォームリクエストで検証している
- [ ] コントローラーでは validated() の値だけを使っている
- [ ] エラーの応答に、クラス名やSQLなどの内部の情報が出ていない
- [ ] APP\_DEBUG=false の状態で、500の応答を確かめた

---

[← 第8章 CRUD APIを実装する](08-crud-api.md) ｜ [目次](../README.md#目次) ｜ [第10章 認証と認可 →](10-auth.md)
