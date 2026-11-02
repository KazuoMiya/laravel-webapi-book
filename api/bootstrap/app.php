<?php

use App\Http\Middleware\AssignRequestId;
use App\Http\Middleware\BlockAgentTokens;
use App\Http\Middleware\EnsureIdempotency;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // 自分たちのSPAからのリクエストに、セッション（Cookie）を使えるようにする（第10章）
        $middleware->statefulApi();

        $middleware->api(prepend: [
            ForceJsonResponse::class,   // 第9章
            SecurityHeaders::class,     // 第12章
            AssignRequestId::class,     // 第17章
        ]);

        $middleware->alias([
            'block-agent-tokens' => BlockAgentTokens::class,   // 第16章
            'idempotent' => EnsureIdempotency::class,          // 第16章
        ]);

        // HTTPSを前段のロードバランサーで終端する構成のため（第12章）
        $middleware->trustProxies(at: '*');   // 本番では前段のサーバーのIPアドレスに絞る
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // /api 以下で起きた例外は、ルートが決まる前の失敗（405など）も含めてJSONで返す（第9章）
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request, Throwable $e) => $request->is('api/*') || $request->expectsJson()
        );

        // 404はすべて同じ応答にする。Policyの denyAsNotFound（第10章）で拒否したときも、
        // 本当に存在しないときと見分けがつかないようにする
        $exceptions->render(function (HttpExceptionInterface $e, Request $request) {
            if ($e->getStatusCode() === 404 && $request->is('api/*')) {
                return response()->json([
                    'message' => 'リソースが見つかりません。',
                ], 404);
            }
        });
    })->create();
