<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class BlockAgentTokens
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        // agent の印を持ち、何でもできる権限（*）を持たないトークンは、REST APIでは使わせない
        if ($user && $user->tokenCan('agent') && $user->tokenCant('*')) {
            abort(403, 'エージェント用のトークンでは、このAPIは使えません。');
        }

        return $next($request);
    }
}
