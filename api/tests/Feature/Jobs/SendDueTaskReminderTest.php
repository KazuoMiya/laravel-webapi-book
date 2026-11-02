<?php

namespace Tests\Feature\Jobs;

use App\Enums\TeamRole;
use App\Jobs\SendDueTaskReminder;
use App\Models\Task;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SendDueTaskReminderTest extends TestCase
{
    use RefreshDatabase;

    public function test_reminder_targets_my_open_tasks_due_on_the_date(): void
    {
        $user = User::factory()->create();
        $target = Task::factory()->for($user)->create(['due_date' => '2026-11-04']);
        Task::factory()->for($user)->create(['due_date' => '2026-11-05']);            // 別の日
        Task::factory()->for($user)->done()->create(['due_date' => '2026-11-04']);    // 完了済み
        Task::factory()->create(['due_date' => '2026-11-04']);                        // 他人のタスク

        $job = new SendDueTaskReminder($user, '2026-11-04');

        $this->assertSame([$target->id], $job->targetTasks()->pluck('id')->all());
    }

    // 第17章：チームを抜けた後は、そのチームのタスクを通知しない
    public function test_reminder_excludes_tasks_of_a_team_the_user_left(): void
    {
        $user = User::factory()->create();
        $team = Team::factory()->create();
        $team->members()->attach($user->id, ['role' => TeamRole::Member->value]);
        Task::factory()->for($team)->for($user)->create(['due_date' => '2026-11-04', 'assignee_id' => $user->id]);

        $team->members()->detach($user->id);   // チームから外す

        $job = new SendDueTaskReminder($user, '2026-11-04');
        $this->assertCount(0, $job->targetTasks());
    }
}
