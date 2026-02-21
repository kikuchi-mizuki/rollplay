-- 管理者権限の自動付与トリガー
-- セキュリティ: クライアント側ではなくデータベース側で権限を制御

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
      RAISE NOTICE '管理者権限を付与しました: %', NEW.store_code;
    ELSE
      -- 店舗が存在しない、または非アクティブの場合はエラー
      RAISE EXCEPTION '無効な店舗コードです: %', NEW.store_code;
    END IF;
  ELSE
    -- 通常の店舗コードの場合は一般ユーザー
    NEW.role := 'user';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- トリガーを作成（既存の場合は削除して再作成）
DROP TRIGGER IF EXISTS trigger_auto_assign_admin_role ON profiles;

CREATE TRIGGER trigger_auto_assign_admin_role
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_admin_role();

-- 既存のプロフィールに対してもロールを更新
UPDATE profiles p
SET role = 'admin'
FROM stores s
WHERE p.store_id = s.id
  AND UPPER(s.store_code) LIKE '%ADMIN%'
  AND s.status = 'active'
  AND p.role != 'admin';

COMMENT ON FUNCTION auto_assign_admin_role IS '店舗コードに基づいて管理者権限を自動付与（セキュリティ強化）';
