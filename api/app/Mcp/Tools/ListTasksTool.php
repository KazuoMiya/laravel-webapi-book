<?php

namespace App\Mcp\Tools;

use App\Models\Task;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('ログイン中のユーザーの個人タスクを、期限が近い順に最大20件返します。標準では未完了のタスクだけを返します。タスクのIDは complete-task で使います。')]
#[IsReadOnly]
class ListTasksTool extends Tool
{
    public function handle(Request $request): Response|ResponseFactory
    {
        if ($request->user()->tokenCant('tasks:read')) {
            return Response::error('このトークンにはタスクを読む権限がありません。');
        }

        $validated = $request->validate([
            'include_done' => ['sometimes', 'boolean'],
        ]);

        $tasks = $request->user()->tasks()
            ->whereNull('team_id')
            ->when(! ($validated['include_done'] ?? false), fn ($query) => $query->where('is_done', false))
            ->orderByRaw('due_date is null')   // 期限のないタスクは最後にする
            ->orderBy('due_date')
            ->limit(20)
            ->get();

        return Response::structured([
            'tasks' => $tasks->map(fn (Task $task) => [
                'id' => $task->id,
                'title' => $task->title,
                'due_date' => $task->due_date?->toDateString(),
                'priority' => $task->priority->key(),
                'is_done' => $task->is_done,
            ])->all(),
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'include_done' => $schema->boolean()
                ->description('完了済みのタスクも含めるときは true'),
        ];
    }
}
