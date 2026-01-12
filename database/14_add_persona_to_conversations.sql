-- ペルソナ情報をconversationsテーブルに追加
-- セッション内でペルソナを固定するために使用

-- 既存のconversationsテーブルにpersona列を追加
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS persona JSONB;

-- GINインデックスを追加（高速検索用）
CREATE INDEX IF NOT EXISTS idx_conv_persona ON conversations USING GIN (persona);

COMMENT ON COLUMN conversations.persona IS 'AI顧客のペルソナ情報（業種、場所、事業詳細、ペインポイント等）会話内で固定';
