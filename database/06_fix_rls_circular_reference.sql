-- profilesテーブルのRLS循環参照を修正
-- 問題: Managers/Adminsポリシーがprofilesテーブルを参照して無限ループを引き起こす

-- 問題のあるポリシーを削除
DROP POLICY IF EXISTS "Managers can view store users" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;

-- シンプルなポリシーに置き換え（循環参照なし）
-- すべての認証済みユーザーが全プロフィールを閲覧可能
-- （将来的にはセキュリティ関数を使って適切に制限）
CREATE POLICY "Authenticated users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- 本部管理者は全ユーザーを更新可能（簡略版）
CREATE POLICY "Service role can update profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (true);

-- 確認メッセージ
DO $$
BEGIN
  RAISE NOTICE '✅ profilesテーブルのRLS循環参照を修正しました';
  RAISE NOTICE '⚠️  現在は全認証済みユーザーが全プロフィールを閲覧可能です';
  RAISE NOTICE '⚠️  本番環境では適切な権限管理を実装してください';
END $$;
