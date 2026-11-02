# 1段目：依存パッケージをインストールする
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
# PHPの拡張機能は2段目のイメージに入れるので、ここでは確認を省く
RUN composer install --no-dev --no-interaction --prefer-dist \
    --no-scripts --no-autoloader --ignore-platform-reqs
COPY . .
RUN composer dump-autoload --no-dev --optimize --no-scripts

# 2段目：実行用のイメージ
FROM php:8.5-apache

RUN apt-get update \
    && docker-php-ext-install pdo_mysql \
    && pecl install redis && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*

# Apacheの公開フォルダーをLaravelの public に変える
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf

COPY docker/php.ini /usr/local/etc/php/conf.d/app.ini

WORKDIR /var/www/html
COPY --from=vendor /app /var/www/html

# 本番の依存関係だけで、パッケージの一覧（bootstrap/cache/packages.php）を作り直す
RUN php artisan package:discover
RUN chown -R www-data:www-data storage bootstrap/cache

# 起動のたびに、渡された環境変数で設定のキャッシュを作ってから動かす
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]
CMD ["apache2-foreground"]
