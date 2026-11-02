<?php

namespace App\Exceptions;

use Exception;
use Illuminate\Http\JsonResponse;

class TaskLimitExceededException extends Exception
{
    public function __construct(private int $limit)
    {
        parent::__construct("未完了のタスクは{$limit}件までです。");
    }

    // この例外が起きたときの応答を、例外クラス自身が決める
    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage()], 422);
    }
}
