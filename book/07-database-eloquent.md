# 第7章 データベースとEloquent ORM

この章では、タスクとタグを保存するテーブルを作り、PHPのコードからデータを読み書きできるようにします。SQLを直接書かずに、Eloquent ORMを通してデータベースを操作します。

## この章のゴール

- マイグレーションでテーブルを作り、変更できる
- モデルのリレーションと #\[Fillable\] を正しく設定できる
- N+1問題を見つけて、with で直せる

## 7.1 テーブルの基本

リレーショナルデータベースは、データを表（テーブル）の形で保存します。表の1行が1件のデータ（レコード）、1列が1つの項目（カラム）です。

| 用語 | 意味 |
| --- | --- |
| 主キー | 行を一意に識別する列。本書では自動で番号が振られる id |
| 外部キー | 他のテーブルの行を指す列。tasks.user\_id は users.id を指す |
| インデックス | 検索を速くするための索引。よく絞り込む列に付ける |
| 中間テーブル | 多対多の関係を表すためのテーブル |

ORM（Object-Relational Mapping）は、テーブルの1行をPHPのオブジェクト1つとして扱えるようにする仕組みです。LaravelのORMをEloquentと呼びます。

## 7.2 テーブルを設計する

第5章の設計をもとに、次の4つのテーブルを用意します。users は最初から用意されています。

| テーブル | 主な列 | 備考 |
| --- | --- | --- |
| users | id、name、email、password | Laravel標準。email は重複不可 |
| tasks | id、user\_id、title、memo、due\_date、priority、is\_done | priority は1〜3の数値 |
| tags | id、user\_id、name | 同じユーザーの中で name は重複不可 |
| tag\_task | task\_id、tag\_id | タスクとタグの多対多をつなぐ中間テーブル |

中間テーブルの名前は、2つのモデル名を単数形にしてアルファベット順に並べ、アンダースコアでつなぐのがLaravelの決まりです。tag と task なので tag\_task になります。

## 7.3 モデルとマイグレーションを作る

マイグレーションは、テーブルの設計図をPHPで書いたファイルです。ファイルとしてGitで管理できるので、チームの全員が同じテーブル構成を再現できます。

モデル、マイグレーション、ファクトリー（7.8節）をまとめて作ります。`-mf` は migration と factory の頭文字です。

```bash
$ sail artisan make:model Task -mf
$ sail artisan make:model Tag -mf
$ sail artisan make:migration create_tag_task_table
```

`database/migrations/` に、日時で始まる名前のファイルが3つできます。日時の順に実行されるので、tasks と tags より後に tag\_task が作られます。

tasks テーブルのマイグレーションを書きます。

```php
<?php
// database/migrations/xxxx_xx_xx_xxxxxx_create_tasks_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 100);
            $table->text('memo')->nullable();
            $table->date('due_date')->nullable();
            $table->unsignedTinyInteger('priority')->default(2);
            $table->boolean('is_done')->default(false);
            $table->timestamps();   // created_at と updated_at

            // 「自分の」「未完了の」タスクを「期限順」に探すことが多いので索引を付ける
            $table->index(['user_id', 'is_done', 'due_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tasks');
    }
};
```

`up` はテーブルを作る処理、`down` は取り消す処理です。`foreignId('user_id')->constrained()` は、users テーブルの id を指す外部キーを作ります。`cascadeOnDelete()` を付けると、ユーザーが削除されたときにそのユーザーのタスクも自動で削除されます。

tags と tag\_task も同様に書きます。

```php
// create_tags_table.php の up()
Schema::create('tags', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('name', 50);
    $table->timestamps();

    $table->unique(['user_id', 'name']);   // 同じユーザーに同名のタグを作らせない
});

// create_tag_task_table.php の up()
Schema::create('tag_task', function (Blueprint $table) {
    $table->foreignId('task_id')->constrained()->cascadeOnDelete();
    $table->foreignId('tag_id')->constrained()->cascadeOnDelete();

    $table->primary(['task_id', 'tag_id']); // 同じ組み合わせを二重に登録させない
});
```

