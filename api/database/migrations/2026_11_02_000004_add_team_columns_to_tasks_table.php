<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            // null なら個人のタスク
            $table->foreignId('team_id')->nullable()->after('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('assignee_id')->nullable()->after('team_id')->constrained('users')->nullOnDelete();
            // 更新のたびに1つ増える番号。同時編集の検出に使う（11.8節）
            $table->unsignedInteger('version')->default(1)->after('is_done');

            $table->index(['team_id', 'is_done', 'due_date']);
        });
    }

    public function down(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->dropForeign(['team_id']);
            $table->dropForeign(['assignee_id']);
            $table->dropIndex(['team_id', 'is_done', 'due_date']);
            $table->dropColumn(['team_id', 'assignee_id', 'version']);
        });
    }
};
