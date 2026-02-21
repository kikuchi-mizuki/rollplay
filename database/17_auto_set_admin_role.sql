-- 管理者権限の自動設定
-- Supabase Dashboard → SQL Editor で実行してください

-- ============================================
-- 方法1: 最初のユーザーを自動的に管理者にする
-- ============================================

-- 最初に登録されたユーザーを自動的に管理者にする関数
CREATE OR REPLACE FUNCTION auto_set_first_user_as_admin()
RETURNS TRIGGER AS $$
BEGIN
  -- profilesテーブルのレコード数を確認
  -- もし1件目なら自動的に管理者にする
  IF (SELECT COUNT(*) FROM profiles) = 1 THEN
    UPDATE profiles
    SET role = 'admin'
    WHERE id = NEW.id;

    RAISE NOTICE '最初のユーザーを管理者に設定しました: %', NEW.email;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- トリガーを作成（既存のトリガーがあれば削除）
DROP TRIGGER IF EXISTS set_first_user_admin ON profiles;

CREATE TRIGGER set_first_user_admin
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_first_user_as_admin();

-- ============================================
-- 方法2: 特定のメールアドレスを管理者にする
-- ============================================

-- 特定のメールアドレスドメインを持つユーザーを自動的に管理者にする関数
CREATE OR REPLACE FUNCTION auto_set_admin_by_email()
RETURNS TRIGGER AS $$
BEGIN
  -- 特定のメールアドレスを管理者にする
  -- ※ ここに自分のメールアドレスを追加してください
  IF NEW.email IN (
    'mmms.dy.23@gmail.com'  -- ← ここに管理者のメールアドレスを追加
    -- 複数のメールアドレスを追加する場合はカンマ区切りで追加
    -- 'admin@example.com',
    -- 'manager@example.com'
  ) THEN
    NEW.role = 'admin';
    RAISE NOTICE 'メールアドレスに基づいて管理者権限を付与: %', NEW.email;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガーを作成（既存のトリガーがあれば削除）
DROP TRIGGER IF EXISTS set_admin_by_email ON profiles;

CREATE TRIGGER set_admin_by_email
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_admin_by_email();

-- ============================================
-- 確認と既存ユーザーの更新
-- ============================================

-- 既存のユーザーで、指定したメールアドレスを持つユーザーを管理者にする
UPDATE profiles
SET role = 'admin'
WHERE email = 'mmms.dy.23@gmail.com';  -- ← ここに自分のメールアドレスを入力

-- 確認: 管理者ユーザーを表示
SELECT id, email, display_name, role, created_at
FROM profiles
WHERE role = 'admin'
ORDER BY created_at;

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '管理者権限の自動設定が完了しました！';
  RAISE NOTICE '========================================';
  RAISE NOTICE '設定内容:';
  RAISE NOTICE '1. 最初のユーザーは自動的に管理者になります';
  RAISE NOTICE '2. mmms.dy.23@gmail.com は自動的に管理者になります';
  RAISE NOTICE '';
  RAISE NOTICE '追加の管理者メールアドレスを設定する場合:';
  RAISE NOTICE 'auto_set_admin_by_email() 関数を編集してください';
  RAISE NOTICE '========================================';
END $$;
