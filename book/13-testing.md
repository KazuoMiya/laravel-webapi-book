# 第13章 自動テスト

この章では、APIが設計どおりに動くことを確かめるテストをコードで書きます。テストがあれば、機能を追加したりライブラリを更新したりしても、壊れていないことを数十秒で確認できます。最後に、GitHubに変更を送るたびにテストが自動で動く仕組み（CI）を作ります。

## この章のゴール

- Featureテストで、APIの入力と出力を確かめられる
- 他人や他のチームのデータを操作できないことを、テストで保証できる
- GitHub Actionsで、テストを自動で実行できる

## 13.1 なぜ自動テストを書くのか

これまではcurlで動作を確かめてきました。しかし、APIが10個、確認したい場面が100通りになると、手作業では確認しきれません。特に「他人のタスクが見えない」のような安全に関わる確認は、変更のたびに必ず行う必要があります。

| テストの種類 | 対象 | 本書での使い方 |
| --- | --- | --- |
| ユニットテスト | クラスやメソッド単体 | 列挙型の変換などの小さな処理 |
| Featureテスト | HTTPリクエストから応答まで | APIの入力と出力、認証、認可を確かめる（本章の中心） |

Web APIでは、Featureテストを中心に書くのが効果的です。利用者と同じ立場で、リクエストを送って応答を確かめるからです。

## 13.2 テスト用のデータベース

テストのたびにデータを作ったり消したりするため、開発用とは別のデータベースを使います。第3章で触れたとおり、SailはMySQLに `testing` データベースを用意し、`phpunit.xml` もそれを使うように設定しています。`phpunit.xml` に次の行があることを確認してください。

```xml
<env name="DB_DATABASE" value="testing"/>
```

テストを実行してみます。最初から入っているサンプルのテストが動きます。

```bash
$ sail test
```

Laravelのテストは、PHPUnitまたはPestという仕組みの上で動きます。どちらで作ったプロジェクトでも動くように、本書では従来からあるPHPUnitの書き方を使います。Pestを選んだプロジェクトでも、PHPUnitの書き方のテストはそのまま実行できます。

> 設計判断メモ：テストでも本物のMySQLを使う
>
> 決めたこと：Featureテストは、SailのMySQL（testing データベース）で実行する。
>
> 選ばなかった案：データベースの処理をモック（偽物）に置き換える方法は速いが、SQLの誤り、制約の違反、N+1問題を見逃す。SQLiteのメモリー上のデータベースを使う方法も速いが、行のロックや並び順など、本番のMySQLと動きが違う部分がある。
>
> 理由：本番と同じ種類のデータベースで確かめられる。速さは、並列実行（13.9節）で補える。
>
> 見直す条件：テストが遅くなりすぎて開発の妨げになったら、データベースを使わない計算の部分をユニットテストに切り出す。

## 13.3 最初のFeatureテスト

タスクAPIのテストファイルを作ります。

```bash
$ sail artisan make:test Api/V1/TaskApiTest --phpunit
```

`tests/Feature/Api/V1/TaskApiTest.php` を次のように書きます。

```php
<?php

namespace Tests\Feature\Api\V1;

use App\Enums\TaskPriority;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskApiTest extends TestCase
{
    use RefreshDatabase;   // テストごとにデータベースを空の状態に戻す

    public function test_guest_cannot_list_tasks(): void
    {
        $response = $this->getJson('/api/v1/tasks');

        $response->assertUnauthorized();   // 401
    }

    public function test_user_can_list_only_own_tasks(): void
    {
        // 準備：自分のタスク3件と、他人のタスク2件
        $user = User::factory()->create();
        Task::factory()->count(3)->for($user)->create();
        Task::factory()->count(2)->create();

        // 実行：自分としてログインした状態で一覧を取得
        Sanctum::actingAs($user);
        $response = $this->getJson('/api/v1/tasks');

        // 確認：自分の3件だけが返る
        $response
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonStructure([
                'data' => [['id', 'title', 'memo', 'due_date', 'priority', 'is_done', 'tags', 'created_at', 'updated_at']],
                'links' => ['first', 'last', 'prev', 'next'],
                'meta' => ['current_page', 'last_page', 'per_page', 'total'],
            ]);
    }
}
```

テストは「準備、実行、確認」の3段で書くと読みやすくなります。各メソッドは、名前が `test_` で始まっていれば自動でテストとして実行されます。

