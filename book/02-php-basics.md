# 第2章 本書で使うPHPの基礎

Laravelのコードを読み書きするのに必要なPHPの文法は、この章の範囲で足ります。網羅的な文法書ではなく、本書で実際に登場する書き方だけに絞って説明します。

この章のコードは読むだけで理解できるように書いてあります。第3章でDockerを入れた後なら、次のコマンドで手元のファイルを実行できます。

```bash
$ docker run --rm -v "$PWD":/app -w /app php:8.5-cli php sample.php
```

## この章のゴール

- 変数、配列、関数、クラスを読み書きできる
- 名前空間と use の関係を説明できる
- Composerの役割を説明できる

## 2.1 PHPのファイルと出力

PHPのファイルは `<?php` で始めます。`echo` は文字を画面に出力する命令で、文の終わりには必ずセミコロン `;` を付けます。

```php
<?php

echo 'こんにちは、Laravel';
// 1行コメント。実行されない
/* 複数行の
   コメント */
```

## 2.2 変数と型

変数は値を入れておく箱で、名前の先頭に `$` を付けます。PHPは入れた値によって型が決まります。

```php
<?php

$title = '牛乳を買う';   // 文字列（string）
$priority = 2;          // 整数（int）
$progress = 0.5;        // 小数（float）
$isDone = false;        // 真偽値（bool）
$memo = null;           // 値がない（null）

echo "タスク：{$title}";    // ダブルクォートの中では変数が展開される
echo 'タスク：' . $title;   // . で文字列をつなぐ
```

シングルクォート `'...'` の中では変数は展開されません。展開したいときはダブルクォート `"..."` を使います。

値がnullかもしれないときに便利な書き方が2つあります。

```php
$memo = null;
echo $memo ?? 'メモなし';     // ?? 左がnullなら右を使う → メモなし

$user = null;
echo $user?->name;            // ?-> 左がnullならエラーにせずnullを返す
```

## 2.3 配列

配列は複数の値をまとめる入れ物です。番号で取り出す配列と、名前（キー）で取り出す連想配列があります。Web APIでは、連想配列がそのままJSONのオブジェクトになるため、連想配列を特によく使います。

```php
<?php

$tags = ['買い物', '家'];          // 番号付きの配列
echo $tags[0];                     // 買い物（番号は0から）
$tags[] = '急ぎ';                  // 末尾に追加

$task = [                          // 連想配列
    'title' => '牛乳を買う',
    'priority' => 2,
    'tags' => $tags,
];
echo $task['title'];               // 牛乳を買う

foreach ($task['tags'] as $tag) {  // 1つずつ取り出して繰り返す
    echo $tag;
}

echo json_encode($task, JSON_UNESCAPED_UNICODE);
// {"title":"牛乳を買う","priority":2,"tags":["買い物","家","急ぎ"]}
```

最後の `json_encode` は、PHPの配列をJSONの文字列に変換する関数です。Laravelはこの変換を自動で行ってくれるため、本書ではほとんど直接は使いません。

## 2.4 条件分岐

```php
<?php

$priority = 3;

if ($priority === 3) {
    echo '高';
} elseif ($priority === 2) {
    echo '中';
} else {
    echo '低';
}

// match は値に応じて結果を1つ選ぶ
$label = match ($priority) {
    3 => '高',
    2 => '中',
    default => '低',
};
```

比較には `===`（型も値も同じ）を使い、`==` は使わないようにしましょう。`==` は型を自動で変換して比べるため、`'1' == 1` が真になるなど、思わぬ結果を招きます。

## 2.5 関数

関数は処理に名前を付けてまとめたものです。引数と戻り値に型を書くと、型に合わない値が渡されたときにエラーで気づけます。ただしPHPは標準では、'5' のような数字の文字列を int に自動で変換して受け付けます。ファイルの先頭に declare(strict\_types=1); と書くと、こうした変換をせずにエラーにする厳密なモードになります。

