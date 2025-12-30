-- RLS循環参照問題の完全な解決策
-- auth.jwt()を使用してprofilesテーブルの参照を回避
-- 作成日: 2025年12月30日
-- セキュリティ監査レポートの推奨事項に基づく実装

-- ============================================
-- 前提条件の確認
-- ============================================
-- Supabaseのauth.jwt()関数から'role'カスタムクレームを取得します
-- これにより、profilesテーブルを参照せずにロール情報を取得できます

-- ⚠️ 注意: この方法を使用する場合、JWTトークンに'role'クレームを設定する必要があります
-- フロントエンドでログイン時にユーザーのroleをJWTに含める必要があります

-- ============================================
-- Step 1: 古いポリシーを削除（クリーンアップ）
-- ============================================

-- conversationsテーブルの循環参照ポリシーを削除
DROP POLICY IF EXISTS "Admins can view all conversations" ON conversations;
DROP POLICY IF EXISTS "Managers can view store conversations" ON conversations;

-- evaluationsテーブルの循環参照ポリシーを削除
DROP POLICY IF EXISTS "Admins can view all evaluations" ON evaluations;
DROP POLICY IF EXISTS "Managers can view store evaluations" ON evaluations;

-- profilesテーブルの暫定ポリシーを削除
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Service role can update profiles" ON profiles;
DROP POLICY IF EXISTS "Managers can view store users" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;

-- storesテーブルの古いポリシーを削除
DROP POLICY IF EXISTS "Admins can insert stores" ON stores;
DROP POLICY IF EXISTS "Admins can update stores" ON stores;
DROP POLICY IF EXISTS "Admins can delete stores" ON stores;

-- ============================================
-- Step 2: セキュリティ関数の作成（roleチェック）
-- ============================================

-- 現在のユーザーがadminかどうかをチェックする関数
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- JWTからroleを取得して確認（profilesテーブルを参照しない）
  RETURN COALESCE(
    (auth.jwt() ->> 'role')::text = 'admin',
    false
  );
END;
$$;

-- 現在のユーザーがmanagerかどうかをチェックする関数
CREATE OR REPLACE FUNCTION is_manager()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN COALESCE(
    (auth.jwt() ->> 'role')::text = 'manager',
    false
  );
END;
$$;

-- 現在のユーザーのstore_idを取得する関数
CREATE OR REPLACE FUNCTION current_user_store_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- JWTからstore_idを取得（profilesテーブルを参照しない）
  RETURN COALESCE(
    (auth.jwt() ->> 'store_id')::uuid,
    NULL
  );
END;
$$;

-- ============================================
-- Step 3: conversations テーブルのRLSポリシー（修正版）
-- ============================================

-- 管理者は全会話を閲覧可能（循環参照なし）
CREATE POLICY "Admins can view all conversations - fixed"
  ON conversations FOR SELECT
  USING (is_admin());

-- 店舗管理者は自店舗の会話を閲覧可能（循環参照なし）
CREATE POLICY "Managers can view store conversations - fixed"
  ON conversations FOR SELECT
  USING (
    is_manager()
    AND store_id = current_user_store_id()
  );

-- ============================================
-- Step 4: evaluations テーブルのRLSポリシー（修正版）
-- ============================================

-- 管理者は全評価を閲覧可能（循環参照なし）
CREATE POLICY "Admins can view all evaluations - fixed"
  ON evaluations FOR SELECT
  USING (is_admin());

-- 店舗管理者は自店舗の評価を閲覧可能（循環参照なし）
CREATE POLICY "Managers can view store evaluations - fixed"
  ON evaluations FOR SELECT
  USING (
    is_manager()
    AND store_id = current_user_store_id()
  );

-- ============================================
-- Step 5: profiles テーブルのRLSポリシー（修正版）
-- ============================================

-- 店舗管理者は自店舗のユーザーを閲覧可能（循環参照なし）
CREATE POLICY "Managers can view store users - fixed"
  ON profiles FOR SELECT
  USING (
    is_manager()
    AND store_id = current_user_store_id()
  );

-- 管理者は全プロフィールを閲覧可能（循環参照なし）
CREATE POLICY "Admins can view all profiles - fixed"
  ON profiles FOR SELECT
  USING (is_admin());

-- 管理者は全プロフィールを更新可能（循環参照なし）
CREATE POLICY "Admins can update all profiles - fixed"
  ON profiles FOR UPDATE
  USING (is_admin());

-- ============================================
-- Step 6: stores テーブルのRLSポリシー（修正版）
-- ============================================

-- 管理者のみ店舗を作成可能（循環参照なし）
CREATE POLICY "Admins can insert stores - fixed"
  ON stores FOR INSERT
  WITH CHECK (is_admin());

-- 管理者のみ店舗を更新可能（循環参照なし）
CREATE POLICY "Admins can update stores - fixed"
  ON stores FOR UPDATE
  USING (is_admin());

-- 管理者のみ店舗を削除可能（循環参照なし）
CREATE POLICY "Admins can delete stores - fixed"
  ON stores FOR DELETE
  USING (is_admin());

-- ============================================
-- Step 7: 確認とテスト
-- ============================================

-- 作成されたポリシーの確認
SELECT
  tablename,
  policyname,
  cmd AS operation
FROM pg_policies
WHERE tablename IN ('profiles', 'conversations', 'evaluations', 'stores')
  AND policyname LIKE '%fixed%'
ORDER BY tablename, policyname;

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '✅ RLS循環参照問題の完全な解決が完了しました！';
  RAISE NOTICE '';
  RAISE NOTICE '📝 実装内容:';
  RAISE NOTICE '  - is_admin()関数: JWTから管理者権限を確認';
  RAISE NOTICE '  - is_manager()関数: JWTから店舗管理者権限を確認';
  RAISE NOTICE '  - current_user_store_id()関数: JWTから店舗IDを取得';
  RAISE NOTICE '';
  RAISE NOTICE '🔒 セキュリティ改善:';
  RAISE NOTICE '  - profilesテーブルの参照による循環参照を完全に排除';
  RAISE NOTICE '  - 管理者・店舗管理者の適切なアクセス制御を実装';
  RAISE NOTICE '  - 全認証済みユーザーへの過度な権限付与を解消';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  重要な次のステップ:';
  RAISE NOTICE '  1. JWTトークンに''role''と''store_id''カスタムクレームを追加';
  RAISE NOTICE '  2. フロントエンドでログイン時にこれらの情報をトークンに含める';
  RAISE NOTICE '  3. 管理者・店舗管理者でログインしてアクセス権限をテスト';
END $$;

-- ============================================
-- 実装メモ: JWTカスタムクレームの設定方法
-- ============================================
--
-- Supabaseでカスタムクレームを設定するには、以下のいずれかの方法があります：
--
-- 方法1: Database Webhooks（推奨）
--   - auth.usersテーブルのINSERT/UPDATEトリガーでprofilesからrole/store_idを取得
--   - auth.jwt()関数経由でアクセス可能
--
-- 方法2: Edge Functions
--   - ログイン後にEdge FunctionでJWTを更新
--   - カスタムクレームを追加
--
-- 方法3: アプリケーション層での制御（フォールバック）
--   - app.pyのcan_access_data()関数を活用
--   - RLSと併用して二重のセキュリティを確保
--
-- 詳細は公式ドキュメントを参照:
-- https://supabase.com/docs/guides/auth/auth-hooks
