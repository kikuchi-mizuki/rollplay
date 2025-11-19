-- 評価履歴テーブル
-- Week 1 Day 3: データベース設計

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

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_eval_user ON evaluations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_store ON evaluations(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_scenario ON evaluations(scenario_id);
CREATE INDEX IF NOT EXISTS idx_eval_conversation ON evaluations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_eval_created_at ON evaluations(created_at DESC);

-- JSONBカラムにGINインデックス
CREATE INDEX IF NOT EXISTS idx_eval_scores ON evaluations USING GIN (scores);
CREATE INDEX IF NOT EXISTS idx_eval_comments ON evaluations USING GIN (comments);

COMMENT ON TABLE evaluations IS 'AI評価履歴';
COMMENT ON COLUMN evaluations.conversation_id IS '会話ID';
COMMENT ON COLUMN evaluations.user_id IS 'ユーザーID';
COMMENT ON COLUMN evaluations.store_id IS '店舗ID';
COMMENT ON COLUMN evaluations.scenario_id IS 'シナリオID';
COMMENT ON COLUMN evaluations.scores IS 'スコア詳細（JSONB）{hearing: 85, empathy: 78, proposal: 82, trust: 90}';
COMMENT ON COLUMN evaluations.total_score IS '合計スコア';
COMMENT ON COLUMN evaluations.average_score IS '平均スコア';
COMMENT ON COLUMN evaluations.comments IS '項目別コメント（JSONB）{hearing: "...", empathy: "...", ...}';
COMMENT ON COLUMN evaluations.overall_feedback IS '全体的な講評';
COMMENT ON COLUMN evaluations.created_at IS '作成日時';
