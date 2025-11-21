-- D-ID動画キャッシュテーブル
CREATE TABLE IF NOT EXISTS video_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL,  -- テキスト+音声ID+アバターのハッシュ値

  -- 動画メタデータ
  text_content TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  avatar_url TEXT NOT NULL,

  -- Supabase Storage URL
  video_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,

  -- 統計情報
  hit_count INTEGER DEFAULT 0,
  file_size_bytes BIGINT,
  duration_seconds DECIMAL,

  -- メタデータ
  created_at TIMESTAMP DEFAULT NOW(),
  last_accessed_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP  -- オプション: 有効期限
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_video_cache_cache_key
  ON video_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_video_cache_last_accessed
  ON video_cache(last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_cache_hit_count
  ON video_cache(hit_count DESC);

-- RLSポリシー設定
ALTER TABLE video_cache ENABLE ROW LEVEL SECURITY;

-- 全ユーザーが閲覧可能（キャッシュは共有リソース）
CREATE POLICY "Anyone can view video cache"
  ON video_cache FOR SELECT
  USING (true);

-- サーバー側のみ作成・更新可能（APIサーバーからのみ）
-- 注: Supabase Service Roleキーを使用する場合はRLSをバイパス

-- トリガー: last_accessed_atの自動更新
CREATE OR REPLACE FUNCTION update_video_cache_last_accessed()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_accessed_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_video_cache_last_accessed
  BEFORE UPDATE ON video_cache
  FOR EACH ROW
  WHEN (OLD.hit_count IS DISTINCT FROM NEW.hit_count)
  EXECUTE FUNCTION update_video_cache_last_accessed();

-- コメント追加
COMMENT ON TABLE video_cache IS 'D-ID動画のキャッシュテーブル。同じテキスト+音声+アバターの組み合わせは再利用される';
COMMENT ON COLUMN video_cache.cache_key IS 'テキスト+音声ID+アバターURLのSHA256ハッシュ値';
COMMENT ON COLUMN video_cache.hit_count IS 'キャッシュヒット回数（人気の動画を追跡）';
COMMENT ON COLUMN video_cache.storage_path IS 'Supabase Storage内のパス（例: videos/cache/abc123.mp4）';
