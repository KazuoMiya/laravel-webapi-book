<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Team
 */
class TeamResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            // 一覧では中間テーブルから、それ以外は問い合わせて、自分の役割を返す
            'my_role' => $this->pivot?->role ?? $this->roleOf($request->user())?->value,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
