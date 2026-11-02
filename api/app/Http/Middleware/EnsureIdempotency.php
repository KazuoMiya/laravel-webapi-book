<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class EnsureIdempotency
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');

        if ($key === null) {
            return $next($request);
        }

        // 利用者、操作（メソッドとURL）、キーの組で記録する
        $scope = implode('|', [$request->user()->id, $request->method(), $request->path(), $key]);
        $cacheKey = 'idempotency:'.hash('sha256', $scope);

        // 入力の内容は「指紋」（ハッシュ値）にして一緒に残す
        $fingerprint = hash('sha256', $request->getContent());

        // 同じキーのリクエストが同時に来ても、1つずつ処理する
        return Cache::lock($cacheKey.':lock', 30)->block(10, function () use ($request, $next, $cacheKey, $fingerprint) {
            if ($saved = Cache::get($cacheKey)) {
                if ($saved['fingerprint'] !== $fingerprint) {
                    abort(422, '同じ Idempotency-Key で、違う内容のリクエストが送られました。新しいキーを使ってください。');
                }

                return response($saved['body'], $saved['status'], $saved['headers'])
                    ->header('Idempotent-Replayed', 'true');
            }

            $response = $next($request);

            // 成功した応答だけを24時間覚えておく
            if ($response->isSuccessful()) {
                Cache::put($cacheKey, [
                    'fingerprint' => $fingerprint,
                    'body' => $response->getContent(),
                    'status' => $response->getStatusCode(),
                    'headers' => array_filter([
                        'Content-Type' => $response->headers->get('Content-Type'),
                        'Location' => $response->headers->get('Location'),
                    ]),
                ], now()->addDay());
            }

            return $response;
        });
    }
}
