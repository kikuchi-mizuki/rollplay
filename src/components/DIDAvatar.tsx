import { useState, useEffect, useCallback } from 'react';

interface DIDVideoResponse {
  success: boolean;
  video_url?: string;
  talk_id?: string;
  error?: string;
}

interface DIDVideoProps {
  text: string;
  avatarUrl?: string;
  onVideoReady?: (url: string) => void;
}

export function DIDAvatar({ text, avatarUrl, onVideoReady }: DIDVideoProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateVideo = useCallback(async (messageText: string, avatar?: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/did-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: messageText,
          avatar_url: avatar || 'https://d-id-public-bucket.s3.amazonaws.com/alice.jpg',
          voice_id: 'ja-JP-NanamiNeural'
        }),
      });

      const data: DIDVideoResponse = await response.json();

      if (data.success && data.video_url) {
        setVideoUrl(data.video_url);
        if (onVideoReady) {
          onVideoReady(data.video_url);
        }
      } else {
        setError(data.error || '動画生成に失敗しました');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラー');
    } finally {
      setLoading(false);
    }
  }, [onVideoReady]);

  // テキストが変更されたら動画を生成
  useEffect(() => {
    if (text) {
      generateVideo(text, avatarUrl);
    }
  }, [text, avatarUrl, generateVideo]);

  return (
    <div className="did-avatar">
      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>動画を生成中...（最大2分）</p>
        </div>
      )}

      {error && (
        <div className="error">
          <p>エラー: {error}</p>
        </div>
      )}

      {videoUrl && (
        <video
          src={videoUrl}
          autoPlay
          controls
          className="avatar-video"
          style={{ width: '100%', maxWidth: '640px', borderRadius: '8px' }}
        />
      )}

      {!videoUrl && !loading && (
        <div className="placeholder">
          <p>動画が生成されていません</p>
        </div>
      )}
    </div>
  );
}

// 使用例: RoleplayApp.tsxから呼び出す
export function useDIDAvatar() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generateAndPlayVideo = async (text: string) => {
    setLoading(true);

    try {
      const response = await fetch('/api/did-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice_id: 'ja-JP-NanamiNeural'
        }),
      });

      const data = await response.json();

      if (data.success && data.video_url) {
        setVideoUrl(data.video_url);
        return data.video_url;
      }
    } catch (error) {
      console.error('D-ID video generation failed:', error);
    } finally {
      setLoading(false);
    }

    return null;
  };

  return { videoUrl, loading, generateAndPlayVideo };
}
