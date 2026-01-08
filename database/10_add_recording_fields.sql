-- 録画機能追加：conversationsテーブルに録画関連フィールドを追加
-- セッション32: 練習履歴から録画ダウンロード機能

-- 録画ファイルのパスとメタデータを追加
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS recording_url TEXT,
ADD COLUMN IF NOT EXISTS recording_filename TEXT,
ADD COLUMN IF NOT EXISTS recording_size_bytes BIGINT,
ADD COLUMN IF NOT EXISTS recording_duration_seconds INT,
ADD COLUMN IF NOT EXISTS has_recording BOOLEAN DEFAULT false;

-- インデックス作成（録画ありのレコードを高速検索）
CREATE INDEX IF NOT EXISTS idx_conv_has_recording ON conversations(has_recording) WHERE has_recording = true;

COMMENT ON COLUMN conversations.recording_url IS '録画ファイルのURL（Supabase Storage）';
COMMENT ON COLUMN conversations.recording_filename IS '録画ファイル名（roleplay_YYYYMMDD_HHMMSS.webm）';
COMMENT ON COLUMN conversations.recording_size_bytes IS '録画ファイルサイズ（バイト）';
COMMENT ON COLUMN conversations.recording_duration_seconds IS '録画時間（秒）';
COMMENT ON COLUMN conversations.has_recording IS '録画の有無（true/false）';
