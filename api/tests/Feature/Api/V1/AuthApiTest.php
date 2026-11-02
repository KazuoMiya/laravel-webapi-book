<?php

namespace Tests\Feature\Api\V1;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_login_and_access_me_with_token(): void
    {
        $user = User::factory()->create(['password' => 'secret-pass']);

        $token = $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'secret-pass',
            'device_name' => 'test',
        ])->assertOk()->json('data.token');

        $this->withToken($token)
            ->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.email', $user->email);
    }

    public function test_login_fails_with_wrong_password(): void
    {
        $user = User::factory()->create(['password' => 'secret-pass']);

        $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'wrong-pass',
            'device_name' => 'test',
        ])->assertUnprocessable()->assertJsonValidationErrors(['email']);
    }

    public function test_token_cannot_be_used_after_logout(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('test')->plainTextToken;

        $this->withToken($token)->postJson('/api/v1/logout')->assertNoContent();

        // テスト中はログイン状態が記憶されているので、いったん忘れさせる
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_login_is_rate_limited(): void
    {
        $payload = ['email' => 'nobody@example.com', 'password' => 'x', 'device_name' => 'test'];

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/login', $payload)->assertUnprocessable();
        }

        $this->postJson('/api/v1/login', $payload)->assertTooManyRequests();   // 6回目は429
    }
}
