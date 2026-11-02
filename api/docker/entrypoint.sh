#!/bin/sh
set -e

# 必須の環境変数がなければ、起動を止める（第18章）
for name in APP_KEY DB_HOST DB_DATABASE DB_USERNAME DB_PASSWORD REDIS_HOST; do
  if [ -z "$(printenv "$name")" ]; then
    echo "環境変数 $name が設定されていません" >&2
    exit 1
  fi
done

# 環境変数が入った状態で、設定、ルート、イベント、ビューのキャッシュを作る
php artisan optimize

exec "$@"
