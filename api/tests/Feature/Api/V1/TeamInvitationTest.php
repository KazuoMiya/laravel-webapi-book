<?php

namespace Tests\Feature\Api\V1;

use App\Enums\TeamRole;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TeamInvitationTest extends TestCase
{
    use RefreshDatabase;

    private function adminOf(Team $team): User
    {
        $admin = User::factory()->create();
        $team->members()->attach($admin->id, ['role' => TeamRole::Admin->value]);

        return $admin;
    }

    private function invite(Team $team, string $email, string $token): void
    {
        $team->invitations()->create([
            'email' => $email,
            'role' => TeamRole::Member->value,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDay(),
            'invited_by' => $team->owner_id,
        ]);
    }

    public function test_reissuing_an_invitation_leaves_only_the_latest_one(): void
    {
        $team = Team::factory()->create();
        Sanctum::actingAs($this->adminOf($team));

        $this->postJson("/api/v1/teams/{$team->id}/invitations", ['email' => 'Hanako@Example.com', 'role' => 'member'])->assertCreated();
        $latest = $this->postJson("/api/v1/teams/{$team->id}/invitations", ['email' => 'hanako@example.com', 'role' => 'admin'])
            ->assertCreated()
            ->json('data.id');

        $this->assertSame([$latest], $team->invitations()->whereNull('accepted_at')->pluck('id')->all());
    }

    public function test_accepting_removes_other_pending_invitations(): void
    {
        $team = Team::factory()->create();
        $this->invite($team, 'hanako@example.com', 'first-token');
        $this->invite($team, 'hanako@example.com', 'second-token');
        Sanctum::actingAs(User::factory()->create(['email' => 'hanako@example.com']));

        $this->postJson('/api/v1/invitations/first-token/accept')->assertOk();

        $this->assertDatabaseMissing('team_invitations', ['token_hash' => hash('sha256', 'second-token')]);
    }

    public function test_removed_member_cannot_rejoin_with_an_old_invitation(): void
    {
        $team = Team::factory()->create();
        $admin = $this->adminOf($team);
        $hanako = User::factory()->create(['email' => 'hanako@example.com']);
        $team->members()->attach($hanako->id, ['role' => TeamRole::Member->value]);
        // メンバーになったあとに、同じ人あての招待が作られていた場合
        $this->invite($team, 'hanako@example.com', 'leftover-token');

        Sanctum::actingAs($admin);
        $this->deleteJson("/api/v1/teams/{$team->id}/members/{$hanako->id}")->assertNoContent();

        Sanctum::actingAs($hanako);
        $this->postJson('/api/v1/invitations/leftover-token/accept')->assertNotFound();
        $this->assertNull($team->roleOf($hanako));
    }
}
