<?php

namespace App\Enums;

enum TaskPriority: int
{
    case Low = 1;
    case Medium = 2;
    case High = 3;

    // APIで使う文字列（low、medium、high）
    public function key(): string
    {
        return strtolower($this->name);
    }

    // APIの文字列から列挙型に変換する
    public static function fromKey(string $key): self
    {
        foreach (self::cases() as $case) {
            if ($case->key() === $key) {
                return $case;
            }
        }

        throw new \ValueError("Unknown priority: {$key}");
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_map(fn (self $case) => $case->key(), self::cases());
    }
}
