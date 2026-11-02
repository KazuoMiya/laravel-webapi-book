<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AgentTokenController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'abilities' => ['required', 'array', 'min:1'],
            'abilities.*' => [Rule::in(['tasks:read', 'tasks:write'])],
        ]);

        // agent はエージェント用のトークンであることの印
        $abilities = ['agent', ...$validated['abilities']];

        $token = $request->user()->createToken(
            'agent: '.$validated['name'],
            $abilities,
            now()->addDays(7),   // エージェント用は有効期限を短くする
        );

        return response()->json([
            'data' => [
                'token' => $token->plainTextToken,
                'abilities' => $abilities,
                'expires_at' => $token->accessToken->expires_at->toIso8601String(),
            ],
        ], 201);
    }
}
