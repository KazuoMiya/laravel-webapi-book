<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Connection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Events\DiagnosingHealth;
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // 関連データの読み込み忘れ（N+1問題）を、本番以外ではエラーにする（第7章）
        Model::preventLazyLoading(! $this->app->isProduction());

        // Fillableにない項目を代入しようとしたら、開発中はエラーにする（第12章）
        Model::preventSilentlyDiscardingAttributes($this->app->isLocal());

        // 本番では、生成するURLを https にそろえる（第12章）
        if ($this->app->isProduction()) {
            URL::forceScheme('https');
        }

        // HTTPSを前段のロードバランサーで終端する構成のため、そのサーバーだけを信頼する（第12章）。
        // すべてを信頼すると、X-Forwarded-For を偽ってIPアドレスごとの回数制限をすり抜けられる
        if ($proxies = config('app.trusted_proxies')) {
            TrustProxies::at(array_map(trim(...), explode(',', $proxies)));
        }

        $this->configureRateLimiting();
        $this->configureQueryLogging();
        $this->configureHealthCheck();
    }

    // 回数制限のルール（第12章、第16章）
    private function configureRateLimiting(): void
    {
        // 通常のAPI：ログイン中はユーザーごと、未ログインはIPアドレスごとに1分60回
        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
        });

        // ログインと登録：アカウントごとに1分5回、IPアドレスごとに1分20回。どちらかを超えたら429
        RateLimiter::for('login', function (Request $request) {
            return [
                Limit::perMinute(5)->by('email:'.Str::lower((string) $request->input('email'))),
                Limit::perMinute(20)->by('ip:'.$request->ip()),
            ];
        });

        // MCPサーバー：ユーザーごとに1分30回
        RateLimiter::for('mcp', function (Request $request) {
            return Limit::perMinute(30)->by($request->user()?->id ?: $request->ip());
        });
    }

    // 遅いSQLをログに残す（第17章、第18章）
    private function configureQueryLogging(): void
    {
        DB::listen(function (QueryExecuted $query) {
            if ($query->time > 200) {   // 200ミリ秒を超えたSQLを記録する
                Log::warning('遅いSQL', ['sql' => $query->sql, 'time_ms' => $query->time]);
            }
        });

        DB::whenQueryingForLongerThan(500, function (Connection $connection, QueryExecuted $event) {
            Log::warning('1回のリクエストで、SQLの合計時間が500ミリ秒を超えました', ['last_sql' => $event->sql]);
        });
    }

    // /up で、データベースとRedisにも接続できるかを確かめる（第18章）
    private function configureHealthCheck(): void
    {
        Event::listen(function (DiagnosingHealth $event) {
            DB::select('select 1');          // データベースに接続できるか
            Redis::connection()->ping();     // Redisに接続できるか
        });
    }
}
