<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class AuthController extends Controller
{
    // POST /api/v1/register
    public function register(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:50'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', Password::min(8)],
            'device_name' => ['sometimes', 'string', 'max:255'],
        ]);

        // passwordはモデルのcastsで自動的にハッシュ化される
        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => $validated['password'],
        ]);

        return response()->json([
            'data' => [
                'user' => new UserResource($user),
                'token' => $this->issueToken($user, $validated['device_name'] ?? 'api'),
            ],
        ], 201);
    }

    // POST /api/v1/login
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['required', 'string', 'max:255'],
        ]);

        $user = User::where('email', $validated['email'])->first();

        if (! $user || ! Hash::check($validated['password'], $user->password)) {
            // どちらが違うかは教えない（登録済みのメールアドレスを推測されないため）
            throw ValidationException::withMessages([
                'email' => [__('auth.failed')],
            ]);
        }

        return response()->json([
            'data' => [
                'user' => new UserResource($user),
                'token' => $this->issueToken($user, $validated['device_name']),
            ],
        ]);
    }

    // POST /api/v1/logout
    public function logout(Request $request): Response
    {
        $token = $request->user()->currentAccessToken();

        // SPA認証（Cookie）で呼ばれた場合は、消すべきトークンがない
        if (! $token instanceof PersonalAccessToken) {
            abort(400, 'このAPIはトークン認証用です。ブラウザーからは /logout を使ってください。');
        }

        // 今回のリクエストで使われたトークンだけを無効にする
        $token->delete();

        return response()->noContent();
    }

    // GET /api/v1/me
    public function me(Request $request): UserResource
    {
        return new UserResource($request->user());
    }

    private function issueToken(User $user, string $deviceName): string
    {
        // 有効期限30日のトークンを発行する
        return $user->createToken($deviceName, ['*'], now()->addDays(30))->plainTextToken;
    }
}