マイグレーションを実行します。

```bash
$ sail artisan migrate
```

| コマンド | 内容 |
| --- | --- |
| sail artisan migrate | まだ実行していないマイグレーションを実行する |
| sail artisan migrate:status | 各マイグレーションの実行状況を表示する |
| sail artisan migrate:rollback | 直前に実行したまとまりを取り消す |
| sail artisan migrate:fresh | 全テーブルを削除して最初から作り直す（開発中のみ） |

一度共有したマイグレーションファイルは、書き換えずに新しいマイグレーションを追加して変更するのが原則です。他の人の環境や本番環境は、すでに古い内容で実行済みだからです。

## 7.4 優先度の列挙型

第2章で紹介した列挙型を使って、優先度を表します。`app/Enums/TaskPriority.php` を作成します。

```php
<?php

namespace App\Enums;

enum TaskPriority: int
{
    case Low = 1;
    case Medium = 2;
    case High = 3;

    // APIで使う文字列（low、medium、high）
    public function key(): string
    {
        return strtolower($this->name);
    }

    // APIの文字列から列挙型に変換する
    public static function fromKey(string $key): self
    {
        foreach (self::cases() as $case) {
            if ($case->key() === $key) {
                return $case;
            }
        }

        throw new \ValueError("Unknown priority: {$key}");
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_map(fn (self $case) => $case->key(), self::cases());
    }
}
```

データベースには1〜3の数値で保存し、APIでは low、medium、high を使います。数値で保存するのは、優先度順の並べ替えを簡単にするためです。

> 設計判断メモ：優先度は数値で保存する
>
> 決めたこと：優先度はデータベースに1〜3の数値で保存し、APIでは low、medium、high の文字列で返す。
>
> 選ばなかった案：low などの文字列で保存する方法や、MySQLのENUM型を使う方法。文字列で保存すると、優先度の高い順に並べ替えるときに工夫が要る。ENUM型は、段階を増やすたびにテーブルの変更が必要になる。
>
> 理由：数値なら並べ替えが簡単で、APIの形とデータベースの形を切り離せる。
>
> 見直す条件：優先度の段階を利用者が自由に増やせるようにするなど、段階そのものを管理したくなったときは、別のテーブルにする。

## 7.5 モデルを書く

`app/Models/Task.php` を次のように書きます。

```php
<?php

namespace App\Models;

use App\Enums\TaskPriority;
use Database\Factories\TaskFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

#[Fillable(['title', 'memo', 'due_date', 'priority', 'is_done'])]
class Task extends Model
{
    /** @use HasFactory<TaskFactory> */
    use HasFactory;

    // 作成時に指定されなかった列の初期値（データベースの初期値とそろえる）
    protected $attributes = [
        'priority' => 2,
        'is_done' => false,
    ];

    // データベースの値をPHPの型に変換する
    protected function casts(): array
    {
        return [
            'due_date' => 'date',
            'priority' => TaskPriority::class,
            'is_done' => 'boolean',
        ];
    }

    // このタスクの持ち主（タスクは1人のユーザーに属する）
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    // このタスクに付いたタグ（多対多）
    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class);
    }
}
```

クラスの上の `#[Fillable([...])]` は、`create` や `update` で一度にまとめて代入してよい列の一覧です。ここに user\_id を含めていない点が重要です。もし含めると、利用者が送ってきたJSONに user\_id を混ぜるだけで、他人のタスクとして登録できてしまいます。この攻撃をマスアサインメントと呼びます（第12章）。user\_id は、後で見るようにリレーションを通して設定します。

`casts()` は、データベースの値を使いやすい型に変換する設定です。is\_done はデータベースでは 0 と 1 ですが、PHPでは true と false になります。priority は数値から TaskPriority に、due\_date は日付を扱うオブジェクトになります。

`$attributes` は、モデルを作るときの初期値です。データベースにも初期値（priority は2、is\_done は false）を設定していますが、それは保存した後のデータベースの中だけの話です。作成直後のモデルにも同じ値を持たせておかないと、作成APIの応答で priority や is\_done が null になってしまいます。