| 書き方 | 意味 |
| --- | --- |
| $this->getJson(URL) | JSONを求めるGETリクエストを送る。postJson、patchJson、deleteJson もある |
| Sanctum::actingAs($user) | そのユーザーとしてログインした状態にする |
| assertOk()、assertCreated()、assertNoContent() | 200、201、204であること |
| assertUnauthorized()、assertNotFound()、assertUnprocessable() | 401、404、422であること |
| assertJsonPath('data.title', '値') | JSONの指定した場所の値 |
| assertJsonCount(3, 'data') | 指定した場所の配列の要素数 |
| assertJsonStructure(\[...\]) | 指定したキーがそろっていること |
| assertJsonValidationErrors(\['title'\]) | 指定した項目に検証エラーがあること |
| assertDatabaseHas('tasks', \[...\])、assertDatabaseMissing(...) | データベースに行がある、ないこと |

```bash
$ sail test --filter=TaskApiTest
```

## 13.4 作成、更新、削除のテスト

同じクラスにテストを追加していきます。

```php
public function test_user_can_create_task_with_tags(): void
{
    $user = User::factory()->create();
    Sanctum::actingAs($user);

    $response = $this->postJson('/api/v1/tasks', [
        'title' => 'レポートを書く',
        'due_date' => '2026-11-20',
        'priority' => 'high',
        'tags' => ['仕事', '急ぎ'],
    ]);

    $response
        ->assertCreated()
        ->assertHeader('Location')
        ->assertJsonPath('data.title', 'レポートを書く')
        ->assertJsonPath('data.priority', 'high')
        ->assertJsonPath('data.is_done', false)
        ->assertJsonCount(2, 'data.tags');

    $this->assertDatabaseHas('tasks', [
        'user_id' => $user->id,
        'title' => 'レポートを書く',
        'priority' => TaskPriority::High->value,
    ]);
    $this->assertDatabaseHas('tags', ['user_id' => $user->id, 'name' => '急ぎ']);
}

public function test_user_can_mark_task_as_done(): void
{
    $user = User::factory()->create();
    $task = Task::factory()->for($user)->create(['title' => '元のタイトル']);
    Sanctum::actingAs($user);

    $this->patchJson("/api/v1/tasks/{$task->id}", ['is_done' => true])
        ->assertOk()
        ->assertJsonPath('data.is_done', true)
        ->assertJsonPath('data.title', '元のタイトル');   // 送っていない項目は変わらない
}

public function test_user_can_delete_task(): void
{
    $user = User::factory()->create();
    $task = Task::factory()->for($user)->create();
    Sanctum::actingAs($user);

    $this->deleteJson("/api/v1/tasks/{$task->id}")->assertNoContent();

    $this->assertDatabaseMissing('tasks', ['id' => $task->id]);
}
```

## 13.5 他人のデータを守るテスト

第12章で、最も多い脆弱性は「IDを変えると他人のデータを操作できる」問題だと説明しました。このテストは必ず書きます。

```php
public function test_user_cannot_access_others_task(): void
{
    $owner = User::factory()->create();
    $task = Task::factory()->for($owner)->create(['title' => '秘密のタスク']);

    $intruder = User::factory()->create();
    Sanctum::actingAs($intruder);

    $this->getJson("/api/v1/tasks/{$task->id}")->assertNotFound();
    $this->patchJson("/api/v1/tasks/{$task->id}", ['title' => '書き換え'])->assertNotFound();
    $this->deleteJson("/api/v1/tasks/{$task->id}")->assertNotFound();

    // データが変わっていないことも確かめる
    $this->assertDatabaseHas('tasks', ['id' => $task->id, 'title' => '秘密のタスク']);
}
```

## 13.6 入力検証のテストをまとめて書く

入力の誤りのパターンは多いので、データプロバイダーを使って「入力」と「エラーになる項目」の組をまとめて試します。

