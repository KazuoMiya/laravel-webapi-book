# 第6章 OpenAPIで仕様書を書く

第5章の設計を、OpenAPIという標準形式の仕様書に書き起こします。仕様書があると、フロントエンドの開発者はAPIの完成を待たずに作業を始められ、ドキュメントの画面も自動で作れます。

## この章のゴール

- OpenAPIの仕様書の骨組みを説明できる
- `$ref` で部品を共有しながら、仕様書を書ける
- Swagger UIとRedocly CLIで、仕様書を表示して確かめられる

## 6.1 OpenAPIとは

OpenAPIは、Web APIの仕様を記述するための世界標準の形式です。URL、メソッド、入力、出力、エラー、認証方法を、YAMLまたはJSONで書きます。以前はSwaggerと呼ばれていたため、今でも「Swagger」という名前がよく使われます。

仕様書を機械が読める形で書くと、次のことができるようになります。

- 見やすいドキュメントの画面を自動で作る
- 画面からAPIを実際に呼び出して試す
- フロントエンド用の型定義やAPIクライアントのコードを自動で作る
- 実装が仕様どおりかを機械的に確かめる

OpenAPIの最新版は2025年9月に公開された3.2ですが、本書では対応ツールの多い3.1で書きます。3.1で書いた仕様書は3.2でもそのまま有効です。

## 6.2 設計が先か、コードが先か

仕様書の作り方には2つの流儀があります。

| 流儀 | 進め方 | 向いている場面 |
| --- | --- | --- |
| 設計ファースト | 先に仕様書を書き、それに合わせて実装する | 複数のチームが並行して開発する。APIを外部に公開する |
| コードファースト | 先に実装し、コードから仕様書を自動生成する | 小さなチームで素早く作る。仕様書の更新忘れを防ぎたい |

本書では両方を体験します。この章では設計ファーストで仕様書を手で書き、実装後の6.7節でコードから自動生成して見比べます。

> 設計判断メモ：設計ファーストを基本にする
>
> 決めたこと：先に仕様書を手で書き、それを約束として実装する。実装した後は、Scrambleで生成した仕様書と見比べてずれを確かめる。
>
> 選ばなかった案：コードファーストだけで進める。仕様書の書き忘れは起きないが、実装が終わるまで仕様書ができず、フロントエンドの開発やAIへの依頼に使えない。
>
> 理由：実装の前から、フロントエンドの開発者やAI（第14章）に仕様書を渡せる。仕様書がテストの観点の出発点にもなる。
>
> 見直す条件：1人で小さなAPIを素早く作る場合は、コードファーストだけでも十分なことがある。

## 6.3 仕様書の骨組み

OpenAPIの仕様書は、次の主要な部分からできています。

| キー | 内容 |
| --- | --- |
| openapi | OpenAPIのバージョン |
| info | APIの名前、バージョン、説明 |
| servers | APIのベースURL |
| security | 全体に適用する認証方式 |
| paths | URLごとの操作（メソッド、入力、出力） |
| components | 繰り返し使う部品（データの形、エラー応答、認証方式） |

YAMLは、インデント（字下げ）で階層を表す形式です。インデントはスペースで行い、タブは使えません。

## 6.4 TaskBoard APIの仕様書

プロジェクト直下に `docs` フォルダーを作り、`docs/openapi.yaml` を次の内容で作成します。紙面の都合で、認証はログインのみ、タスクはすべての操作を載せています。

