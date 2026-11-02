# 第14章 AIと一緒に開発する

AIコーディングエージェントは、指示を受けてコードを書き、テストを実行し、誤りを直すところまで手伝ってくれます。うまく使えば開発は大きく速くなりますが、もっともらしい誤りを自信ありげに書くこともあります。この章では、ここまでに身につけた設計、テスト、レビューの力を、AIと組み合わせて使う方法を学びます。

## この章のゴール

- AIに依頼するときに渡すべき情報（仕様書、権限の表、テスト）を準備できる
- AIが生成したコードを、決めた観点でレビューできる
- AIに任せる範囲と、人が判断する範囲を説明できる

## 14.1 AIとの開発で変わること、変わらないこと

ここでいうAIコーディングエージェントは、エディターやターミナルの中で動き、プロジェクトのファイルを読み、コードを書き換え、コマンドを実行するところまで行うAIのことです。

| 変わること | 変わらないこと |
| --- | --- |
| コードの下書きを書く速さ | 何を作るか、どう設計するかを決める責任 |
| 定型的なコード（ひな形、テストの追加）の手間 | 認可のルールを決める責任 |
| エラーの原因を探す初動の速さ | 動作をテストで確かめる責任 |
| 知らない書き方を調べる手間 | マージしたコードに対する責任 |

AIは「書く」作業を肩代わりしてくれますが、「決める」と「確かめる」は人に残ります。本書で学んだ設計判断、テスト、レビューの観点は、AIを使うほど重要になります。

> 設計判断メモ：AIに任せる範囲
>
> 決めたこと：仕様（OpenAPI）、権限の表、テストは人が決め、それを満たす実装の下書きと、テストケースの追加案をAIに任せる。
>
> 選ばなかった案：仕様からテストまでをすべてAIに任せる。最も速いが、仕様とテストが同じ誤解を共有すると、テストが通っても間違ったものができる。また、AIをまったく使わない案は、品質は保てても速さで大きく後れを取る。
>
> 理由：「何が正しいか」を人が決めておけば、AIの出力をその基準で機械的に確かめられる。速さと品質を両立でき、責任の所在も明確になる。
>
> 見直す条件：チームがAIの得意、不得意を把握し、レビューの仕組みが整ったら、任せる範囲を少しずつ広げる。

## 14.2 Laravel Boostで文脈を渡す

AIが的外れなコードを書く大きな原因は、プロジェクトの事情を知らないことです。Laravel公式のLaravel Boostを入れると、AIエージェントにLaravel向けの情報と道具を渡せます。

```bash
$ sail composer require laravel/boost --dev
$ sail artisan boost:install
```

インストーラーは、使っているエディターやAIエージェントを検出して、必要な設定を行います。Boostを入れたAIエージェントは、次のようなことができるようになります。

- インストールされているパッケージとそのバージョンを把握する
- 使っているバージョンに合ったLaravelのドキュメントを検索する
- 開発用のデータベースに問い合わせたり、Tinkerでコードを試したりする
- Laravelが用意した、AI向けの書き方の指針に従う

さらに、プロジェクト独自のルールを `.ai/guidelines/` フォルダーにMarkdownで書いておくと、`boost:install` を実行したときにAI向けの指針に取り込まれます。本書のルールをまとめて `.ai/guidelines/taskboard.md` に書いておきましょう。

```markdown
# TaskBoard API の開発ルール

- APIの応答は必ずAPIリソース（app/Http/Resources）を通す。モデルをそのまま返さない
- 入力はフォームリクエストで検証し、コントローラーでは validated() の値だけを使う
- user_id と team_id を #[Fillable] に入れない。リレーション経由で設定する
- 個人のデータは $request->user() から、チームのデータは $team から問い合わせを始める
- 権限の判定は Policy に書き、コントローラーでは Gate::authorize を呼ぶ
- 他人や他のチームのデータには404を返す
- エラーの形は {"message": ...}、入力の誤りは {"message": ..., "errors": {...}}
- 機能を追加したら、正常な場合、入力の誤り、権限のテストを tests/Feature に書く
```

Boostの道具はデータベースにも接続できるので、AIエージェントには必ず開発用の環境だけを使わせてください。本番の接続情報をAIに渡してはいけません。

## 14.3 依頼の型

AIへの依頼は、人に仕事を頼むときと同じです。目的と前提があいまいだと、もっともらしい別物が返ってきます。次の5つをそろえて頼みます。

| 項目 | 書くこと |
| --- | --- |
| 目的 | 何を実現したいか |
| 前提 | 仕様書の該当部分、応答の形、関係するファイルの場所 |
| 制約 | 変えてはいけないこと、従うべきルール |
| 完了の条件 | どのテストが通れば完成か、整形のチェック |
| 出力 | 変更したファイルと理由の説明など、報告してほしいこと |

