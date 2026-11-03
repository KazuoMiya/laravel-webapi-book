<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 旧版でテーブルを作成済みのDBだけに、不足している索引を追加する。
        if (! Schema::hasIndex('team_invitations', ['team_id', 'email'])) {
            Schema::table('team_invitations', function (Blueprint $table) {
                $table->index(['team_id', 'email']);
            });
        }

        // 旧版で誰が除名されたかは、現在の所属だけからは判別できない。
        $cutoff = now();
        DB::table('team_invitations')->whereNull('accepted_at')
            ->where('expires_at', '>', $cutoff)
            ->update(['expires_at' => $cutoff, 'updated_at' => $cutoff]);
    }

    public function down(): void
    {
        // 失効した招待は復活させない。以前から存在しうる索引も維持する。
    }
};