```php
use PHPUnit\Framework\Attributes\DataProvider;

public static function invalidTaskProvider(): array
{
    return [
        'タイトルなし' => [['title' => ''], 'title'],
        'タイトルが長すぎる' => [['title' => str_repeat('あ', 101)], 'title'],
        '期限の形式が違う' => [['title' => 'a', 'due_date' => '11/20'], 'due_date'],
        '存在しない優先度' => [['title' => 'a', 'priority' => 'urgent'], 'priority'],
        'タグが多すぎる' => [['title' => 'a', 'tags' => range(1, 11)], 'tags'],
    ];
}

#[DataProvider('invalidTaskProvider')]
public function test_invalid_task_input_is_rejected(array $input, string $field): void
{
    Sanctum::actingAs(User::factory()->create());

    $this->postJson('/api/v1/tasks', $input)
        ->assertUnprocessable()
        ->assertJsonValidationErrors([$field]);
}
```

`#[DataProvider(...)]` は、第2章で紹介したアトリビュートです。データの組の数だけ、テストが繰り返し実行されます。

## 13.7 絞り込みのテスト

```php
public function test_tasks_can_be_filtered_by_priority_and_tag(): void
{
    $user = User::factory()->create();
    $work = $user->tags()->create(['name' => '仕事']);

    $target = Task::factory()->for($user)->create(['priority' => TaskPriority::High]);
    $target->tags()->attach($work);
    Task::factory()->for($user)->create(['priority' => TaskPriority::High]);   // タグなし
    Task::factory()->for($user)->create(['priority' => TaskPriority::Low]);

    Sanctum::actingAs($user);

    $this->getJson('/api/v1/tasks?priority=high&tag=仕事')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $target->id);
}

public function test_per_page_is_limited_to_100(): void
{
    Sanctum::actingAs(User::factory()->create());

    $this->getJson('/api/v1/tasks?per_page=1000')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['per_page']);
}
```

## 13.8 認証のテスト

```bash
$ sail artisan make:test Api/V1/AuthApiTest --phpunit
```

```php
<?php

namespace Tests\Feature\Api\V1;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_login_and_access_me_with_token(): void
    {
        $user = User::factory()->create(['password' => 'secret-pass']);

        $token = $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'secret-pass',
            'device_name' => 'test',
        ])->assertOk()->json('data.token');

        $this->withToken($token)
            ->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.email', $user->email);
    }

    public function test_login_fails_with_wrong_password(): void
    {
        $user = User::factory()->create(['password' => 'secret-pass']);

        $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'wrong-pass',
            'device_name' => 'test',
        ])->assertUnprocessable()->assertJsonValidationErrors(['email']);
    }

    public function test_token_cannot_be_used_after_logout(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('test')->plainTextToken;

        $this->withToken($token)->postJson('/api/v1/logout')->assertNoContent();

        // テスト中はログイン状態が記憶されているので、いったん忘れさせる
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_login_is_rate_limited(): void
    {
        $payload = ['email' => 'nobody@example.com', 'password' => 'x', 'device_name' => 'test'];

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/login', $payload)->assertUnprocessable();
        }

        $this->postJson('/api/v1/login', $payload)->assertTooManyRequests();   // 6回目は429
    }
}
```

`withToken($token)` は、Authorization: Bearer ヘッダーを付けてリクエストを送るメソッドです。`Sanctum::actingAs` と違い、実際のトークンの発行から照合までを通して確かめられます。

ログアウトのテストにある `forgetGuards()` は、テスト特有の注意点です。テストでは1つのテストの中で複数のリクエストを送りますが、Laravelは一度確認したログイン状態を覚えています。そのままだと、トークンを削除した後もログイン済みとみなされてしまうため、記憶を消してから次のリクエストを送ります。

> つまずきポイント：1つずつなら通るのに、まとめて実行すると失敗する
>
> テスト同士が影響し合っている合図です。まず、テストのクラスに `use RefreshDatabase;` があるかを確かめます。ないと、前のテストのデータが残ります。次に、「今日」や「期限切れ」を扱うテストで、日時を `travelTo` で固定しているかを確かめます。実行する時刻によって結果が変わるテストは、ある日突然失敗します。

## 13.9 テストを実行する

```bash
$ sail test                        # すべて
$ sail test --filter=AuthApiTest   # クラスやメソッド名で絞り込む
$ sail test --parallel             # 並列に実行して速くする
```

すべて成功すると、緑色で PASS が並びます。失敗したテストは、期待した値と実際の値の違いが表示されます。テストがどのくらいのコードを通ったか（カバレッジ）を測るには、`.env` に `SAIL_XDEBUG_MODE=coverage` を設定して `sail test --coverage` を実行します。

