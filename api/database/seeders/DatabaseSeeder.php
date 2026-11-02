<?php

namespace Database\Seeders;

use App\Enums\TeamRole;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // ログイン確認用のユーザー（パスワードは password）
        $user = User::factory()->create([
            'name' => 'テストユーザー',
            'email' => 'test@example.com',
        ]);

        $tags = collect(['仕事', '買い物', '家', '勉強'])
            ->map(fn (string $name) => $user->tags()->create(['name' => $name]));

        Task::factory()
            ->count(30)
            ->for($user)
            ->create()
            ->each(fn (Task $task) => $task->tags()->sync(
                $tags->random(rand(0, 2))->pluck('id')
            ));

        Task::factory()->count(10)->for($user)->done()->create();

        // 他人のタスク（第10章で「見えないこと」を確かめるため）
        Task::factory()->count(5)->create();

        // チームのデータ（第11章）
        $mate = User::factory()->create(['name' => 'チームメイト', 'email' => 'mate@example.com']);

        $team = $user->ownedTeams()->create(['name' => '開発チーム']);
        $team->members()->attach([
            $user->id => ['role' => TeamRole::Owner->value],
            $mate->id => ['role' => TeamRole::Member->value],
        ]);

        Task::factory()->count(10)->for($team)->for($user)->create(['assignee_id' => $mate->id]);
    }
}
