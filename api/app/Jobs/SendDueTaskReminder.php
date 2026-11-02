<?php

namespace App\Jobs;

use App\Models\Task;
use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Mail;

class SendDueTaskReminder implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;   // 失敗したら3回まで再試行する

    // 対象の日付（YYYY-MM-DD）は、ジョブを登録するときに日本時間で決めて渡す
    public function __construct(public User $user, public string $date)
    {
    }

    // 通知してよいタスクだけを選ぶ。テストしやすいようにメソッドに分ける
    public function targetTasks(): Collection
    {
        $teamIds = $this->user->teams()->pluck('teams.id');   // 今も所属しているチーム

        return Task::query()
            ->where('is_done', false)
            ->whereDate('due_date', $this->date)
            ->where(function ($query) use ($teamIds) {
                // 自分の個人のタスク
                $query->where(fn ($q) => $q->where('user_id', $this->user->id)->whereNull('team_id'))
                    // 今も所属しているチームで、自分が担当のタスク
                    ->orWhere(fn ($q) => $q->where('assignee_id', $this->user->id)->whereIn('team_id', $teamIds));
            })
            ->get();
    }

    public function handle(): void
    {
        $titles = $this->targetTasks()->pluck('title');

        if ($titles->isEmpty()) {
            return;
        }

        Mail::raw("明日が期限のタスク：\n".$titles->implode("\n"), function ($message) {
            $message->to($this->user->email)->subject('明日が期限のタスクがあります');
        });
    }
}
