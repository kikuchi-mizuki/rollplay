-- 会話履歴テーブル
-- Week 1 Day 3: データベース設計

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

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_store ON conversations(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_scenario ON conversations(scenario_id);
CREATE INDEX IF NOT EXISTS idx_conv_created_at ON conversations(created_at DESC);

-- JSONBカラムにGINインデックス（高速検索用）
CREATE INDEX IF NOT EXISTS idx_conv_messages ON conversations USING GIN (messages);

COMMENT ON TABLE conversations IS 'ロープレ会話履歴';
COMMENT ON COLUMN conversations.user_id IS 'ユーザーID';
COMMENT ON COLUMN conversations.store_id IS '店舗ID';
COMMENT ON COLUMN conversations.scenario_id IS 'シナリオID（meeting_1st, meeting_2nd等）';
COMMENT ON COLUMN conversations.scenario_title IS 'シナリオ名（1次面談、2次面談等）';
COMMENT ON COLUMN conversations.messages IS '会話メッセージ配列（JSONB）[{speaker, text, timestamp}]';
COMMENT ON COLUMN conversations.duration_seconds IS '会話時間（秒）';
COMMENT ON COLUMN conversations.created_at IS '作成日時';
