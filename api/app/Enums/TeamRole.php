<?php

namespace App\Enums;

enum TeamRole: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Member = 'member';
    case Viewer = 'viewer';

    // タスクを作成し、自分が作ったか担当のタスクを更新できるか
    // 役割を増やしたときにうっかり権限が付かないよう、許す役割を並べて書く
    public function canWriteTasks(): bool
    {
        return in_array($this, [self::Owner, self::Admin, self::Member], true);
    }

    // 他人のタスクも更新、削除できるか
    public function canManageAllTasks(): bool
    {
        return in_array($this, [self::Owner, self::Admin], true);
    }

    // チーム名の変更、招待、役割の変更ができるか
    public function canManageTeam(): bool
    {
        return in_array($this, [self::Owner, self::Admin], true);
    }
}
