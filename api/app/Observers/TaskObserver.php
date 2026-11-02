<?php

namespace App\Observers;

use App\Models\ActivityLog;
use App\Models\Task;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Context;
use Laravel\Sanctum\PersonalAccessToken;

class TaskObserver
{
    public function created(Task $task): void
    {
        $this->record($task, 'task.created', $task->only(['title', 'priority', 'is_done']));
    }

    public function updated(Task $task): void
    {
        $this->record($task, 'task.updated', Arr::except($task->getChanges(), ['updated_at', 'version']));
    }

    public function deleted(Task $task): void
    {
        $this->record($task, 'task.deleted', ['title' => $task->title]);
    }

    private function record(Task $task, string $action, array $changes): void
    {
        $user = auth()->user();

        $token = $user?->currentAccessToken();

        ActivityLog::create([
            'team_id' => $task->team_id,
            'user_id' => $user?->id,
            // SPA認証のときはデータベースのトークンではないので、null にする
            'token_id' => $token instanceof PersonalAccessToken ? $token->id : null,
            'request_id' => Context::get('request_id'),
            'via' => $this->via($user),
            'action' => $action,
            'subject_type' => Task::class,
            'subject_id' => $task->id,
            'changes' => $changes,
        ]);
    }

    // 操作の経路。シーダーやスケジューラーなど、ログインした利用者がいない処理は system
    private function via($user): string
    {
        if ($user === null) {
            return 'system';
        }

        // エージェント用のトークン（第16章）からの操作かどうかを区別する
        return $user->tokenCan('agent') && $user->tokenCant('*') ? 'agent' : 'api';
    }
}
