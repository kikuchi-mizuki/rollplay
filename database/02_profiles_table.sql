-- ユーザープロフィールテーブル
-- Week 1 Day 3: データベース設計
-- Supabase Authと連携

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  store_code TEXT,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',  -- admin/manager/user
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active_at TIMESTAMP WITH TIME ZONE
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_profile_store ON profiles(store_id);
CREATE INDEX IF NOT EXISTS idx_profile_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profile_role ON profiles(role);

-- 最終ログイン時刻を自動更新する関数
CREATE OR REPLACE FUNCTION update_last_active()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_active_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ログイン時に最終ログイン時刻を更新するトリガーは、
-- アプリケーション側で明示的に更新する方針

COMMENT ON TABLE profiles IS 'ユーザープロフィール（Supabase Auth連携）';
COMMENT ON COLUMN profiles.id IS 'ユーザーID（auth.usersのPK）';
COMMENT ON COLUMN profiles.store_id IS '所属店舗ID';
COMMENT ON COLUMN profiles.store_code IS '店舗コード（登録時に使用）';
COMMENT ON COLUMN profiles.display_name IS '表示名';
COMMENT ON COLUMN profiles.email IS 'メールアドレス';
COMMENT ON COLUMN profiles.avatar_url IS 'アバター画像URL（Googleアカウントから取得）';
COMMENT ON COLUMN profiles.role IS '権限（admin: 本部管理者、manager: 店舗管理者、user: 一般ユーザー）';
COMMENT ON COLUMN profiles.last_active_at IS '最終ログイン日時';
