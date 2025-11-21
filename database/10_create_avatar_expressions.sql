-- ===================================================================
-- アバター表情テーブル作成
-- ===================================================================
--
-- 目的: AI相談者のアバター表情画像を管理
--
-- 機能:
-- - 複数のアバター（人物）を登録
-- - 各アバターにつき複数の表情画像を登録
-- - 表情タイプ: listening, smile, confused, thinking, nodding, interested
-- - AIの返答に応じて適切な表情を選択・表示
--
-- ===================================================================

-- アバター表情テーブル
CREATE TABLE IF NOT EXISTS avatar_expressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- アバター情報
  avatar_id TEXT NOT NULL,  -- 例: avatar_01, avatar_02, avatar_03
  avatar_name TEXT NOT NULL,  -- 例: 佐藤さん（30代男性）

  -- 表情情報
  expression_type TEXT NOT NULL,  -- listening, smile, confused, thinking, nodding, interested
  expression_name TEXT NOT NULL,  -- 真剣に聞く、笑顔、困惑、考える、うなずく、興味を示す

  -- 画像URL
  image_url TEXT NOT NULL,  -- 画像のURL（public/avatars/avatar_01_listening.png など）

  -- メタデータ
  description TEXT,  -- 表情の説明
  tags TEXT[],  -- タグ（例: ['positive', 'friendly']）
  is_default BOOLEAN DEFAULT FALSE,  -- デフォルト表情かどうか

  -- タイムスタンプ
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- インデックス作成
CREATE INDEX idx_avatar_expressions_avatar_id ON avatar_expressions(avatar_id);
CREATE INDEX idx_avatar_expressions_expression_type ON avatar_expressions(expression_type);
CREATE INDEX idx_avatar_expressions_is_default ON avatar_expressions(is_default);

-- ユニーク制約: 同じアバターの同じ表情は1つだけ
CREATE UNIQUE INDEX idx_avatar_expressions_unique ON avatar_expressions(avatar_id, expression_type);

-- RLSポリシー: 全ユーザーが閲覧可能
ALTER TABLE avatar_expressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view avatar expressions"
  ON avatar_expressions
  FOR SELECT
  USING (true);

-- 管理者のみ追加・更新・削除可能
CREATE POLICY "Admins can insert avatar expressions"
  ON avatar_expressions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update avatar expressions"
  ON avatar_expressions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete avatar expressions"
  ON avatar_expressions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- サンプルデータ挿入
-- 注意: 実際の画像URLはpublic/avatars/に保存されたファイルパスに置き換えてください

INSERT INTO avatar_expressions (avatar_id, avatar_name, expression_type, expression_name, image_url, description, is_default) VALUES
-- avatar_01（30代男性・佐藤さん）
('avatar_01', '佐藤さん（30代男性）', 'listening', '真剣に聞く', '/avatars/avatar_01_listening.png', 'ヒアリング中のデフォルト表情', true),
('avatar_01', '佐藤さん（30代男性）', 'smile', '笑顔', '/avatars/avatar_01_smile.png', 'ポジティブな反応', false),
('avatar_01', '佐藤さん（30代男性）', 'confused', '困惑', '/avatars/avatar_01_confused.png', '不安や疑問を表現', false),
('avatar_01', '佐藤さん（30代男性）', 'thinking', '考える', '/avatars/avatar_01_thinking.png', '質問に対して考える', false),
('avatar_01', '佐藤さん（30代男性）', 'nodding', 'うなずく', '/avatars/avatar_01_nodding.png', '同意・共感を示す', false),
('avatar_01', '佐藤さん（30代男性）', 'interested', '興味を示す', '/avatars/avatar_01_interested.png', '提案に興味を持つ', false),

-- avatar_02（40代女性・田中さん）
('avatar_02', '田中さん（40代女性）', 'listening', '真剣に聞く', '/avatars/avatar_02_listening.png', 'ヒアリング中のデフォルト表情', true),
('avatar_02', '田中さん（40代女性）', 'smile', '笑顔', '/avatars/avatar_02_smile.png', 'ポジティブな反応', false),
('avatar_02', '田中さん（40代女性）', 'confused', '困惑', '/avatars/avatar_02_confused.png', '不安や疑問を表現', false),
('avatar_02', '田中さん（40代女性）', 'thinking', '考える', '/avatars/avatar_02_thinking.png', '質問に対して考える', false),
('avatar_02', '田中さん（40代女性）', 'nodding', 'うなずく', '/avatars/avatar_02_nodding.png', '同意・共感を示す', false),
('avatar_02', '田中さん（40代女性）', 'interested', '興味を示す', '/avatars/avatar_02_interested.png', '提案に興味を持つ', false),

-- avatar_03（20代女性・山田さん）
('avatar_03', '山田さん（20代女性）', 'listening', '真剣に聞く', '/avatars/avatar_03_listening.png', 'ヒアリング中のデフォルト表情', true),
('avatar_03', '山田さん（20代女性）', 'smile', '笑顔', '/avatars/avatar_03_smile.png', 'ポジティブな反応', false),
('avatar_03', '山田さん（20代女性）', 'confused', '困惑', '/avatars/avatar_03_confused.png', '不安や疑問を表現', false),
('avatar_03', '山田さん（20代女性）', 'thinking', '考える', '/avatars/avatar_03_thinking.png', '質問に対して考える', false),
('avatar_03', '山田さん（20代女性）', 'nodding', 'うなずく', '/avatars/avatar_03_nodding.png', '同意・共感を示す', false),
('avatar_03', '山田さん（20代女性）', 'interested', '興味を示す', '/avatars/avatar_03_interested.png', '提案に興味を持つ', false);

-- 完了メッセージ
SELECT 'avatar_expressions テーブル作成完了' AS status;
