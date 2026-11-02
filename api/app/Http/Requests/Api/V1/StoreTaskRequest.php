<?php

namespace App\Http\Requests\Api\V1;

use App\Enums\TaskPriority;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Arr;
use Illuminate\Validation\Rule;

class StoreTaskRequest extends FormRequest
{
    // 誰が実行できるかは、第10章のPolicyで判定する
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:100'],
            'memo' => ['nullable', 'string', 'max:2000'],
            'due_date' => ['nullable', 'date_format:Y-m-d'],
            'priority' => ['sometimes', Rule::in(TaskPriority::keys())],
            'is_done' => ['sometimes', 'boolean'],
            'tags' => ['sometimes', 'array', 'max:10'],
            'tags.*' => ['string', 'distinct', 'max:50'],
        ];
    }

    // エラーメッセージで使う項目名
    public function attributes(): array
    {
        return [
            'title' => 'タイトル',
            'memo' => 'メモ',
            'due_date' => '期限',
            'priority' => '優先度',
            'is_done' => '完了状態',
            'tags' => 'タグ',
            'tags.*' => 'タグ',
        ];
    }

    // 検証済みの値を、モデルに保存できる形に変換して返す
    public function taskAttributes(): array
    {
        $attributes = Arr::except($this->validated(), ['tags']);

        if (isset($attributes['priority'])) {
            $attributes['priority'] = TaskPriority::fromKey($attributes['priority']);
        }

        return $attributes;
    }

    // tags が送られていればタグ名の配列、送られていなければ null
    public function tagNames(): ?array
    {
        return $this->has('tags') ? $this->validated('tags', []) : null;
    }
}
