-- 管理者権限を設定するSQLスクリプト
-- Supabase Dashboard → SQL Editor で実行

-- 使い方:
-- 1. 下記のSQLの <USER_EMAIL> を実際のメールアドレスに置き換える
-- 2. Supabase Dashboard → SQL Editor で実行

-- 例: mmms.dy.23@gmail.com のユーザーを管理者にする
UPDATE profiles
SET role = 'admin'
WHERE email = '<USER_EMAIL>';

-- 確認: 更新されたユーザーを表示
SELECT id, email, display_name, role, store_code
FROM profiles
WHERE email = '<USER_EMAIL>';

-- もしくは、全ユーザーの権限を確認
-- SELECT id, email, display_name, role, store_code FROM profiles ORDER BY created_at DESC;
