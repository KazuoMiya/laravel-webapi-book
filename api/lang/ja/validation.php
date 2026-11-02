<?php

return [
    'required' => ':attributeは必須です。',
    'string' => ':attributeは文字列で指定してください。',
    'boolean' => ':attributeはtrueかfalseで指定してください。',
    'array' => ':attributeは配列で指定してください。',
    'email' => ':attributeは正しいメールアドレスの形式で指定してください。',
    'unique' => 'その:attributeはすでに使われています。',
    'confirmed' => ':attributeが確認用の値と一致しません。',
    'distinct' => ':attributeに重複した値があります。',
    'in' => '選択された:attributeは正しくありません。',
    'integer' => ':attributeは整数で指定してください。',
    'date_format' => ':attributeは:formatの形式で指定してください。',
    'max' => [
        'string' => ':attributeは:max文字以内で指定してください。',
        'array' => ':attributeは:max個以内で指定してください。',
        'numeric' => ':attributeは:max以下で指定してください。',
    ],
    'min' => [
        'string' => ':attributeは:min文字以上で指定してください。',
    ],
    'between' => [
        'numeric' => ':attributeは:minから:maxの間で指定してください。',
    ],
    'attributes' => [
        'name' => '名前',
        'email' => 'メールアドレス',
        'password' => 'パスワード',
    ],
];
