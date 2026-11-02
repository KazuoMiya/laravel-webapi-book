<?php

namespace Tests\Feature\Api\V1;

use App\Enums\TeamRole;
use App\Models\Task;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TeamTaskListTest extends TestCase
{
    use RefreshDatabase;

    public function test_member_can_list_team_tasks_without_n_plus_one(): void
    {
        $team = Team::factory()->create();
        $member = User::factory()->create();
        $team->members()->attach($member->id, ['role' => TeamRole::Member->value]);
        Task::factory()->count(20)->for($team)->for($member)->create(['assignee_id' => $member->id]);
        Sanctum::actingAs($member);

        DB::enableQueryLog();

        $this->getJson("/api/v1/teams/{$team->id}/tasks")
            ->assertOk()
            ->assertJsonCount(15, 'data')
            ->assertJsonPath('data.0.assignee.id', $member->id);

        // タスクの件数が増えても、問い合わせの回数が増えないことを確かめる（第18章）
        $this->assertLessThan(10, count(DB::getQueryLog()));
    }

    public function test_team_tasks_do_not_appear_in_personal_list(): void
    {
        $team = Team::factory()->create();
        $member = User::factory()->create();
        $team->members()->attach($member->id, ['role' => TeamRole::Member->value]);
        Task::factory()->for($team)->for($member)->create();
        Task::factory()->for($member)->create(['title' => '個人のタスク']);
        Sanctum::actingAs($member);

        // チームのタスクは個人の一覧に混ざらない（第11章）
        $this->getJson('/api/v1/tasks')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.title', '個人のタスク');
    }
}
