-- Row Level Security（RLS）ポリシー設定
-- Week 1 Day 4: RLS設定
-- データアクセス権限の制御

-- ============================================
-- 1. conversationsテーブルのRLS
-- ============================================

-- RLSを有効化
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分のデータのみ閲覧可能
CREATE POLICY "Users can view own conversations"
  ON conversations FOR SELECT
  USING (auth.uid() = user_id);

-- ユーザーは自分のデータを作成可能
CREATE POLICY "Users can insert own conversations"
  ON conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ユーザーは自分のデータを更新可能
CREATE POLICY "Users can update own conversations"
  ON conversations FOR UPDATE
  USING (auth.uid() = user_id);

-- ユーザーは自分のデータを削除可能
CREATE POLICY "Users can delete own conversations"
  ON conversations FOR DELETE
  USING (auth.uid() = user_id);

-- 店舗管理者は自店舗のデータを閲覧可能
CREATE POLICY "Managers can view store conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'manager'
        AND store_id = conversations.store_id
    )
  );

-- 本部管理者は全データ閲覧可能
CREATE POLICY "Admins can view all conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- 2. evaluationsテーブルのRLS
-- ============================================

-- RLSを有効化
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分のデータのみ閲覧可能
CREATE POLICY "Users can view own evaluations"
  ON evaluations FOR SELECT
  USING (auth.uid() = user_id);

-- ユーザーは自分のデータを作成可能
CREATE POLICY "Users can insert own evaluations"
  ON evaluations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ユーザーは自分のデータを更新可能
CREATE POLICY "Users can update own evaluations"
  ON evaluations FOR UPDATE
  USING (auth.uid() = user_id);

-- ユーザーは自分のデータを削除可能
CREATE POLICY "Users can delete own evaluations"
  ON evaluations FOR DELETE
  USING (auth.uid() = user_id);

-- 店舗管理者は自店舗のデータを閲覧可能
CREATE POLICY "Managers can view store evaluations"
  ON evaluations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'manager'
        AND store_id = evaluations.store_id
    )
  );

-- 本部管理者は全データ閲覧可能
CREATE POLICY "Admins can view all evaluations"
  ON evaluations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- 3. profilesテーブルのRLS
-- ============================================

-- RLSを有効化
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分のプロフィールを閲覧可能
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- ユーザーは自分のプロフィールを作成可能（初回登録時）
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ユーザーは自分のプロフィールを更新可能
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- 店舗管理者は自店舗のユーザーを閲覧可能
CREATE POLICY "Managers can view store users"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles AS manager_profile
      WHERE manager_profile.id = auth.uid()
        AND manager_profile.role = 'manager'
        AND manager_profile.store_id = profiles.store_id
    )
  );

-- 本部管理者は全ユーザーを閲覧可能
CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles AS admin_profile
      WHERE admin_profile.id = auth.uid() AND admin_profile.role = 'admin'
    )
  );

-- 本部管理者は全ユーザーを更新可能（権限変更等）
CREATE POLICY "Admins can update all profiles"
  ON profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles AS admin_profile
      WHERE admin_profile.id = auth.uid() AND admin_profile.role = 'admin'
    )
  );

-- ============================================
-- 4. storesテーブルのRLS
-- ============================================

-- RLSを有効化
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

-- 全ユーザーが店舗情報を閲覧可能（登録時に店舗コード検証が必要なため）
CREATE POLICY "All authenticated users can view stores"
  ON stores FOR SELECT
  TO authenticated
  USING (true);

-- 本部管理者のみ店舗を作成可能
CREATE POLICY "Admins can insert stores"
  ON stores FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 本部管理者のみ店舗を更新可能
CREATE POLICY "Admins can update stores"
  ON stores FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 本部管理者のみ店舗を削除可能
CREATE POLICY "Admins can delete stores"
  ON stores FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- 完了メッセージ
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'RLS（Row Level Security）の設定が完了しました！';
  RAISE NOTICE '設定されたポリシー:';
  RAISE NOTICE '  - conversations: ユーザー/店舗管理者/本部管理者';
  RAISE NOTICE '  - evaluations: ユーザー/店舗管理者/本部管理者';
  RAISE NOTICE '  - profiles: ユーザー/店舗管理者/本部管理者';
  RAISE NOTICE '  - stores: 全ユーザー閲覧可 / 本部管理者のみ編集可';
  RAISE NOTICE '次のステップ: Week 1 Day 5 - フロントエンド Supabase統合';
END $$;
