<?php

namespace App\Models;

use App\Enums\TaskPriority;
use App\Observers\TaskObserver;
use Database\Factories\TaskFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

#[ObservedBy([TaskObserver::class])]
#[Fillable(['title', 'memo', 'due_date', 'priority', 'is_done', 'assignee_id'])]
class Task extends Model
{
    /** @use HasFactory<TaskFactory> */
    use HasFactory;

    // 作成時に指定されなかった列の初期値（データベースの初期値とそろえる）
    protected $attributes = [
        'priority' => 2,
        'is_done' => false,
        'version' => 1,
    ];

    // データベースの値をPHPの型に変換する
    protected function casts(): array
    {
        return [
            'due_date' => 'date',
            'priority' => TaskPriority::class,
            'is_done' => 'boolean',
            'version' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        // 保存する直前に、バージョンを1つ進める（第11章）
        static::updating(function (Task $task) {
            $task->version = $task->version + 1;
        });
    }

    // このタスクの作成者（タスクは1人のユーザーに属する）
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    // このタスクに付いたタグ（多対多）
    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class);
    }

    // チームのタスクなら、そのチーム（個人のタスクなら null）
    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    // チームのタスクの担当者
    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    // 一覧の絞り込みと並べ替え。検証済みの値（validated）を受け取る（第11章）
    #[Scope]
    protected function filterForList(Builder $query, array $filters): void
    {
        $query
            ->when(isset($filters['is_done']), fn ($q) => $q->where(
                'is_done', filter_var($filters['is_done'], FILTER_VALIDATE_BOOLEAN)))
            ->when(isset($filters['priority']), fn ($q) => $q->where(
                'priority', TaskPriority::fromKey($filters['priority'])))
            ->when(isset($filters['tag']), fn ($q) => $q->whereHas(
                'tags', fn ($tag) => $tag->where('name', $filters['tag'])))
            ->when(isset($filters['q']), function ($q) use ($filters) {
                // % と _ はLIKE検索の特殊文字なので、文字そのものとして扱うよう処理する
                $keyword = '%'.addcslashes($filters['q'], '%_\\').'%';
                $q->where(fn ($w) => $w->where('title', 'like', $keyword)->orWhere('memo', 'like', $keyword));
            })
            ->when(isset($filters['due_before']), fn ($q) => $q->whereDate(
                'due_date', '<=', $filters['due_before']));

        $sort = $filters['sort'] ?? '-created_at';
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';

        // 同じ値が並んだときの順序を安定させるため、最後にidでも並べる
        $query->orderBy(ltrim($sort, '-'), $direction)->orderBy('id', $direction);
    }
}
