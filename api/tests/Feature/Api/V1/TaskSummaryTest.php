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