`app/Models/Tag.php` も書きます。

```php
<?php

namespace App\Models;

use Database\Factories\TagFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

#[Fillable(['name'])]
class Tag extends Model
{
    /** @use HasFactory<TagFactory> */
    use HasFactory;

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function tasks(): BelongsToMany
    {
        return $this->belongsToMany(Task::class);
    }
}
```

最後に `app/Models/User.php` に、トークン発行の機能（第10章で使う）と、タスクとタグへのリレーションを追加します。

```php
<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',   // 保存時に自動でハッシュ化する
        ];
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function tags(): HasMany
    {
        return $this->hasMany(Tag::class);
    }
}
```

`#[Hidden([...])]` に書いた列は、モデルをJSONに変換するときに出力されません。パスワードのハッシュ値が誤ってAPIの応答に含まれるのを防ぎます。

## 7.6 Eloquentで操作してみる

Tinkerで、モデルの操作を試してみましょう。

```bash
$ sail tinker
```

```php
// ユーザーを作る（passwordは自動でハッシュ化される）
$user = App\Models\User::create(['name' => '太郎', 'email' => 'taro@example.com', 'password' => 'password']);

// リレーション経由でタスクを作る。user_id は自動で入る
$task = $user->tasks()->create(['title' => '牛乳を買う', 'priority' => App\Enums\TaskPriority::High]);

// 取得する
App\Models\Task::find($task->id);                         // IDで1件
$user->tasks()->where('is_done', false)->get();          // 条件に合うものすべて
$user->tasks()->orderBy('due_date')->first();            // 並べ替えて先頭の1件

// 更新する
$task->update(['is_done' => true]);

// タグを付ける
$tag = $user->tags()->create(['name' => '買い物']);
$task->tags()->sync([$tag->id]);   // 指定したタグだけが付いた状態にする
$task->tags;                       // 付いているタグを取得

// 削除する
$task->delete();
```

Eloquentは、これらの操作を裏側でSQLに変換して実行しています。`where` に渡した値は自動で安全に処理されるため、SQLインジェクション（第12章）の心配もありません。

> つまずきポイント：マイグレーションを書き換えたのに反映されない
>
> 一度実行したマイグレーションは、ファイルを書き換えても再び実行されません。まだ誰とも共有していない開発中のマイグレーションなら、`sail artisan migrate:rollback` で取り消してから `sail artisan migrate` を実行します。すでに共有したマイグレーションは書き換えず、変更用の新しいマイグレーションを作ります。

## 7.7 N+1問題と事前読み込み

タスク一覧を表示するときに、それぞれのタグも取り出すとします。素直に書くと次のようになります。

```php
$tasks = $user->tasks()->get();      // SQL 1回
foreach ($tasks as $task) {
    $task->tags;                     // タスクの数だけSQLが実行される
}
```

タスクが100件あると、SQLが101回実行されます。これをN+1問題と呼び、APIが遅くなる代表的な原因です。`with` を使うと、関連データをまとめて読み込めます。

```php
$tasks = $user->tasks()->with('tags')->get();   // SQL 2回で済む
```

この書き忘れを開発中に気づけるように、`app/Providers/AppServiceProvider.php` に設定を追加します。

```php
use Illuminate\Database\Eloquent\Model;

public function boot(): void
{
    // 本番以外では、withを書き忘れた読み込みをエラーにする
    Model::preventLazyLoading(! $this->app->isProduction());
}
```

> 設計判断メモ：削除は物理削除にする
>
> 決めたこと：タスクを削除したら、データベースから本当に消す（物理削除）。
>
> 選ばなかった案：論理削除（Laravelの SoftDeletes）。削除した日時を記録するだけで行を残すので、後から復元できる。ただし「削除済みを除く」条件の付け忘れや、一意の制約との兼ね合いなど、考えることが増える。
>
> 理由：個人のタスクには、復元の要件がない。仕組みを単純に保てる。
>
> 見直す条件：チームでの誤削除を復元したいという要望が出たとき。誰が何を消したかを記録したいだけなら、第17章の監査ログで対応できる。

