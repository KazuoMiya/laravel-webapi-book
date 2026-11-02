<?php

namespace Database\Factories;

use App\Enums\TaskPriority;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Task>
 */
class TaskFactory extends Factory
{
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'title' => fake()->realText(30),
            'memo' => fake()->optional()->realText(100),
            'due_date' => fake()->optional()->dateTimeBetween('-1 week', '+1 month'),
            'priority' => fake()->randomElement(TaskPriority::cases()),
            'is_done' => false,
        ];
    }

    // 完了済みのタスクを作るときに使う
    public function done(): static
    {
        return $this->state(fn () => ['is_done' => true]);
    }
}
