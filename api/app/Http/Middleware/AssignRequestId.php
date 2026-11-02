<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class AssignRequestId
{
    public function handle(Request $request, Closure $next): Response
    {
        // 前段のサーバーがIDを付けていればそれを使い、なければ新しく作る
        $requestId = $request->header('X-Request-Id') ?: (string) Str::uuid();

        // Contextに入れた値は、このリクエスト中のすべてのログに自動で付く
        Context::add('request_id', $requestId);

        $response = $next($request);
        $response->headers->set('X-Request-Id', $requestId);

        return $response;
    }
}
