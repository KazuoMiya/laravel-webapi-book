<?php

namespace App\Policies;

use App\Enums\TeamRole;
use App\Models\Task;
use App\Models\Team;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class TaskPolicy
{
    public function view(User $user, Task $task): Response
    {
        if ($task->team_id === null) {
            return $this->owns($user, $task);
        }

        return $this->roleIn($user, $task) !== null
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    public function update(User $user, Task $task): Response
    {
        if ($task->team_id === null) {
            return $this->owns($user, $task);
        }

        $role = $this->roleIn($user, $task);
        if ($role === null) {
            return Response::denyAsNotFound();
        }

        // 11.1節の表：owner と admin はすべて、member は自分が作ったか担当のタスクだけ
        $isMine = $task->user_id === $user->id || $task->assignee_id === $user->id;
        $allowed = $role->canManageAllTasks() || ($role->canWriteTasks() && $isMine);

        return $allowed ? Response::allow() : Response::deny('このタスクを変更する権限がありません。');
    }

    public function delete(User $user, Task $task): Response
    {
        return $this->update($user, $task);
    }

    private function owns(User $user, Task $task): Response
    {
        return $user->id === $task->user_id ? Response::allow() : Response::denyAsNotFound();
    }

    private function roleIn(User $user, Task $task): ?TeamRole
    {
        return Team::query()->find($task->team_id)?->roleOf($user);
    }
}
