<?php

namespace Tests\Feature\Mcp;

use App\Mcp\Servers\TaskBoardServer;
use App\Mcp\Tools\CreateTaskTool;
use App\Mcp\Tools\ListTasksTool;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskBoardServerTest extends TestCase
{
    use RefreshDatabase;

    public function test_list_tasks_returns_my_open_tasks(): void
    {
        $user = User::factory()->create();
        Task::factory()->for($user)->create(['title' => 'Buy milk']);
        Sanctum::actingAs($user, ['agent', 'tasks:read']);

        TaskBoardServer::actingAs($user)
            ->tool(ListTasksTool::class, [])
            ->assertOk()
            ->assertSee('Buy milk');
    }

    public function test_read_only_token_cannot_create_task(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['agent', 'tasks:read']);

        TaskBoardServer::actingAs($user)
            ->tool(CreateTaskTool::class, ['title' => 'Write report'])
            ->assertHasErrors();

        $this->assertDatabaseCount('tasks', 0);
    }

    public function test_agent_token_cannot_use_rest_api(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['agent', 'tasks:read', 'tasks:write']);

        $this->getJson('/api/v1/tasks')->assertForbidden();
    }
}
