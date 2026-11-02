<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class StoreTeamTaskRequest extends StoreTaskRequest
{
    // 入力検証より先に権限を確かめる（メンバー以外には入力の誤りも見せない）
    public function authorize(): bool
    {
        Gate::authorize('createTask', $this->route('team'));

        return true;
    }

    public function rules(): array
    {
        $rules = parent::rules();
        unset($rules['tags.*']);
        $rules['tags'] = ['prohibited'];   // チームのタスクにはタグを付けない
        $rules['assignee_id'] = [
            'sometimes', 'nullable', 'integer',
            // 担当者は、このチームのメンバーに限る
            Rule::exists('team_user', 'user_id')->where('team_id', $this->route('team')->id),
        ];

        return $rules;
    }

    public function attributes(): array
    {
        return parent::attributes() + ['assignee_id' => '担当者'];
    }
}
