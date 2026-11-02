<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\TeamResource;
use App\Models\TeamInvitation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AcceptInvitationController extends Controller
{
    public function __invoke(Request $request, string $token): TeamResource
    {
        $user = $request->user();

        $team = DB::transaction(function () use ($user, $token) {
            // 同じ招待を同時に使われないよう、行をロックして読む
            $invitation = TeamInvitation::query()
                ->with('team')
                ->where('token_hash', hash('sha256', $token))
                ->whereNull('accepted_at')
                ->where('expires_at', '>', now())
                ->lockForUpdate()
                ->first();

            // 存在しない、期限切れ、使用済み、宛先が違う。どれも同じ404にする
            if (! $invitation || $invitation->email !== Str::lower($user->email)) {
                abort(404);
            }

            if ($invitation->team->members()->whereKey($user->id)->exists()) {
                abort(409, 'すでにこのチームのメンバーです。');
            }

            $invitation->team->members()->attach($user->id, ['role' => $invitation->role->value]);
            $invitation->update(['accepted_at' => now()]);

            return $invitation->team;
        });

        return new TeamResource($team);
    }
}
