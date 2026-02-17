-- =============================================================================
-- RLSポリシー修正SQL
-- このSQLをSupabase Dashboardで実行してください
-- =============================================================================

-- 実行手順:
-- 1. https://supabase.com/dashboard/project/guargnhnblhiupjumkhe を開く
-- 2. 左メニュー → SQL Editor
-- 3. このファイルの内容をコピー＆ペースト
-- 4. 右上の「Run」ボタンをクリック

-- =============================================================================
-- 既存のポリシーを全て削除
-- =============================================================================

DROP POLICY IF EXISTS "Admins can insert stores" ON stores;
DROP POLICY IF EXISTS "Admins can update stores" ON stores;
DROP POLICY IF EXISTS "Admins can delete stores" ON stores;
DROP POLICY IF EXISTS "All authenticated users can view stores" ON stores;

-- =============================================================================
-- 新しいポリシーを作成
-- =============================================================================

-- 1. 全認証ユーザーが店舗情報を閲覧可能
CREATE POLICY "All authenticated users can view stores"
  ON stores
  FOR SELECT
  TO authenticated
  USING (true);

-- 2. 管理者のみ店舗を作成可能
CREATE POLICY "Admins can insert stores"
  ON stores
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- 3. 管理者のみ店舗を更新可能
CREATE POLICY "Admins can update stores"
  ON stores
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- 4. 管理者のみ店舗を削除可能
CREATE POLICY "Admins can delete stores"
  ON stores
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- =============================================================================
-- 確認: ポリシーが正しく作成されたか確認
-- =============================================================================

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  cmd,
  CASE
    WHEN roles = '{authenticated}' THEN 'authenticated'
    ELSE roles::text
  END as roles
FROM pg_policies
WHERE tablename = 'stores'
ORDER BY policyname;

-- =============================================================================
-- 完了メッセージ
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ RLSポリシーの修正が完了しました！';
  RAISE NOTICE '';
  RAISE NOTICE '次のステップ:';
  RAISE NOTICE '1. ブラウザで完全リロード (Ctrl+Shift+R / Command+Shift+R)';
  RAISE NOTICE '2. 店舗管理画面で店舗作成を試してください';
END $$;
