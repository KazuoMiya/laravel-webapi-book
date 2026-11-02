<?php

use App\Mcp\Servers\TaskBoardServer;
use Laravel\Mcp\Facades\Mcp;

Mcp::web('/mcp/taskboard', TaskBoardServer::class)
    ->middleware(['auth:sanctum', 'throttle:mcp']);
