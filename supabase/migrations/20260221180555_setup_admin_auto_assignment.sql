-- 管理者権限の自動設定（統合版）
-- Supabase Dashboard → SQL Editor で実行してください
--
-- このスクリプトは以下を実行します:
-- 1. 本部店舗（ADMIN_HQ）を作成
-- 2. 店舗コードに「ADMIN」が含まれる店舗のユーザーを自動的に管理者にするトリガーを設定
-- 3. 既存のユーザーの権限を更新

-- ============================================
-- 1. 本部店舗を作成
-- ============================================

INSERT INTO stores (store_code, store_name, region, status) VALUES
  ('ADMIN_HQ', '本部', '本部', 'active')
ON CONFLICT (store_code) DO NOTHING;

-- ============================================
-- 2. 管理者権限の自動付与トリガー
-- ============================================

-- プロフィール挿入時に店舗コードをチェックして管理者権限を自動付与する関数
CREATE OR REPLACE FUNCTION auto_assign_admin_role()
RETURNS TRIGGER AS $$
BEGIN
  -- 店舗コードに「ADMIN」が含まれている場合は管理者権限を付与
  IF NEW.store_code IS NOT NULL AND UPPER(NEW.store_code) LIKE '%ADMIN%' THEN
    -- 店舗が実際に存在し、activeであることを確認
    IF EXISTS (
      SELECT 1 FROM stores
      WHERE store_code = NEW.store_code
      AND status = 'active'
    ) THEN
      NEW.role := 'admin';
      RAISE NOTICE '管理者権限を付与しました: % (%)', NEW.email, NEW.store_code;
    ELSE
      -- 店舗が存在しない、または非アクティブの場合はエラー
      RAISE EXCEPTION '無効な店舗コードです: %', NEW.store_code;
    END IF;
  ELSE
    -- 通常の店舗コードの場合は一般ユーザー（roleが未設定の場合のみ）
    IF NEW.role IS NULL THEN
      NEW.role := 'user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- トリガーを作成（既存の場合は削除して再作成）
DROP TRIGGER IF EXISTS trigger_auto_assign_admin_role ON profiles;

CREATE TRIGGER trigger_auto_assign_admin_role
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_admin_role();

-- ============================================
-- 3. 既存のユーザーの権限を更新
-- ============================================

-- 店舗コードに「ADMIN」が含まれるユーザーを管理者にする
UPDATE profiles p
SET role = 'admin'
FROM stores s
WHERE p.store_id = s.id
  AND UPPER(s.store_code) LIKE '%ADMIN%'
  AND s.status = 'active'
  AND p.role != 'admin';

-- 店舗コードに「ADMIN」が含まれないユーザーで、roleがNULLのものをuserにする
UPDATE profiles
SET role = 'user'
WHERE role IS NULL
  AND (store_code IS NULL OR UPPER(store_code) NOT LIKE '%ADMIN%');

-- ============================================
-- 4. 確認
-- ============================================

-- 本部店舗の確認
SELECT * FROM stores WHERE store_code LIKE '%ADMIN%';

-- 管理者ユーザーの確認
SELECT
  p.id,
  p.email,
  p.display_name,
  p.role,
  p.store_code,
  s.store_name,
  p.created_at
FROM profiles p
LEFT JOIN stores s ON p.store_id = s.id
WHERE p.role = 'admin'
ORDER BY p.created_at DESC;

-- 全ユーザーの権限確認
SELECT
  p.email,
  p.display_name,
  p.role,
  p.store_code,
  s.store_name
FROM profiles p
LEFT JOIN stores s ON p.store_id = s.id
ORDER BY p.created_at DESC
LIMIT 20;

-- ============================================
-- 完了メッセージ
-- ============================================

DO $$
DECLARE
  admin_count INT;
  user_count INT;
BEGIN
  SELECT COUNT(*) INTO admin_count FROM profiles WHERE role = 'admin';
  SELECT COUNT(*) INTO user_count FROM profiles WHERE role = 'user';

  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ 管理者権限の自動設定が完了しました！';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '📊 現在の状況:';
  RAISE NOTICE '  - 管理者: % 人', admin_count;
  RAISE NOTICE '  - 一般ユーザー: % 人', user_count;
  RAISE NOTICE '';
  RAISE NOTICE '🔧 設定内容:';
  RAISE NOTICE '  ✓ 本部店舗（ADMIN_HQ）を作成';
  RAISE NOTICE '  ✓ 自動権限付与トリガーを設定';
  RAISE NOTICE '  ✓ 既存ユーザーの権限を更新';
  RAISE NOTICE '';
  RAISE NOTICE '📝 ルール:';
  RAISE NOTICE '  - 店舗コードに「ADMIN」が含まれる → 管理者権限';
  RAISE NOTICE '  - それ以外の店舗 → 通常ユーザー';
  RAISE NOTICE '';
  RAISE NOTICE '💡 今後の登録:';
  RAISE NOTICE '  新規登録時に店舗コード「ADMIN_HQ」を入力すると';
  RAISE NOTICE '  自動的に管理者権限が付与されます。';
  RAISE NOTICE '========================================';
END $$;
