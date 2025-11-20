-- アバター管理テーブル
CREATE TABLE IF NOT EXISTS avatars (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_avatars_user_id ON avatars(user_id);
CREATE INDEX IF NOT EXISTS idx_avatars_tags ON avatars USING GIN(tags);

-- RLS (Row Level Security) ポリシー
ALTER TABLE avatars ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分のアバターのみ閲覧・作成・更新・削除可能
CREATE POLICY "Users can view their own avatars"
  ON avatars FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert their own avatars"
  ON avatars FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own avatars"
  ON avatars FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own avatars"
  ON avatars FOR DELETE
  USING (auth.uid() = user_id);

-- アバター画像用ストレージバケット作成
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- ストレージポリシー
CREATE POLICY "Avatar images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated users can upload avatar images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars' AND
    auth.role() = 'authenticated'
  );

CREATE POLICY "Users can update their own avatar images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own avatar images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
