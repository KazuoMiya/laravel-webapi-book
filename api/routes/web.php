<?php

use App\Http\Controllers\SpaAuthController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// ブラウザーのSPA（第15章）用のログインとログアウト（第10章）
Route::post('/login', [SpaAuthController::class, 'login'])->middleware('throttle:login')->name('login');
Route::post('/logout', [SpaAuthController::class, 'logout'])->name('logout');
