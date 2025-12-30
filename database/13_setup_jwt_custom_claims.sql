-- JWT カスタムクレームのセットアップ
-- RLS循環参照問題の解決 - Step 1: Database Function & Trigger作成
-- 作成日: 2025年12月30日

-- ============================================
-- Step 1: Database Functionの作成
-- ============================================

-- ユーザーのメタデータにroleとstore_idを追加する関数
CREATE OR REPLACE FUNCTION public.set_user_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_profile RECORD;
BEGIN
  -- profilesテーブルからユーザー情報を取得
  SELECT role, store_id
  INTO user_profile
  FROM public.profiles
  WHERE id = NEW.id;

  -- user_profileが存在する場合
  IF user_profile IS NOT NULL THEN
    -- auth.usersテーブルのraw_user_meta_dataを更新
    UPDATE auth.users
    SET raw_user_meta_data =
      COALESCE(raw_user_meta_data, '{}'::jsonb) ||
      jsonb_build_object(
        'role', user_profile.role,
        'store_id', user_profile.store_id
      )
    WHERE id = NEW.id;

    RAISE NOTICE 'Updated JWT metadata for user %: role=%, store_id=%',
      NEW.id, user_profile.role, user_profile.store_id;
  END IF;

  RETURN NEW;
END;
$$;

-- コメント追加
COMMENT ON FUNCTION public.set_user_metadata() IS
'profilesテーブルの変更時にauth.usersのメタデータを自動更新してJWTにroleとstore_idを含める';

-- ============================================
-- Step 2: Triggerの作成
-- ============================================

-- 既存のトリガーを削除（存在する場合）
DROP TRIGGER IF EXISTS on_profile_created ON public.profiles;
DROP TRIGGER IF EXISTS on_profile_updated ON public.profiles;

-- INSERT時のトリガー
CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_metadata();

COMMENT ON TRIGGER on_profile_created ON public.profiles IS
'新規プロフィール作成時にJWTメタデータを自動更新';

-- UPDATE時のトリガー（roleまたはstore_idが変更された場合のみ）
CREATE TRIGGER on_profile_updated
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (
    OLD.role IS DISTINCT FROM NEW.role OR
    OLD.store_id IS DISTINCT FROM NEW.store_id
  )
  EXECUTE FUNCTION public.set_user_metadata();

COMMENT ON TRIGGER on_profile_updated ON public.profiles IS
'プロフィールのroleまたはstore_id変更時にJWTメタデータを自動更新';

-- ============================================
-- Step 3: 既存ユーザーのメタデータを一括更新
-- ============================================

-- 既存の全ユーザーのメタデータを更新
UPDATE auth.users AS u
SET raw_user_meta_data =
  COALESCE(u.raw_user_meta_data, '{}'::jsonb) ||
  jsonb_build_object(
    'role', p.role,
    'store_id', p.store_id
  )
FROM public.profiles AS p
WHERE u.id = p.id
  AND p.role IS NOT NULL;

-- ============================================
-- Step 4: 確認クエリ
-- ============================================

-- 更新されたユーザーのメタデータを表示
SELECT
  u.email,
  u.raw_user_meta_data->>'role' AS role_in_jwt,
  u.raw_user_meta_data->>'store_id' AS store_id_in_jwt,
  p.role AS role_in_profile,
  p.store_id AS store_id_in_profile,
  CASE
    WHEN u.raw_user_meta_data->>'role' = p.role THEN '✅'
    ELSE '❌'
  END AS role_sync,
  CASE
    WHEN (u.raw_user_meta_data->>'store_id')::uuid = p.store_id THEN '✅'
    WHEN u.raw_user_meta_data->>'store_id' IS NULL AND p.store_id IS NULL THEN '✅'
    ELSE '❌'
  END AS store_id_sync
FROM auth.users AS u
LEFT JOIN public.profiles AS p ON u.id = p.id
ORDER BY u.created_at DESC
LIMIT 20;

-- ============================================
-- Step 5: Triggerのテスト
-- ============================================

-- Triggerが正しく設定されているか確認
SELECT
  trigger_name,
  event_manipulation AS event,
  event_object_table AS table_name,
  action_timing AS timing,
  action_statement AS action
FROM information_schema.triggers
WHERE event_object_table = 'profiles'
  AND trigger_schema = 'public'
ORDER BY trigger_name;

-- ============================================
-- 完了メッセージ
-- ============================================

DO $$
DECLARE
  updated_count INTEGER;
  trigger_count INTEGER;
BEGIN
  -- 更新されたユーザー数をカウント
  SELECT COUNT(*) INTO updated_count
  FROM auth.users AS u
  INNER JOIN public.profiles AS p ON u.id = p.id
  WHERE u.raw_user_meta_data->>'role' IS NOT NULL;

  -- Trigger数をカウント
  SELECT COUNT(*) INTO trigger_count
  FROM information_schema.triggers
  WHERE event_object_table = 'profiles'
    AND trigger_schema = 'public';

  RAISE NOTICE '';
  RAISE NOTICE '✅ JWT カスタムクレームのセットアップが完了しました！';
  RAISE NOTICE '';
  RAISE NOTICE '📊 実行結果:';
  RAISE NOTICE '  - 作成された関数: set_user_metadata()';
  RAISE NOTICE '  - 作成されたTrigger: % 個', trigger_count;
  RAISE NOTICE '  - 更新されたユーザー: % 人', updated_count;
  RAISE NOTICE '';
  RAISE NOTICE '🔍 確認方法:';
  RAISE NOTICE '  上記のSELECTクエリ結果で role_sync と store_id_sync が ✅ になっていることを確認';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  重要: 変更を反映するには、ユーザーが再ログインする必要があります';
  RAISE NOTICE '';
  RAISE NOTICE '📝 次のステップ:';
  RAISE NOTICE '  1. database/12_fix_rls_with_jwt.sql を実行してRLSポリシーを適用';
  RAISE NOTICE '  2. 管理者・店舗管理者・一般ユーザーでログインしてテスト';
  RAISE NOTICE '  3. docs/JWT_CUSTOM_CLAIMS_SETUP_GUIDE.md のチェックリストを確認';
END $$;
