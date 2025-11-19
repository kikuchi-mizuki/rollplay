-- SNS動画営業ロープレシステム データベーススキーマ
-- Week 1 Day 3: マスタースクリプト
-- 実行方法: Supabase Dashboard → SQL Editor → このファイルの内容を貼り付けて実行

-- ============================================
-- 1. 店舗マスタテーブル
-- ============================================

CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code TEXT UNIQUE NOT NULL,
  store_name TEXT NOT NULL,
  region TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_code ON stores(store_code);
CREATE INDEX IF NOT EXISTS idx_region ON stores(region);
CREATE INDEX IF NOT EXISTS idx_status ON stores(status);

-- サンプルデータ
INSERT INTO stores (store_code, store_name, region, status) VALUES
  ('STORE_001', '東京銀座店', '関東', 'active'),
  ('STORE_002', '大阪梅田店', '関西', 'active'),
  ('STORE_003', '福岡天神店', '九州', 'active')
ON CONFLICT (store_code) DO NOTHING;

-- 更新日時の自動更新
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 2. ユーザープロフィールテーブル
-- ============================================

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  store_code TEXT,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_profile_store ON profiles(store_id);
CREATE INDEX IF NOT EXISTS idx_profile_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profile_role ON profiles(role);

-- ============================================
-- 3. 会話履歴テーブル
-- ============================================

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id),
  scenario_id TEXT NOT NULL,
  scenario_title TEXT,
  messages JSONB NOT NULL,
  duration_seconds INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_store ON conversations(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_scenario ON conversations(scenario_id);
CREATE INDEX IF NOT EXISTS idx_conv_created_at ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_messages ON conversations USING GIN (messages);

-- ============================================
-- 4. 評価履歴テーブル
-- ============================================

CREATE TABLE IF NOT EXISTS evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id),
  scenario_id TEXT NOT NULL,
  scores JSONB NOT NULL,
  total_score INT,
  average_score DECIMAL(5,2),
  comments JSONB,
  overall_feedback TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_user ON evaluations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_store ON evaluations(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_scenario ON evaluations(scenario_id);
CREATE INDEX IF NOT EXISTS idx_eval_conversation ON evaluations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_eval_created_at ON evaluations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_scores ON evaluations USING GIN (scores);
CREATE INDEX IF NOT EXISTS idx_eval_comments ON evaluations USING GIN (comments);

-- ============================================
-- 完了メッセージ
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'データベーススキーマの作成が完了しました！';
  RAISE NOTICE '作成されたテーブル: stores, profiles, conversations, evaluations';
  RAISE NOTICE '次のステップ: Week 1 Day 4 - RLS設定';
END $$;
