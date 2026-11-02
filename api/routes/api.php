<?php

use App\Http\Controllers\Api\V1\AcceptInvitationController;
use App\Http\Controllers\Api\V1\ActivityLogController;
use App\Http\Controllers\Api\V1\AgentTokenController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\TagController;
use App\Http\Controllers\Api\V1\TaskController;
use App\Http\Controllers\Api\V1\TeamController;
use App\Http\Controllers\Api\V1\TeamInvitationController;
use App\Http\Controllers\Api\V1\TeamMemberController;
use App\Http\Controllers\Api\V1\TeamTaskController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->middleware('throttle:api')->group(function () {
    // ログインしていなくても呼べるAPI（第10章）。回数制限を厳しくする（第12章）
    Route::middleware('throttle:login')->group(function () {
        Route::post('/register', [AuthController::class, 'register'])->name('register');
        Route::post('/login', [AuthController::class, 'login'])->name('login.token');
    });

    // ログインが必要なAPI。エージェント用のトークンは使えない（第16章）
    Route::middleware(['auth:sanctum', 'block-agent-tokens'])->group(function () {
        Route::post('/logout', [AuthController::class, 'logout'])->name('logout.token');
        Route::get('/me', [AuthController::class, 'me'])->name('me');

        // 個人のタスク（第8章）。summary は {task} より前に書く（第14章）
        Route::get('/tasks/summary', [TaskController::class, 'summary'])->name('tasks.summary');
        Route::apiResource('tasks', TaskController::class)->except(['store', 'update']);
        Route::post('/tasks', [TaskController::class, 'store'])->middleware('idempotent')->name('tasks.store');
        Route::patch('/tasks/{task}', [TaskController::class, 'update'])->name('tasks.update');
        Route::get('/tags', [TagController::class, 'index'])->name('tags.index');

        // チーム（第11章）
        Route::apiResource('teams', TeamController::class);
        Route::get('/teams/{team}/members', [TeamMemberController::class, 'index'])->name('teams.members.index');
        Route::patch('/teams/{team}/members/{user}', [TeamMemberController::class, 'update'])->name('teams.members.update');
        Route::delete('/teams/{team}/members/{user}', [TeamMemberController::class, 'destroy'])->name('teams.members.destroy');
        Route::post('/teams/{team}/invitations', [TeamInvitationController::class, 'store'])->name('teams.invitations.store');
        Route::post('/invitations/{token}/accept', AcceptInvitationController::class)->name('invitations.accept');
        Route::get('/teams/{team}/tasks', [TeamTaskController::class, 'index'])->name('teams.tasks.index');
        Route::post('/teams/{team}/tasks', [TeamTaskController::class, 'store'])->name('teams.tasks.store');

        // エージェント用のトークンの発行（第16章）
        Route::post('/agent-tokens', [AgentTokenController::class, 'store'])->name('agent-tokens.store');

        // チームの監査ログ（第17章）
        Route::get('/teams/{team}/activities', [ActivityLogController::class, 'index'])->name('teams.activities.index');
    });
});
