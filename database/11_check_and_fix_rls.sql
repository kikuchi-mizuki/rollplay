-- RLSポリシーを確認して、循環参照を起こす可能性のあるポリシーを削除

-- Step 1: 現在のポリシーを確認
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename IN ('profiles', 'conversations', 'evaluations')
ORDER BY tablename, policyname;

-- Step 2: 問題のあるポリシーを削除（既に存在しない場合はスキップ）

-- conversationsテーブルの循環参照ポリシーを削除
DROP POLICY IF EXISTS "Admins can view all conversations" ON conversations;
DROP POLICY IF EXISTS "Managers can view store conversations" ON conversations;

-- evaluationsテーブルの循環参照ポリシーを削除
DROP POLICY IF EXISTS "Admins can view all evaluations" ON evaluations;
DROP POLICY IF EXISTS "Managers can view store evaluations" ON evaluations;

-- profilesテーブルの古いポリシーを削除（念のため）
DROP POLICY IF EXISTS "Managers can view store users" ON profiles;

-- Step 3: 確認メッセージ
DO $$
BEGIN
  RAISE NOTICE '✅ RLS循環参照ポリシーの削除完了';
  RAISE NOTICE 'ℹ️  残っているポリシーのみが有効です';
END $$;

-- Step 4: 削除後のポリシーを再確認
SELECT
  tablename,
  policyname
FROM pg_policies
WHERE tablename IN ('profiles', 'conversations', 'evaluations')
ORDER BY tablename, policyname;
