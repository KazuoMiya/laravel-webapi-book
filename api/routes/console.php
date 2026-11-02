<?php

use App\Jobs\SendDueTaskReminder;
use App\Models\User;
use Illuminate\Support\Facades\Schedule;

// 期限切れから24時間たったトークンを毎日削除する（第10章）
Schedule::command('sanctum:prune-expired --hours=24')->daily();

// 毎朝8時（日本時間）に、全ユーザーのリマインダーをキューに入れる（第17章）
Schedule::call(function () {
    // アプリの標準のタイムゾーンはUTCなので、「明日」は日本時間で決めて渡す
    $tomorrow = now('Asia/Tokyo')->addDay()->toDateString();

    User::query()->each(fn (User $user) => SendDueTaskReminder::dispatch($user, $tomorrow));
})->dailyAt('08:00')->timezone('Asia/Tokyo');

// 1年より古い監査ログを毎日削除する（第17章）
Schedule::command('model:prune')->daily();
