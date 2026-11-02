<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\IndexTeamTaskRequest;
use App\Http\Requests\Api\V1\StoreTeamTaskRequest;
use App\Http\Resources\TaskResource;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class TeamTaskController extends Controller
{
    public function index(IndexTeamTaskRequest $request, Team $team): AnonymousResourceCollection
    {
        // メンバーかどうかは、IndexTeamTaskRequest で入力検証より先に確かめている

        // 必ずチームから始めて問い合わせる。他のチームのタスクは混ざらない
        $tasks = $team->tasks()
            ->with(['tags', 'assignee'])
            ->filterForList($request->validated())
            ->paginate($request->integer('per_page', 15))
            ->withQueryString();

        return TaskResource::collection($tasks);
    }

    public function store(StoreTeamTaskRequest $request, Team $team): JsonResponse
    {
        $task = $team->tasks()->make($request->taskAttributes());   // team_id が入る
        $task->user()->associate($request->user());                 // 作成者
        $task->save();

        return (new TaskResource($task->load(['tags', 'assignee'])))
            ->response()
            ->setStatusCode(201)
            ->header('Location', route('tasks.show', $task));
    }
}
