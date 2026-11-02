<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // Content-Typeを推測させない
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        // 個人のデータをブラウザーや中継サーバーにキャッシュさせない
        $response->headers->set('Cache-Control', 'no-store');
        // HTTPSでの接続を1年間強制する（本番のみ）
        if (app()->isProduction()) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }
}
