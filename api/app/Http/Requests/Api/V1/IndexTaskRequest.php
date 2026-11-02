<?php

namespace App\Http\Requests\Api\V1;

use App\Enums\TaskPriority;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class IndexTaskRequest extends FormRequest
{
    // 自分のタスクの一覧なので、ログインしていれば誰でもよい
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'is_done' => ['sometimes', 'in:true,false,1,0'],
            'priority' => ['sometimes', Rule::in(TaskPriority::keys())],
            'tag' => ['sometimes', 'string', 'max:50'],
            'q' => ['sometimes', 'string', 'max:100'],
            'due_before' => ['sometimes', 'date_format:Y-m-d'],
            'sort' => ['sometimes', Rule::in([
                'due_date', '-due_date', 'priority', '-priority', 'created_at', '-created_at',
            ])],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'between:1,100'],
        ];
    }
}
