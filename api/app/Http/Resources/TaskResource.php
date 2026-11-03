<?php

namespace App\Http\Resources;

use App\Models\Task;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Task
 */
class TaskResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'memo' => $this->memo,
            'due_date' => $this->due_date?->toDateString(),        // 2026-11-10
            'priority' => $this->priority->key(),                   // high
            'is_done' => $this->is_done,
            'tags' => TagResource::collection($this->whenLoaded('tags')),
            // チーム、担当者、バージョン（第11章）
            'team_id' => $this->team_id,
            'assignee' => $this->whenLoaded('assignee', fn () => $this->assignee
                ? ['id' => $this->assignee->id, 'name' => $this->assignee->name]
                : null),
            'version' => $this->version,
            'created_at' => $this->created_at?->toIso8601String(), // 2026-11-03T09:00:00+00:00
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