## 13.10 GitHub ActionsでCIを作る

CI（継続的インテグレーション）は、変更をリポジトリに送るたびに、テストなどの確認を自動で行う仕組みです。GitHubに標準で備わっているGitHub Actionsを使います。

プロジェクトに `.github/workflows/tests.yml` を作成します。

```yaml
name: tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      mysql:
        image: mysql:8.4
        env:
          MYSQL_ROOT_PASSWORD: password
          MYSQL_DATABASE: testing
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping -ppassword"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

    env:
      DB_CONNECTION: mysql
      DB_HOST: 127.0.0.1
      DB_PORT: 3306
      DB_DATABASE: testing
      DB_USERNAME: root
      DB_PASSWORD: password

    steps:
      - uses: actions/checkout@v5

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.5'
          extensions: mbstring, pdo_mysql
          coverage: none

      - name: 依存パッケージのインストール
        run: composer install --no-interaction --prefer-dist --no-progress

      - name: 環境設定
        run: |
          cp .env.example .env
          php artisan key:generate

      - name: コードの書き方のチェック
        run: vendor/bin/pint --test

      - name: テスト
        run: php artisan test

      - name: 依存パッケージの脆弱性チェック
        run: composer audit

      - name: OpenAPI仕様書のチェック
        run: npx @redocly/cli lint docs/openapi.yaml

      # 第17章で本番用のイメージを作ったら追加する
      - name: 本番用イメージのビルドと起動の確認
        run: |
          docker build -t taskboard-api:ci .
          docker run --rm --entrypoint php taskboard-api:ci artisan --version
```

CIでは、Sailの代わりにGitHubが用意する仮想マシンとMySQLのコンテナーを使います。環境変数でデータベースの接続先を指定しているので、`.env` の値より優先されます。

このファイルをGitHubに送ると、リポジトリの Actions タブで実行結果を確認できます。プルリクエストを作ると、テストが失敗している変更には印が付きます。ただし、印が付くだけでは取り込みそのものは止まりません。リポジトリの設定でブランチの保護（RulesetやBranch protection rule）を作り、このワークフローの成功を必須のチェックにすると、テストが失敗している変更は main ブランチに取り込めなくなります。

ワークフローの最後のステップ（本番用イメージのビルド）は、第17章で本番用のイメージを作った後に加えます。テストは開発用のパッケージも入った状態で動くので、本番用の依存関係だけで起きる失敗はテストでは見つかりません。イメージを作り、アプリが起動できるかまで確かめておくと安心です。

`vendor/bin/pint` は、Laravelに付属するコード整形ツールです。手元では `sail pint` で整形できます。チーム全員のコードの書き方がそろい、レビューで本質的な議論に集中できます。

## 13.11 役割と権限をテストする

第11章の役割と権限の表は、そのままテストにできます。表の1行を1つのデータプロバイダーにすると、表とテストが対応し、権限のルールを変えたときに直す場所もすぐ分かります。

```bash
$ sail artisan make:test Api/V1/TeamPermissionTest --phpunit
```