```yaml
openapi: 3.1.0
info:
  title: TaskBoard API
  version: 1.0.0
  description: タスクを管理するためのWeb API
servers:
  - url: http://localhost/api/v1
    description: ローカル開発環境
security:
  - bearerAuth: []          # 特に指定のない操作はトークン認証が必要
tags:
  - name: 認証
  - name: タスク

paths:
  /login:
    post:
      tags: [認証]
      summary: ログインしてトークンを受け取る
      security: []            # この操作だけは認証不要
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password, device_name]
              properties:
                email: { type: string, format: email }
                password: { type: string, format: password }
                device_name: { type: string, maxLength: 255, examples: ["Taro's iPhone"] }
      responses:
        '200':
          description: ログイン成功
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: object
                    properties:
                      user: { $ref: '#/components/schemas/User' }
                      token: { type: string, examples: ['1|aBcDeF0123456789'] }
        '422': { $ref: '#/components/responses/ValidationError' }
        '429': { $ref: '#/components/responses/TooManyRequests' }

  /tasks:
    get:
      tags: [タスク]
      summary: タスク一覧を取得する
      parameters:
        - { name: is_done, in: query, schema: { type: boolean } }
        - { name: priority, in: query, schema: { $ref: '#/components/schemas/Priority' } }
        - { name: tag, in: query, schema: { type: string } }
        - { name: q, in: query, description: タイトルとメモのキーワード, schema: { type: string, maxLength: 100 } }
        - { name: due_before, in: query, schema: { type: string, format: date } }
        - name: sort
          in: query
          description: 先頭の - は降順
          schema:
            type: string
            enum: [due_date, -due_date, priority, -priority, created_at, -created_at]
            default: -created_at
        - { name: page, in: query, schema: { type: integer, minimum: 1, default: 1 } }
        - { name: per_page, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 15 } }
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TaskCollection' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '422': { $ref: '#/components/responses/ValidationError' }
    post:
      tags: [タスク]
      summary: タスクを作成する
      requestBody:
        required: true
        content:
          application/json:
            schema:
              allOf:
                - $ref: '#/components/schemas/TaskInput'
                - required: [title]   # 作成時はtitleが必須
      responses:
        '201':
          description: 作成成功
          headers:
            Location:
              description: 作成したタスクのURL
              schema: { type: string, format: uri }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TaskResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '422': { $ref: '#/components/responses/ValidationError' }

  /tasks/{task}:
    parameters:
      - { name: task, in: path, required: true, description: タスクのID, schema: { type: integer } }
    get:
      tags: [タスク]
      summary: タスクの詳細を取得する
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TaskResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
    patch:
      tags: [タスク]
      summary: タスクを部分更新する
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/TaskInput' }
      responses:
        '200':
          description: 更新成功
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TaskResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
        '422': { $ref: '#/components/responses/ValidationError' }
    delete:
      tags: [タスク]
      summary: タスクを削除する
      responses:
        '204': { description: 削除成功（ボディなし） }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer

  schemas:
    Priority:
      type: string
      enum: [low, medium, high]
    Tag:
      type: object
      required: [id, name]
      properties:
        id: { type: integer }
        name: { type: string, maxLength: 50 }
    User:
      type: object
      properties:
        id: { type: integer }
        name: { type: string }
        email: { type: string, format: email }
    Task:
      type: object
      required: [id, title, memo, due_date, priority, is_done, tags, created_at, updated_at]
      properties:
        id: { type: integer, examples: [12] }
        title: { type: string, maxLength: 100, examples: [牛乳を買う] }
        memo: { type: [string, 'null'], maxLength: 2000 }
        due_date: { type: [string, 'null'], format: date }
        priority: { $ref: '#/components/schemas/Priority' }
        is_done: { type: boolean }
        tags:
          type: array
          items: { $ref: '#/components/schemas/Tag' }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
    TaskInput:
      type: object
      properties:
        title: { type: string, minLength: 1, maxLength: 100 }
        memo: { type: [string, 'null'], maxLength: 2000 }
        due_date: { type: [string, 'null'], format: date }
        priority: { $ref: '#/components/schemas/Priority' }
        is_done: { type: boolean }
        tags:
          type: array
          maxItems: 10
          uniqueItems: true     # 同じタグ名を重複して送れない
          items: { type: string, minLength: 1, maxLength: 50 }
    TaskResponse:
      type: object
      properties:
        data: { $ref: '#/components/schemas/Task' }
    TaskCollection:
      type: object
      properties:
        data:
          type: array
          items: { $ref: '#/components/schemas/Task' }
        links:
          type: object
          properties:
            first: { type: [string, 'null'] }
            last: { type: [string, 'null'] }
            prev: { type: [string, 'null'] }
            next: { type: [string, 'null'] }
        meta:
          type: object
          properties:
            current_page: { type: integer }
            last_page: { type: integer }
            per_page: { type: integer }
            total: { type: integer }
    Error:
      type: object
      required: [message]
      properties:
        message: { type: string }
    ValidationError:
      type: object
      required: [message, errors]
      properties:
        message: { type: string }
        errors:
          type: object
          additionalProperties:
            type: array
            items: { type: string }

  responses:
    Unauthorized:
      description: 認証されていない
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
          example: { message: Unauthenticated. }
    NotFound:
      description: 見つからない（他人のタスクを含む）
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    ValidationError:
      description: 入力に誤りがある
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ValidationError' }
    TooManyRequests:
      description: 回数制限を超えた
      headers:
        Retry-After:
          schema: { type: integer }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
```

## 6.5 読み方のポイント

`$ref` は「別の場所に定義した部品を参照する」という意味です。タスクの形は `components/schemas/Task` に1回だけ書き、詳細、作成、更新のすべてから参照しています。同じことを何度も書かずに済み、修正も1か所で終わります。

`type: [string, 'null']` は「文字列またはnull」という意味です。memo や due\_date のように、値がないこともある項目に使います。

作成時だけtitleを必須にするために、`allOf` で「TaskInputの形」と「titleが必須」という2つの条件を組み合わせています。部分更新（PATCH）では、TaskInputをそのまま使うので必須項目はありません。