```php
<?php

function priorityLabel(int $priority): string
{
    return match ($priority) {
        3 => '高',
        2 => '中',
        default => '低',
    };
}

echo priorityLabel(3);   // 高

// 名前のない短い関数（アロー関数）
$double = fn (int $n): int => $n * 2;
echo $double(4);         // 8
```

アロー関数は、Laravelで「この処理を後で実行して」と関数を渡す場面でよく使います。

> 設計判断メモ：型宣言を必ず書く
>
> 決めたこと：関数やメソッドの引数と戻り値には、必ず型を書く。
>
> 選ばなかった案：型を省略して短く書く。書く量は減るが、間違った値が渡されても気づくのが遅れる。
>
> 理由：誤りがその場でエラーになり、原因を見つけやすい。エディターの補完も効き、AIが生成したコードの誤りも見つけやすくなる。
>
> 見直す条件：基本的に見直さない。PHP 8以降の標準的な書き方であり、Laravel自身もこの書き方をしている。

## 2.6 クラスとオブジェクト

クラスは、データ（プロパティ）と処理（メソッド）をひとまとめにした設計図です。設計図から `new` で作った実体をオブジェクト（インスタンス）と呼びます。Laravelのコードはほぼすべてクラスで書かれます。

```php
<?php

class Task
{
    // コンストラクターの引数に public を付けると、そのままプロパティになる
    public function __construct(
        public string $title,
        public bool $isDone = false,
    ) {
    }

    public function complete(): void
    {
        $this->isDone = true;   // $this は「このオブジェクト自身」
    }
}

$task = new Task('牛乳を買う');
$task->complete();              // -> でメソッドやプロパティを使う
echo $task->isDone ? '完了' : '未完了';
```

プロパティやメソッドの前に付く `public` は、外から使ってよいという意味です。外から使わせたくないものには `private` や `protected` を付けます。

オブジェクトを作らずにクラスから直接呼べるメソッドを「静的メソッド」と呼び、`::` で呼び出します。Laravelでは `Route::get(...)` や `Task::create(...)` の形でよく登場します。

## 2.7 継承とインターフェース

`extends` を使うと、既存のクラスの機能を引き継いだ新しいクラスを作れます。Laravelでは、フレームワークが用意したクラスを継承して自分のクラスを作るのが基本です。

```php
<?php

use Illuminate\Database\Eloquent\Model;

class Task extends Model   // Modelの機能（保存、検索など）をすべて引き継ぐ
{
}
```

インターフェースは「このメソッドを必ず持つこと」という約束事です。クラスに `implements` で付けます。本書では自分で作る場面は少なく、Laravelの機能を使う目印として登場します。

## 2.8 列挙型（enum）

列挙型は、取りうる値が決まっているものに名前を付ける仕組みです。本書ではタスクの優先度に使います。

```php
<?php

enum TaskPriority: int
{
    case Low = 1;
    case Medium = 2;
    case High = 3;
}

$p = TaskPriority::from(3);   // 数値から変換
echo $p->name;                // High
echo $p->value;               // 3
```

「優先度は1から3」と数値のまま扱うより、`TaskPriority::High` と書けるほうが意味が伝わり、ありえない値の混入も防げます。

## 2.9 名前空間とuse

大きなアプリでは、同じ名前のクラスがぶつからないように「名前空間」で住所を付けます。ファイルの先頭で `namespace` を宣言し、別の住所のクラスは `use` で呼び込みます。

```php
<?php

namespace App\Http\Controllers;   // このファイルのクラスの住所

use App\Models\Task;              // 別の住所にあるTaskクラスを使う
use Illuminate\Http\JsonResponse;

class TaskController
{
    // ここでは Task と短く書ける
}
```

Laravelでは、名前空間とフォルダーの位置が対応しています。`App\Models\Task` は `app/Models/Task.php` にあります。

