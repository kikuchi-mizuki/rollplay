-- 講師評価テーブル（評価精度検証用）
CREATE TABLE IF NOT EXISTS instructor_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  evaluation_id UUID REFERENCES evaluations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  store_id UUID REFERENCES stores(id),
  scenario_id TEXT NOT NULL,

  -- 講師によるスコア（4軸評価）
  instructor_scores JSONB NOT NULL,

  -- 講師の総合評価コメント
  instructor_comments JSONB,

  -- AI評価との比較結果
  ai_scores JSONB,
  score_differences JSONB,
  accuracy_metrics JSONB,

  -- メタデータ
  instructor_name TEXT,
  evaluated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_instructor_evaluations_conversation_id
  ON instructor_evaluations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_instructor_evaluations_evaluation_id
  ON instructor_evaluations(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_instructor_evaluations_user_id
  ON instructor_evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_instructor_evaluations_scenario_id
  ON instructor_evaluations(scenario_id);

-- RLSポリシー設定
ALTER TABLE instructor_evaluations ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分のデータのみ閲覧可能
CREATE POLICY "Users can view own instructor evaluations"
  ON instructor_evaluations FOR SELECT
  USING (auth.uid() = user_id);

-- ユーザーは自分のデータのみ作成可能
CREATE POLICY "Users can create own instructor evaluations"
  ON instructor_evaluations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 管理者は全データ閲覧可能
CREATE POLICY "Admins can view all instructor evaluations"
  ON instructor_evaluations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 管理者は全データ作成可能
CREATE POLICY "Admins can create all instructor evaluations"
  ON instructor_evaluations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- トリガー: updated_atの自動更新
CREATE OR REPLACE FUNCTION update_instructor_evaluations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_instructor_evaluations_updated_at
  BEFORE UPDATE ON instructor_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION update_instructor_evaluations_updated_at();

-- コメント追加
COMMENT ON TABLE instructor_evaluations IS '講師による評価結果を保存し、AI評価との比較を行うテーブル';
COMMENT ON COLUMN instructor_evaluations.instructor_scores IS '講師によるスコア（questioning_skill, listening_skill, proposal_skill, closing_skill）';
COMMENT ON COLUMN instructor_evaluations.score_differences IS 'AI評価と講師評価の差分';
COMMENT ON COLUMN instructor_evaluations.accuracy_metrics IS '精度指標（一致率、平均誤差等）';
