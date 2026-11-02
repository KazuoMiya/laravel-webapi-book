<?php

namespace App\Http\Controllers\Api\V1;

use App\Exceptions\TaskLimitExceededException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\IndexTaskRequest;
use App\Http\Requests\Api\V1\StoreTaskRequest;
use App\Http\Requests\Api\V1\UpdateTaskRequest;
use App\Http\Resources\TaskResource;
use App\Models\Task;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class TaskController extends Controller
{
    private const MAX_OPEN_TASKS = 100;

    // GET /api/v1/tasks
    public function index(IndexTaskRequest $request): AnonymousResourceCollection
    {
        $tasks = $request->user()->tasks()
            ->whereNull('team_id')   // 個人のタスクだけ（第11章）
            ->with(['tags', 'assignee'])
            ->filterForList($request->validated())
            ->paginate($request->integer('per_page', 15))
            ->withQueryString();

        return TaskResource::collection($tasks);
    }

    // GET /api/v1/tasks/summary（第14章）
    public function summary(Request $request): JsonResponse
    {
        $open = $request->user()->tasks()->whereNull('team_id')->where('is_done', false);

        return response()->json([
            'data' => [
                'open' => (clone $open)->count(),
                'overdue' => (clone $open)->whereDate('due_date', '<', today())->count(),
                'due_today' => (clone $open)->whereDate('due_date', today())->count(),
            ],
        ]);
    }

    // POST /api/v1/tasks
    public function store(StoreTaskRequest $request): JsonResponse
    {
        $user = $request->user();

        // 未完了の個人のタスクは100件まで（第9章）。完了済みとして作るタスクは数に入らない
        $openCount = $user->tasks()->whereNull('team_id')->where('is_done', false)->count();

        if (! $request->boolean('is_done') && $openCount >= self::MAX_OPEN_TASKS) {
            throw new TaskLimitExceededException(self::MAX_OPEN_TASKS);
        }

        // タスクとタグの保存を「全部成功か、全部取り消し」にする
        $task = DB::transaction(function () use ($user, $request) {
            $task = $user->tasks()->create($request->taskAttributes());

            if ($request->tagNames() !== null) {
                $this->syncTags($user, $task, $request->tagNames());
            }

            return $task;
        });

        return (new TaskResource($task->load(['tags', 'assignee'])))
            ->response()
            ->setStatusCode(201)
            ->header('Location', route('tasks.show', $task));
    }

    // GET /api/v1/tasks/{task}
    public function show(Task $task): JsonResponse
    {
        Gate::authorize('view', $task);

        return (new TaskResource($task->load(['tags', 'assignee'])))
            ->response()
            ->header('ETag', $this->etagFor($task));
    }

    // PATCH /api/v1/tasks/{task}
    public function update(UpdateTaskRequest $request, Task $task): JsonResponse
    {
        Gate::authorize('update', $task);

        $ifMatch = $request->header('If-Match');

        // チームのタスクは同時に編集されうるので、条件付きの更新だけを受け付ける（11.8節）
        if ($task->team_id !== null && $ifMatch === null) {
            abort(428, 'If-Match ヘッダーに、取得したときの ETag を指定してください。');
        }

        $task = DB::transaction(function () use ($request, $task, $ifMatch) {
            // 確認から保存までの間に他の更新が割り込まないよう、行をロックして読み直す
            $locked = Task::query()->lockForUpdate()->findOrFail($task->id);

            if ($ifMatch !== null && $ifMatch !== $this->etagFor($locked)) {
                abort(412, '他の人がこのタスクを更新しました。最新の内容を取得してからやり直してください。');
            }

            $locked->update($request->taskAttributes());

            if ($request->tagNames() !== null) {
                $this->syncTags($request->user(), $locked, $request->tagNames());

                // タグだけを変えた場合も版を進める（touch は updating イベントを通る）
                if (! $locked->wasChanged()) {
                    $locked->touch();
                }
            }

            return $locked;
        });

        return (new TaskResource($task->load(['tags', 'assignee'])))
            ->response()
            ->header('ETag', $this->etagFor($task));
    }

    // DELETE /api/v1/tasks/{task}
    public function destroy(Task $task): Response
    {
        Gate::authorize('delete', $task);

        $task->delete();

        return response()->noContent();   // 204
    }

    // タグ名の配列から、必要ならタグを作り、タスクに付け替える
    private function syncTags(User $user, Task $task, array $names): void
    {
        $tagIds = collect($names)
            ->map(fn (string $name) => trim($name))
            ->filter()
            ->unique()
            ->map(fn (string $name) => $user->tags()->firstOrCreate(['name' => $name])->id);

        $task->tags()->sync($tagIds);

        // タグの一覧のキャッシュ（第17章）は、トランザクションが確定した後で消す
        // （確定前に消すと、古い値がまたキャッシュされることがある）
        DB::afterCommit(fn () => Cache::forget("users:{$user->id}:tags"));
    }

    private function etagFor(Task $task): string
    {
        return '"v'.$task->version.'"';
    }
}
