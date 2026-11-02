<?php

namespace App\Mcp\Servers;

use App\Mcp\Tools\CompleteTaskTool;
use App\Mcp\Tools\CreateTaskTool;
use App\Mcp\Tools\ListTasksTool;
use Laravel\Mcp\Server;
use Laravel\Mcp\Server\Attributes\Instructions;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Version;

#[Name('TaskBoard')]
#[Version('1.0.0')]
#[Instructions('ログイン中のユーザーの個人タスクを扱います。一覧、作成、完了ができます。削除と、チームのタスクの操作はできません。')]
class TaskBoardServer extends Server
{
    protected array $tools = [
        ListTasksTool::class,
        CreateTaskTool::class,
        CompleteTaskTool::class,
    ];
}
