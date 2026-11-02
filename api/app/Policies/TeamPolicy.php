<?php

namespace App\Policies;

use App\Enums\TeamRole;
use App\Models\Team;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class TeamPolicy
{
    public function view(User $user, Team $team): Response
    {
        return $this->decide($team->roleOf($user), fn () => true, '');
    }

    public function update(User $user, Team $team): Response
    {
        return $this->decide($team->roleOf($user),
            fn (TeamRole $role) => $role->canManageTeam(), 'チームを変更する権限がありません。');
    }

    public function delete(User $user, Team $team): Response
    {
        return $this->decide($team->roleOf($user),
            fn (TeamRole $role) => $role === TeamRole::Owner, 'チームを削除できるのはオーナーだけです。');
    }

    // 招待、役割の変更、メンバーを外す
    public function manageMembers(User $user, Team $team): Response
    {
        return $this->update($user, $team);
    }

    public function createTask(User $user, Team $team): Response
    {
        return $this->decide($team->roleOf($user),
            fn (TeamRole $role) => $role->canWriteTasks(), '閲覧専用の役割ではタスクを作成できません。');
    }

    private function decide(?TeamRole $role, callable $rule, string $message): Response
    {
        // メンバーでなければ、チームの存在そのものを見せない
        if ($role === null) {
            return Response::denyAsNotFound();
        }

        return $rule($role) ? Response::allow() : Response::deny($message);
    }
}
