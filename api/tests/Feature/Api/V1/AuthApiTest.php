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

    public function test_login_is_rate_limited_per_ip_across_accounts(): void
    {
        // アカウントを変えながら試しても、同じIPアドレスからは1分20回まで
        for ($i = 0; $i < 20; $i++) {
            $this->postJson('/api/v1/login', ['email' => "user{$i}@example.com", 'password' => 'x', 'device_name' => 'test'])
                ->assertUnprocessable();
        }

        $this->postJson('/api/v1/login', ['email' => 'user20@example.com', 'password' => 'x', 'device_name' => 'test'])
            ->assertTooManyRequests();
    }

    public function test_forwarded_for_header_is_ignored_without_trusted_proxies(): void
    {
        // 信頼するプロキシを設定していなければ、X-Forwarded-For を変えても別のIPアドレスとは扱わない
        for ($i = 0; $i < 20; $i++) {
            $this->withHeader('X-Forwarded-For', "203.0.113.{$i}")
                ->postJson('/api/v1/login', ['email' => "user{$i}@example.com", 'password' => 'x', 'device_name' => 'test'])
                ->assertUnprocessable();
        }

        $this->withHeader('X-Forwarded-For', '203.0.113.99')
            ->postJson('/api/v1/login', ['email' => 'user99@example.com', 'password' => 'x', 'device_name' => 'test'])
            ->assertTooManyRequests();
    }
}
