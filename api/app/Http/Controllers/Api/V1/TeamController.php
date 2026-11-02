<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TeamRole;
use App\Http\Controllers\Controller;
use App\Http\Resources\TeamResource;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class TeamController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return TeamResource::collection($request->user()->teams()->orderBy('name')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate(['name' => ['required', 'string', 'max:50']]);
        $user = $request->user();

        // チームの作成と、作成者をオーナーとして登録する処理をまとめる
        $team = DB::transaction(function () use ($user, $validated) {
            $team = $user->ownedTeams()->create($validated);
            $team->members()->attach($user->id, ['role' => TeamRole::Owner->value]);

            return $team;
        });

        return (new TeamResource($team))
            ->response()
            ->setStatusCode(201)
            ->header('Location', route('teams.show', $team));
    }

    public function show(Team $team): TeamResource
    {
        Gate::authorize('view', $team);

        return new TeamResource($team);
    }

    public function update(Request $request, Team $team): TeamResource
    {
        Gate::authorize('update', $team);

        $team->update($request->validate(['name' => ['required', 'string', 'max:50']]));

        return new TeamResource($team);
    }

    public function destroy(Team $team): Response
    {
        Gate::authorize('delete', $team);

        $team->delete();   // チームのタスク、所属、招待も外部キーの設定で削除される

        return response()->noContent();
    }
}