例として、個人のタスクの件数をまとめて返す GET /api/v1/tasks/summary を追加する依頼を書いてみます。

```text
目的：
個人のタスクの件数をまとめて返す GET /api/v1/tasks/summary を追加したい。

前提：
- 仕様：docs/openapi.yaml に追記した /tasks/summary の定義（下に貼る）
- 応答の形：{"data": {"open": 12, "overdue": 3, "due_today": 2}}
  open は未完了の件数、overdue は期限が昨日以前の未完了の件数、
  due_today は期限が今日の未完了の件数
- 既存の一覧APIは app/Http/Controllers/Api/V1/TaskController.php にある

制約：
- ログイン中のユーザーの個人のタスク（team_id が null）だけを数える
- 既存のAPIの形と動きは変えない
- .ai/guidelines のルールに従う

完了の条件：
- tests/Feature/Api/V1/TaskSummaryTest.php のテストがすべて通る
- sail pint --test でエラーがない

出力：
変更したファイルと、それぞれの変更理由を短く説明してください。
```

## 14.4 テストを先に書いてから頼む

完了の条件にあるテストは、依頼の前に人が書いておきます。テストは「何が正しいか」をAIに伝える最も確実な方法であり、AIの出力を確かめる道具にもなります。

```php
<?php

namespace Tests\Feature\Api\V1;

use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskSummaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_summary_counts_only_my_open_personal_tasks(): void
    {
        $this->travelTo(now()->setDate(2026, 11, 10)->startOfDay());   // 「今日」を固定する

        $user = User::factory()->create();
        Task::factory()->for($user)->create(['due_date' => '2026-11-09']);          // 期限切れ
        Task::factory()->for($user)->create(['due_date' => '2026-11-10']);          // 今日が期限
        Task::factory()->for($user)->create(['due_date' => null]);                  // 期限なし
        Task::factory()->for($user)->done()->create(['due_date' => '2026-11-01']);  // 完了済みは数えない
        Task::factory()->create(['due_date' => '2026-11-09']);                      // 他人のタスク

        Sanctum::actingAs($user);

        $this->getJson('/api/v1/tasks/summary')
            ->assertOk()
            ->assertExactJson(['data' => ['open' => 3, 'overdue' => 1, 'due_today' => 1]]);
    }

    public function test_guest_cannot_get_summary(): void
    {
        $this->getJson('/api/v1/tasks/summary')->assertUnauthorized();
    }
}
```

`travelTo` は、テストの中だけ現在の日時を固定するメソッドです。「今日」や「期限切れ」を扱うテストは、日付を固定しないと、実行する日によって結果が変わってしまいます。

AIにはこのテストを渡し、「このテストが通るように実装して」と頼みます。AIが出した実装のうち、たとえば次のようなものなら合格です。

```php
// routes/api.php（apiResource('tasks', ...) より前に書く）
Route::get('/tasks/summary', [TaskController::class, 'summary'])->name('tasks.summary');

// TaskController
public function summary(Request $request): JsonResponse
{
    $open = $request->user()->tasks()->whereNull('team_id')->where('is_done', false);

    return response()->json([
        'data' => [
            'open' => (clone $open)->count(),
            'overdue' => (clone $open)->whereDate('due_date', '<', today())->count(),
            'due_today' => (clone $open)->whereDate('due_date', today())->count(),
        ],
    ]);
}
```

> つまずきポイント：/tasks/summary が404になる
>
> ルートは上から順に照合されます。`apiResource('tasks', ...)` より後に /tasks/summary を書くと、先に /tasks/{task} に一致し、「summary というIDのタスク」を探して404になります。AIもよくこの順番を間違えます。固定の文字列のURLは、パラメーターを含むURLより前に書きましょう。先にテストを書いておけば、この誤りはすぐに見つかります。

## 14.5 生成されたコードをレビューする

AIのコードは、文法的には正しく、動いているように見えることがほとんどです。危ないのは、動くけれど安全でないコードです。次は、「チームのタスクの一覧と作成のAPIを作って」とだけ頼んだときに出てきそうなコードです。

```php
public function index(Request $request, Team $team)
{
    $tasks = Task::where('team_id', $team->id)->get();

    foreach ($tasks as $task) {
        $task->assignee_name = $task->assignee->name;
    }

    return response()->json($tasks);
}

public function store(Request $request, Team $team)
{
    $task = Task::create($request->all() + ['team_id' => $team->id]);

    return response()->json($task);
}
```

このコードには、少なくとも次の問題があります。

