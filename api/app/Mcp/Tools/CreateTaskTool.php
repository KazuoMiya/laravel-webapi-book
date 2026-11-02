<?php

namespace App\Mcp\Tools;

use App\Enums\TaskPriority;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Validation\Rule;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;

#[Description('ログイン中のユーザーの個人タスクを1件作成し、作成したタスクを返します。同じ内容で2回呼ぶと、タスクが2件作られます。')]
class CreateTaskTool extends Tool
{
    public function handle(Request $request): Response|ResponseFactory
    {
        if ($request->user()->tokenCant('tasks:write')) {
            return Response::error('このトークンにはタスクを作成する権限がありません。');
        }

        // AIは、このメッセージを読んで引数を直す。次に何をすればよいかを書く
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:100'],
            'due_date' => ['nullable', 'date_format:Y-m-d'],
            'priority' => ['sometimes', Rule::in(TaskPriority::keys())],
        ], [
            'title.required' => 'title にタスクの内容を指定してください。例：レポートを書く',
            'title.max' => 'title は100文字以内にしてください。',
            'due_date.date_format' => 'due_date は 2026-11-20 のように YYYY-MM-DD の形式で指定してください。',
            'priority.in' => 'priority には low、medium、high のどれかを指定してください。',
        ]);

        if (isset($validated['priority'])) {
            $validated['priority'] = TaskPriority::fromKey($validated['priority']);
        }

        $task = $request->user()->tasks()->create($validated);

        return Response::structured([
            'id' => $task->id,
            'title' => $task->title,
            'due_date' => $task->due_date?->toDateString(),
            'priority' => $task->priority->key(),
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'title' => $schema->string()->description('タスクの内容（100文字以内）')->required(),
            'due_date' => $schema->string()->description('期限。YYYY-MM-DD の形式。期限がなければ省略する'),
            'priority' => $schema->string()->enum(['low', 'medium', 'high'])->description('優先度。省略すると medium'),
        ];
    }
}
