<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TeamRole;
use App\Http\Controllers\Controller;
use App\Http\Resources\MemberResource;
use App\Models\Team;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class TeamMemberController extends Controller
{
    public function index(Team $team): AnonymousResourceCollection
    {
        Gate::authorize('view', $team);

        return MemberResource::collection($team->members()->orderBy('name')->get());
    }

    public function update(Request $request, Team $team, User $user): MemberResource
    {
        Gate::authorize('manageMembers', $team);

        $validated = $request->validate([
            'role' => ['required', Rule::in(['admin', 'member', 'viewer'])],
        ]);

        $current = $team->roleOf($user);
        abort_if($current === null, 404);
        abort_if($current === TeamRole::Owner, 422, 'オーナーの役割は変更できません。');

        $team->members()->updateExistingPivot($user->id, ['role' => $validated['role']]);

        return new MemberResource($team->members()->findOrFail($user->id));
    }

    public function destroy(Request $request, Team $team, User $user): Response
    {
        // 自分がチームを抜けるのはいつでもできる。他人を外すには管理の権限が必要
        Gate::authorize($request->user()->is($user) ? 'view' : 'manageMembers', $team);

        abort_if($team->roleOf($user) === TeamRole::Owner, 422, 'オーナーはチームから外せません。');

        $team->members()->detach($user->id);

        return response()->noContent();
    }
}
