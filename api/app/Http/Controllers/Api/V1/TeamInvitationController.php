<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class TeamInvitationController extends Controller
{
    public function store(Request $request, Team $team): JsonResponse
    {
        Gate::authorize('manageMembers', $team);

        $validated = $request->validate([
            'email' => ['required', 'string', 'email', 'max:255'],
            'role' => ['required', Rule::in(['admin', 'member', 'viewer'])],
        ]);

        $email = Str::lower($validated['email']);
        $plainToken = Str::random(40);

        $invitation = DB::transaction(function () use ($request, $team, $email, $validated, $plainToken) {
            // 同じチームへの招待が同時に作られないよう、チームの行をロックする
            Team::query()->whereKey($team->id)->lockForUpdate()->first();

            // 同じ人への未使用の招待は消す。送り直したら、最新の1通だけが使える
            $team->invitations()->where('email', $email)->whereNull('accepted_at')->delete();

            return $team->invitations()->create([
                'email' => $email,
                'role' => $validated['role'],
                'token_hash' => hash('sha256', $plainToken),
                'expires_at' => now()->addDays(7),
                'invited_by' => $request->user()->id,
            ]);
        });

        // 招待コードはメールでだけ伝え、APIの応答には含めない
        Mail::raw(
            "「{$team->name}」に招待されました。\nアプリで次の招待コードを入力してください（7日間有効）。\n\n{$plainToken}",
            fn ($message) => $message->to($invitation->email)->subject('TaskBoardのチームへの招待'),
        );

        return response()->json([
            'data' => [
                'id' => $invitation->id,
                'email' => $invitation->email,
                'role' => $invitation->role->value,
                'expires_at' => $invitation->expires_at->toIso8601String(),
            ],
        ], 201);
    }
}
