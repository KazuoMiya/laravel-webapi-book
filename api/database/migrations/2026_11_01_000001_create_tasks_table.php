<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 100);
            $table->text('memo')->nullable();
            $table->date('due_date')->nullable();
            $table->unsignedTinyInteger('priority')->default(2);
            $table->boolean('is_done')->default(false);
            $table->timestamps();   // created_at と updated_at

            // 「自分の」「未完了の」タスクを「期限順」に探すことが多いので索引を付ける
            $table->index(['user_id', 'is_done', 'due_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tasks');
    }
};
