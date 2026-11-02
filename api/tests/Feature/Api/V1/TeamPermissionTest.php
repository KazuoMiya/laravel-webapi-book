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