| 問題 | なぜ危ないか | 正しくは |
| --- | --- | --- |
| 認可がない | メンバー以外でも、チームIDを変えるだけで他のチームのタスクが見える | Gate::authorize とPolicy（第11章） |
| 件数の上限がない | タスクが数万件あると、応答が極端に遅くなる | paginate（第8章） |
| N+1問題 | タスクの数だけ担当者を問い合わせる | with('assignee')（第7章） |
| モデルをそのまま返している | テーブルの列がすべて、データベースの形のまま出る | APIリソース（第8章） |
| 入力を検証していない | 文字数も型も確かめずに保存する | フォームリクエスト（第9章） |
| $request->all() を使っている | Fillableの範囲なら何でも代入され、team\_id はFillableにないため保存に失敗する | validated() とリレーション（第7章、第11章） |
| 作成時に200を返している | 設計では201とLocationヘッダー | 第5章の設計どおりに返す |

レビューでは、次の観点を順に確かめます。本書の各章末にある「レビュー観点」を集めたものです。

| 観点 | 見るところ | 関係する章 |
| --- | --- | --- |
| 認可 | Policyで判定し、自分やチームから始まる問い合わせになっているか | 第10章、第11章 |
| 入力 | フォームリクエストで検証し、validated() だけを使っているか | 第9章 |
| 一括代入 | Fillableに所有者の列がなく、$request->all() を使っていないか | 第7章、第12章 |
| 性能 | with で事前に読み込み、件数に上限があるか | 第7章、第8章 |
| 応答の形 | APIリソースを通し、設計どおりのステータスコードか | 第5章、第8章 |
| 秘密情報 | コードやログに秘密情報が含まれていないか | 第12章、第17章 |
| 実在するか | 存在しない関数やオプション、古いバージョンの書き方がないか | 公式ドキュメント |
| テスト | 正常な場合、入力の誤り、権限のテストがあるか | 第13章 |

「実在するか」は、AI特有の観点です。AIは、それらしい名前の関数やオプションを作り出してしまうことがあります。見慣れない書き方があれば、公式ドキュメントで確かめましょう。

## 14.6 AIに任せないこと

- 権限の表を決めること。何を誰に許すかは、サービスの方針そのものです
- 本番環境への操作と、本番データへのアクセス。AIに本番の接続情報を渡さない
- 秘密情報の入力。.env の中身やトークンを、依頼の文章に貼り付けない
- データを消すコマンドの実行。`migrate:fresh` などは、AIエージェントの設定で実行前に必ず確認を求めるようにする
- 依存パッケージの追加の判断。追加する理由、保守の状況、ライセンスを人が確かめる

## 14.7 チームでの利用ルール

チームでAIを使うときは、次のようなルールを決めておくと混乱を防げます。

- AIが書いたコードも、人が書いたコードと同じレビューを通す
- 誰が書いたかに関わらず、マージした人とレビューした人が責任を持つ
- 依頼に秘密情報や個人情報を含めない
- 利用するAIサービスが、入力をどう扱うか（学習に使われるかなど）を会社の方針と照らして確認する
- `.ai/guidelines` をチームで育てる。AIが同じ誤りを繰り返したら、ルールを1行足す

## まとめ

- AIは「書く」を速くするが、「決める」と「確かめる」は人に残る
- Laravel Boostと `.ai/guidelines` で、AIにプロジェクトの事情を伝える
- 依頼には目的、前提、制約、完了の条件、出力をそろえ、テストを先に書いて渡す
- 生成されたコードは、認可、入力、一括代入、性能、応答の形、秘密情報、実在するか、テストの観点でレビューする

## 演習

1. 基礎：`.ai/guidelines/taskboard.md` に、第11章の「チームのタスクの更新には If-Match を求める」というルールを書き足してください。
2. 応用：次のコードは、メンバーの役割を変更するAPIとしてAIが書いたものです。14.5節のレビュー観点を使って問題をすべて指摘し、修正版を書いてください。

```php
public function update(Request $request, Team $team, User $user)
{
    $team->members()->updateExistingPivot($user->id, $request->all());

    return response()->json($team->members()->find($user->id));
}
```

解答例は付録Eにあります。

## レビュー観点

- [ ] 依頼に、目的、前提、制約、完了の条件、出力を書いた
- [ ] 依頼の前にテストを書き、AIの実装でそのテストが通ることを確かめた
- [ ] 生成されたコードを、14.5節の観点で確認した
- [ ] 依頼に秘密情報や本番の接続情報を含めていない

---

[← 第13章 自動テスト](13-testing.md) ｜ [目次](../README.md#目次) ｜ [第15章 ReactからAPIを呼び出す →](15-react-clients.md)