> つまずきポイント：Class "Task" not found というエラー
>
> 原因のほとんどは、use の書き忘れか、namespace とフォルダーの位置のずれです。まずファイルの先頭に `use App\Models\Task;` があるかを確かめます。次に、そのクラスのファイルの namespace が、置き場所のフォルダーと一致しているか（`App\Models` なら `app/Models`）を確かめます。大文字と小文字の違いも、Linuxのコンテナーの中では別の名前として扱われます。

## 2.10 アトリビュート

アトリビュートは、クラスやメソッドに `#[...]` で付ける「付せん」のような情報です。Laravel 13ではアトリビュートで設定を書ける場面が増えました。

```php
#[Hidden(['password'])]   // このモデルをJSONにするときpasswordを隠す
class User extends Model
{
}
```

## 2.11 例外

処理を続けられない問題が起きたときに、それを知らせる仕組みが例外です。`throw` で例外を投げ、`try` と `catch` で受け止めます。

```php
<?php

function findTask(int $id): array
{
    if ($id <= 0) {
        throw new InvalidArgumentException('IDは1以上を指定してください');
    }
    return ['id' => $id];
}

try {
    findTask(0);
} catch (InvalidArgumentException $e) {
    echo $e->getMessage();
}
```

Laravelでは、例外を投げると自動で適切なHTTPレスポンスに変換されます。たとえば「データが見つからない」例外は404に、「入力が不正」の例外は422になります。この仕組みは第9章で詳しく扱います。

## 2.12 Composer

ComposerはPHPのパッケージ管理ツールです。他の人が作った便利な部品（パッケージ）をインストールし、その部品が必要とする別の部品もまとめて用意してくれます。Laravel自体もComposerでインストールします。

| ファイル・フォルダー | 役割 |
| --- | --- |
| composer.json | 使うパッケージとバージョンの一覧（人が編集する） |
| composer.lock | 実際にインストールした正確なバージョンの記録（自動生成） |
| vendor/ | インストールされたパッケージの置き場所（Gitには含めない） |

```bash
$ composer require dedoc/scramble   # パッケージを追加する
$ composer install                  # composer.lockどおりに入れ直す
```

Composerにはもう1つ重要な役割があります。名前空間とフォルダーの対応を読んで、`use` したクラスのファイルを自動で読み込む「オートロード」です。このおかげで、Laravelでは `require` でファイルを1つずつ読み込む必要がありません。

## AIに頼むなら

```text
次のPHPの関数に、引数と戻り値の型宣言を追加してください。
型が合わない呼び出し方があれば指摘してください。PHP 8.5で動く書き方にしてください。
（関数を貼り付ける）
```

- 存在しない関数名や、古いPHPの書き方が混ざっていないかを確かめる
- 実際に実行して、型のエラーが出ないことを確かめる

## まとめ

- 変数は `$` で始め、文は `;` で終える
- 連想配列はそのままJSONのオブジェクトになる
- 比較は `===`、nullの扱いには `??` と `?->` が便利
- Laravelのコードはクラス、名前空間、継承で組み立てられている
- パッケージとクラスの読み込みはComposerが担当する

## 演習

1. 基礎：タスクのタイトルと優先度（1〜3の数値）を受け取り、「\[高\] 牛乳を買う」の形の文字列を返す関数 formatTask を、型宣言付きで書いてください。
2. 応用：2.8節の TaskPriority 列挙型に、日本語の名前（低、中、高）を返す label() メソッドを追加してください。

解答例は付録Eにあります。

## レビュー観点

- [ ] 引数と戻り値に型を書いている
- [ ] 比較に === を使っている
- [ ] namespace とフォルダーの位置が一致している
- [ ] 使うクラスを use で読み込んでいる

---

[← 第1章 Web APIとは何か](01-what-is-web-api.md) ｜ [目次](../README.md#目次) ｜ [第3章 Dockerで開発環境を作る →](03-docker.md)
