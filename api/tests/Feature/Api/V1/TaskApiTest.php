<?php

namespace Tests\Feature\Api\V1;

use App\Enums\TaskPriority;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
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

    public function test_user_cannot_access_others_task(): void
    {
        $owner = User::factory()->create();
        $task = Task::factory()->for($owner)->create(['title' => '秘密のタスク']);

        $intruder = User::factory()->create();
        Sanctum::actingAs($intruder);

        // 本当に存在しないときと同じ応答にする（第9章、第10章）
        $this->getJson("/api/v1/tasks/{$task->id}")
            ->assertNotFound()
            ->assertExactJson(['message' => 'リソースが見つかりません。']);
        $this->getJson('/api/v1/tasks/999999')
            ->assertNotFound()
            ->assertExactJson(['message' => 'リソースが見つかりません。']);
        $this->patchJson("/api/v1/tasks/{$task->id}", ['title' => '書き換え'])->assertNotFound();
        $this->deleteJson("/api/v1/tasks/{$task->id}")->assertNotFound();

        // データが変わっていないことも確かめる
        $this->assertDatabaseHas('tasks', ['id' => $task->id, 'title' => '秘密のタスク']);
    }

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

    public function test_open_task_limit_is_enforced(): void
    {
        $user = User::factory()->create();
        Task::factory()->count(100)->for($user)->create();
        Sanctum::actingAs($user);

        // 未完了のタスクは100件まで（第9章）
        $this->postJson('/api/v1/tasks', ['title' => '101件目'])
            ->assertUnprocessable()
            ->assertJsonPath('message', '未完了のタスクは100件までです。');

        // 完了済みとして作るタスクは数に入らない
        $this->postJson('/api/v1/tasks', ['title' => '完了済み', 'is_done' => true])
            ->assertCreated();
    }

    public function test_same_idempotency_key_creates_only_one_task(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);
        $headers = ['Idempotency-Key' => 'create-report-1'];

        $first = $this->postJson('/api/v1/tasks', ['title' => 'レポートを書く'], $headers)->assertCreated();

        // 同じキーで再送すると、前回の応答が返り、タスクは増えない（第16章）
        $this->postJson('/api/v1/tasks', ['title' => 'レポートを書く'], $headers)
            ->assertCreated()
            ->assertHeader('Idempotent-Replayed', 'true')
            ->assertJsonPath('data.id', $first->json('data.id'));

        // 同じキーで違う内容を送ると422
        $this->postJson('/api/v1/tasks', ['title' => '別の内容'], $headers)->assertUnprocessable();

        $this->assertDatabaseCount('tasks', 1);
    }
}
