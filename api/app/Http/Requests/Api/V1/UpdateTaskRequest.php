<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class UpdateTaskRequest extends StoreTaskRequest
{
    // 入力検証より先に、このタスクを更新してよいかを確かめる（第11章）
    public function authorize(): bool
    {
        Gate::authorize('update', $this->route('task'));

        return true;
    }

    public function rules(): array
    {
        $rules = parent::rules();

        // 部分更新なので、すべての項目を「送られてきたときだけ検証する」に変える
        $rules['title'] = ['sometimes', 'required', 'string', 'max:100'];
        $rules['memo'] = ['sometimes', 'nullable', 'string', 'max:2000'];
        $rules['due_date'] = ['sometimes', 'nullable', 'date_format:Y-m-d'];

        $task = $this->route('task');

        if ($task->team_id === null) {
            // 個人のタスクには担当者を付けない
            $rules['assignee_id'] = ['prohibited'];
        } else {
            // チームのタスクにはタグを付けない。担当者はチームのメンバーに限る
            unset($rules['tags.*']);
            $rules['tags'] = ['prohibited'];
            $rules['assignee_id'] = [
                'sometimes', 'nullable', 'integer',
                Rule::exists('team_user', 'user_id')->where('team_id', $task->team_id),
            ];
        }

        return $rules;
    }

    public function attributes(): array
    {
        return parent::attributes() + ['assignee_id' => '担当者'];
    }
}
