<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ActivityLogResource;
use App\Models\ActivityLog;
use App\Models\Team;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class ActivityLogController extends Controller
{
    // GET /api/v1/teams/{team}/activities（第17章）
    public function index(Team $team): AnonymousResourceCollection
    {
        Gate::authorize('update', $team);   // owner と admin だけ

        $logs = ActivityLog::query()
            ->where('team_id', $team->id)
            ->with('user')
            ->latest('created_at')
            ->paginate(50);

        return ActivityLogResource::collection($logs);
    }
}
