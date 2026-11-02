<?php

namespace App\Mcp\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;

#[Description('ログイン中のユーザーの個人タスクを完了にします。すでに完了しているタスクに使っても結果は変わりません。')]
#[IsIdempotent]
class CompleteTaskTool extends Tool
{
    public function handle(Request $request): Response
    {
        if ($request->user()->tokenCant('tasks:write')) {
            return Response::error('このトークンにはタスクを更新する権限がありません。');
        }

        $validated = $request->validate([
            'task_id' => ['required', 'integer'],
        ], [
            'task_id.required' => 'task_id に完了にするタスクのIDを指定してください。IDは list-tasks で調べられます。',
        ]);

        $task = $request->user()->tasks()->whereNull('team_id')->find($validated['task_id']);

        if ($task === null) {
            return Response::error('指定したIDのタスクが見つかりません。list-tasks で正しいIDを確かめてください。');
        }

        $task->update(['is_done' => true]);

        return Response::text("「{$task->title}」を完了にしました。");
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'task_id' => $schema->integer()->description('完了にするタスクのID')->required(),
        ];
    }
}
