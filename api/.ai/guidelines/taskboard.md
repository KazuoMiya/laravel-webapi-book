# TaskBoard API の開発ルール

- APIの応答は必ずAPIリソース（app/Http/Resources）を通す。モデルをそのまま返さない
- 入力はフォームリクエストで検証し、コントローラーでは validated() の値だけを使う
- user_id と team_id を #[Fillable] に入れない。リレーション経由で設定する
- 個人のデータは $request->user() から、チームのデータは $team から問い合わせを始める
- 権限の判定は Policy に書き、コントローラーでは Gate::authorize を呼ぶ
- 他人や他のチームのデータには404を返す
- エラーの形は {"message": ...}、入力の誤りは {"message": ..., "errors": {...}}
- 機能を追加したら、正常な場合、入力の誤り、権限のテストを tests/Feature に書く