> つまずきポイント：YAMLの書き方で画面が表示されない
>
> YAMLでは、インデント（字下げ）のずれが意味の違いになります。インデントにタブを使っている、同じ階層の行でスペースの数が違う、コロンの後にスペースがない、といった誤りがよくあります。Swagger UIが真っ白になったり、項目が表示されなかったりしたら、6.6節の Redocly CLI でエラーの行を確かめましょう。

## 6.6 Swagger UIで表示する

Swagger UIは、OpenAPIの仕様書を見やすい画面で表示するツールです。Sailの `compose.yaml` の `services:` の中に、次のサービスを追加します。

```yaml
    swagger-ui:
        image: 'swaggerapi/swagger-ui'
        ports:
            - '8081:8080'
        environment:
            SWAGGER_JSON: /spec/openapi.yaml
        volumes:
            - './docs:/spec'
        networks:
            - sail
```

```bash
$ sail up -d
```

ブラウザーで http://localhost:8081 を開くと、APIの一覧が表示されます。各APIを開くと、入力と出力の形、ステータスコードごとの応答が確認できます。実装が進んだ後は、画面右上の Authorize ボタンからトークンを入力し、Try it out ボタンでAPIを実際に呼び出せます。Swagger UI（localhost:8081）からAPI（localhost）への呼び出しは別のオリジンになるため、第10章で作る config/cors.php の allowed\_origins に http://localhost:8081 も加えておいてください。

仕様書の書き方の誤りは、Redocly CLIで機械的にチェックできます。SailのコンテナーにはNode.jsが入っているので、次のように実行します。

```bash
$ sail npx @redocly/cli lint docs/openapi.yaml
```

## 6.7 コードから仕様書を生成する（Scramble）

この節は、第8章から第10章でAPIを実装した後に読んでください。

Scrambleは、Laravelのコードを解析してOpenAPIの仕様書を自動生成するパッケージです。ルート、入力検証のルール、APIリソースから、入力と出力の形を読み取ります。コードにコメントを大量に書き足す必要がないのが特長です。

```bash
$ sail composer require dedoc/scramble
```

インストールすると、2つのURLが追加されます。

| URL | 内容 |
| --- | --- |
| http://localhost/docs/api | 生成されたドキュメントの画面 |
| http://localhost/docs/api.json | OpenAPI形式の仕様書（JSON） |

これらのURLは、標準では開発環境（APP\_ENV=local）でしか表示されません。本番で公開したい場合は、表示を許可する条件をGateで定義します（第10章で扱う認可の仕組みです）。

手で書いた仕様書と、生成された仕様書を見比べてみましょう。違いがあれば、設計と実装のどちらかがずれています。本書では、手で書いた `docs/openapi.yaml` を「約束（契約）」として扱い、生成された仕様書は実装の確認に使います。

生成した仕様書はファイルに書き出せます。

```bash
$ sail artisan scramble:export
```

## AIに頼むなら

仕様書は、AIにテストの観点を洗い出してもらうときの良い材料になります。

```text
次の OpenAPI の仕様書のうち、/tasks の定義から、テストすべきケースを
「正常な場合」「入力の誤り」「権限」の3つに分けて列挙してください。
仕様書に書かれていない動きは推測せず、「仕様に記載なし」と書いてください。
（docs/openapi.yaml の該当部分を貼り付ける）
```

- 「仕様に記載なし」と出てきたケースは、仕様書の書き漏れかどうかを判断する
- 洗い出したケースは、第13章の自動テストに生かす

## まとめ

- OpenAPIは、APIの仕様を人と機械の両方が読める形で書く世界標準
- 繰り返し使う形は components に定義し、$ref で参照する
- Swagger UIで画面表示し、Redocly CLIで書き方の誤りを検出できる
- Scrambleを使うと、実装から仕様書を生成して設計とのずれを確かめられる

## 演習

1. 基礎：GET /tags（自分のタグ一覧）の定義を仕様書に追加し、Redocly CLIのチェックを通してください。
2. 応用：第11章を読んだ後で、チームのタスクの一覧と作成（/teams/{team}/tasks）を仕様書に追加してください。If-Matchヘッダーと、412、428の応答も記述しましょう。

解答例は付録Eにあります。

## レビュー観点

- [ ] すべての操作に、成功とエラーの応答が書かれている
- [ ] 同じ形は components に定義し、`$ref` で共有している
- [ ] Redocly CLIのチェックでエラーがない
- [ ] 実装と仕様書が食い違っていない

---

[← 第5章 Web APIを設計する](05-api-design.md) ｜ [目次](../README.md#目次) ｜ [第7章 データベースとEloquent ORM →](07-database-eloquent.md)
