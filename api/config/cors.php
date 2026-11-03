<?php

// 別のオリジン（ポート番号違いを含む）のJavaScriptからの呼び出しを許可する設定（第10章、第12章）
return [
    'paths' => ['api/*', 'sanctum/csrf-cookie', 'login', 'logout'],
    'allowed_methods' => ['*'],
    'allowed_origins' => array_values(array_filter([
        env('FRONTEND_URL', 'http://localhost:5173'),
        // Swagger UI（第6章）から試すため。開発環境だけで許可する
        env('APP_ENV') === 'local' ? 'http://localhost:8081' : null,
        // 本書のWeb版から、手元のAPIにリクエストを送るため。開発環境だけで許可する
        env('APP_ENV') === 'local' ? env('BOOK_SITE_URL') : null,
    ])),
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    // 別のオリジンのJavaScriptから読めるようにする応答ヘッダー
    'exposed_headers' => [
        'Retry-After', 'ETag', 'X-Request-Id', 'Location', 'Idempotent-Replayed',
        'X-RateLimit-Limit', 'X-RateLimit-Remaining',
    ],
    'max_age' => 0,
    'supports_credentials' => true,   // Cookieの送受信を許可する
];
