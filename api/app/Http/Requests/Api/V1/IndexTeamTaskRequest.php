<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Support\Facades\Gate;

class IndexTeamTaskRequest extends IndexTaskRequest
{
    public function authorize(): bool
    {
        Gate::authorize('view', $this->route('team'));

        return true;
    }
}