```php
<?php

namespace Tests\Feature\Api\V1;

use App\Enums\TeamRole;
use App\Models\Task;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class TeamPermissionTest extends TestCase
{
    use RefreshDatabase;

    // 指定した役割で、チームのメンバーを作る
    private function memberOf(Team $team, TeamRole $role): User
    {
        $user = User::factory()->create();
        $team->members()->attach($user->id, ['role' => $role->value]);

        return $user;
    }

    // 11.1節の表の「他人のタスクの更新、削除」の行
    public static function updateOthersTaskProvider(): array
    {
        return [
            'owner は更新できる' => [TeamRole::Owner, 200],
            'admin は更新できる' => [TeamRole::Admin, 200],
            'member は更新できない' => [TeamRole::Member, 403],
            'viewer は更新できない' => [TeamRole::Viewer, 403],
        ];
    }

    #[DataProvider('updateOthersTaskProvider')]
    public function test_updating_others_task_depends_on_role(TeamRole $role, int $status): void
    {
        $team = Team::factory()->create();
        $author = $this->memberOf($team, TeamRole::Member);
        $task = Task::factory()->for($team)->for($author)->create();

        Sanctum::actingAs($this->memberOf($team, $role));

        $this->patchJson("/api/v1/tasks/{$task->id}", ['title' => '変更'], ['If-Match' => '"v1"'])
            ->assertStatus($status);
    }

    public function test_viewer_cannot_create_team_task(): void
    {
        $team = Team::factory()->create();
        Sanctum::actingAs($this->memberOf($team, TeamRole::Viewer));

        $this->postJson("/api/v1/teams/{$team->id}/tasks", ['title' => '新しいタスク'])
            ->assertForbidden();
    }

    public function test_non_member_cannot_see_team_or_its_tasks(): void
    {
        $team = Team::factory()->create();
        $task = Task::factory()->for($team)->create();
        Sanctum::actingAs(User::factory()->create());

        $this->getJson("/api/v1/teams/{$team->id}/tasks")->assertNotFound();
        $this->getJson("/api/v1/tasks/{$task->id}")->assertNotFound();
    }

    public function test_stale_or_missing_if_match_is_rejected(): void
    {
        $team = Team::factory()->create();
        $owner = $this->memberOf($team, TeamRole::Owner);
        $task = Task::factory()->for($team)->for($owner)->create();
        Sanctum::actingAs($owner);

        $this->patchJson("/api/v1/tasks/{$task->id}", ['title' => '1回目'], ['If-Match' => '"v1"'])
            ->assertOk()
            ->assertHeader('ETag', '"v2"');

        // 古い版を指定した更新は412、版を指定しない更新は428
        $this->patchJson("/api/v1/tasks/{$task->id}", ['title' => '2回目'], ['If-Match' => '"v1"'])
            ->assertStatus(412);
        $this->patchJson("/api/v1/tasks/{$task->id}", ['title' => '3回目'])
            ->assertStatus(428);
    }

    public function test_invitation_cannot_be_used_by_another_email(): void
    {
        $team = Team::factory()->create();
        $team->invitations()->create([
            'email' => 'invited@example.com',
            'role' => 'member',
            'token_hash' => hash('sha256', 'secret-token'),
            'expires_at' => now()->addDay(),
            'invited_by' => $team->owner_id,
        ]);

        Sanctum::actingAs(User::factory()->create(['email' => 'other@example.com']));

        $this->postJson('/api/v1/invitations/secret-token/accept')->assertNotFound();
        $this->assertDatabaseCount('team_user', 0);
    }
}
```

データプロバイダーには、列挙型の値もそのまま渡せます。テストの名前（'owner は更新できる' など）は、失敗したときに表示されるので、表の言葉で書いておくと原因がすぐ分かります。

## AIに頼むなら

表の組み合わせをすべて洗い出す作業は、AIに頼むと漏れを減らせます。

```text
11.1節の役割と権限の表を貼り付けます。
この表のすべての行と役割の組み合わせを確かめる PHPUnit のテストを、データプロバイダーを使って書いてください。
既存の TeamPermissionTest の書き方に合わせてください。
（表と既存のテストを貼り付ける）
```

- 表のすべての組み合わせが入っているかを、数を数えて確かめる
- 期待するステータスコードが、表と一致しているかを確かめる
- テストが失敗したら、テストとコードのどちらが表と違うのかを、人が判断する

## まとめ

- APIのテストは、リクエストを送って応答を確かめるFeatureテストを中心に書く
- 「他人のデータを操作できない」ことは必ずテストで確かめる
- データプロバイダーで、入力検証の多くのパターンをまとめて試せる
- GitHub Actionsで、変更のたびにテスト、整形チェック、脆弱性チェックを自動で行う

## 演習

1. 基礎：優先度の高い順の並べ替え（sort=-priority）が正しく動くことを確かめるテストを書いてください。
2. 応用：11.1節の表の「チーム名の変更、メンバーの招待、役割の変更」と「チームの削除」の行について、4つの役割すべての組み合わせをテストしてください。

解答例は付録Eにあります。

## レビュー観点

- [ ] 正常な場合だけでなく、入力の誤りと権限のテストがある
- [ ] 他人や他のチームのデータへのアクセスが拒否されることをテストしている
- [ ] 日時に依存するテストでは、travelTo で日時を固定している
- [ ] CIで、テストが自動で実行される

---

[← 第12章 Web APIのセキュリティ](12-security.md) ｜ [目次](../README.md#目次) ｜ [第14章 AIと一緒に開発する →](14-ai-assisted-development.md)
