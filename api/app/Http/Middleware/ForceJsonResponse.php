<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ForceJsonResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        // 「JSONで返してほしい」というヘッダーを必ず付けた状態にする
        $request->headers->set('Accept', 'application/json');

        // JSONとして読めないボディ（書きかけのJSONなど）は、入力検証に進まずに400にする
        $body = $request->getContent();
        if ($request->isJson() && $body !== '' && ! json_validate($body)) {
            abort(400, 'リクエストのJSONの形式が正しくありません。');
        }

        return $next($request);
    }
}
