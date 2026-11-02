<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('activity_logs', function (Blueprint $table) {
            $table->id();
            // チームを削除しても記録を残すため、外部キーの制約は付けない
            $table->unsignedBigInteger('team_id')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            // どのトークンからの操作か。トークンを失効させた後も調べられるよう、IDだけを残す
            $table->unsignedBigInteger('token_id')->nullable();
            $table->string('request_id', 36)->nullable();   // 17.3節のリクエストID
            $table->string('via', 20);             // api、agent、system のどれか
            $table->string('action', 50);          // task.created など
            $table->morphs('subject');             // 操作の対象（subject_type と subject_id）
            $table->json('changes')->nullable();   // 変更された値
            $table->timestamp('created_at')->useCurrent();

            $table->index(['team_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_logs');
    }
};
