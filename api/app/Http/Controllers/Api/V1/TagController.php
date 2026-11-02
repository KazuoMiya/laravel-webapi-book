<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\TagResource;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Cache;

class TagController extends Controller
{
    // GET /api/v1/tags
    public function index(Request $request): AnonymousResourceCollection
    {
        $user = $request->user();

        // タグの一覧は変更が少ないので、ユーザーごとに10分間キャッシュする（第17章）
        $tags = Cache::remember("users:{$user->id}:tags", now()->addMinutes(10),
            fn () => $user->tags()->orderBy('name')->get());

        return TagResource::collection($tags);
    }
}