## 7.8 ファクトリーでダミーデータを作る

ファクトリーは、テストや開発用のダミーデータを作る仕組みです。`database/factories/TaskFactory.php` を書きます。

```php
<?php

namespace Database\Factories;

use App\Enums\TaskPriority;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Task>
 */
class TaskFactory extends Factory
{
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'title' => fake()->realText(30),
            'memo' => fake()->optional()->realText(100),
            'due_date' => fake()->optional()->dateTimeBetween('-1 week', '+1 month'),
            'priority' => fake()->randomElement(TaskPriority::cases()),
            'is_done' => false,
        ];
    }

    // 完了済みのタスクを作るときに使う
    public function done(): static
    {
        return $this->state(fn () => ['is_done' => true]);
    }
}
```

`fake()` はダミーの文章や日付を作る関数です。`.env` に `APP_FAKER_LOCALE=ja_JP` を書くと、日本語のダミーデータになります。

`database/factories/TagFactory.php` は簡単です。

```php
// ファイルの先頭の use の並びに追加する（User::factory() を使うため）
use App\Models\User;

// definition の中身を書き換える
public function definition(): array
{
    return [
        'user_id' => User::factory(),
        'name' => fake()->unique()->word(),
    ];
}
```

## 7.9 シーダーで開発用データを入れる

シーダーは、データベースに初期データを入れる仕組みです。`database/seeders/DatabaseSeeder.php` を書き換えます。

```php
<?php

namespace Database\Seeders;

use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // ログイン確認用のユーザー（パスワードは password）
        $user = User::factory()->create([
            'name' => 'テストユーザー',
            'email' => 'test@example.com',
        ]);

        $tags = collect(['仕事', '買い物', '家', '勉強'])
            ->map(fn (string $name) => $user->tags()->create(['name' => $name]));

        Task::factory()
            ->count(30)
            ->for($user)
            ->create()
            ->each(fn (Task $task) => $task->tags()->sync(
                $tags->random(rand(0, 2))->pluck('id')
            ));

        Task::factory()->count(10)->for($user)->done()->create();

        // 他人のタスク（第10章で「見えないこと」を確かめるため）
        Task::factory()->count(5)->create();
    }
}
```

テーブルを作り直してデータを入れます。

```bash
$ sail artisan migrate:fresh --seed
```

`migrate:fresh` はすべてのテーブルを削除するので、開発環境だけで使ってください。

## AIに頼むなら

```text
tasks テーブルに、完了日時を記録する completed_at 列を追加するマイグレーションを書いてください。
既存のマイグレーションは書き換えずに新しいファイルにすること、
down で元に戻せることを条件にします。
```

- 既存のマイグレーションファイルを変更していないかを確かめる
- down が up のちょうど逆の操作になっているかを確かめる
- モデルの #\[Fillable\] や casts の変更が必要かを、自分で判断する

## まとめ

- マイグレーションでテーブルの設計図をコードとして管理する
- モデルの #\[Fillable\] で一括代入できる列を限定し、user\_id は含めない
- リレーションを定義すると、`$user->tasks()` のように関連データを扱える
- 一覧では `with` で関連データを事前に読み込み、N+1問題を避ける
- ファクトリーとシーダーで、テストと開発用のデータを手早く作れる

## 演習

1. 基礎：TaskFactory に、期限切れの未完了タスクを作る overdue() 状態を追加してください。
2. 応用：tasks テーブルに completed\_at 列を追加し、is\_done が true になったときに完了日時を記録し、false に戻したら null にしてください。

解答例は付録Eにあります。

## レビュー観点

- [ ] 外部キーと、よく絞り込む列のインデックスがある
- [ ] \#\[Fillable\] に、user\_id などの所有者の列を含めていない
- [ ] 一覧では with で関連データを事前に読み込んでいる
- [ ] 共有済みのマイグレーションを書き換えていない

---

[← 第6章 OpenAPIで仕様書を書く](06-openapi.md) ｜ [目次](../README.md#目次) ｜ [第8章 CRUD APIを実装する →](08-crud-api.md)
