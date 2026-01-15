import { useRef, useCallback, useEffect, useState } from 'react';

/**
 * 背景ぼかしカスタムフック
 *
 * カメラ映像に背景ぼかし（またはバーチャル背景）を適用
 * ブラウザネイティブの`filter: blur()`を使用するシンプルな実装
 */
export function useBackgroundBlur() {
  const [isBlurEnabled, setIsBlurEnabled] = useState(false);
  const [blurIntensity, setBlurIntensity] = useState(10); // 0-20px
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);

  /**
   * 背景ぼかしを有効化/無効化
   */
  const toggleBlur = useCallback(() => {
    setIsBlurEnabled(prev => !prev);
  }, []);

  /**
   * ぼかし強度を変更（0-20）
   */
  const changeBlurIntensity = useCallback((intensity: number) => {
    setBlurIntensity(Math.max(0, Math.min(20, intensity)));
  }, []);

  /**
   * 背景ぼかし処理を適用したストリームを生成
   *
   * @param originalStream - 元のカメラストリーム
   * @returns ぼかし処理済みストリーム
   */
  const applyBlurToStream = useCallback(
    async (originalStream: MediaStream): Promise<MediaStream> => {
      if (!isBlurEnabled || !canvasRef.current) {
        return originalStream;
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return originalStream;

      // 元の映像からvideoElementを作成
      const video = document.createElement('video');
      video.srcObject = originalStream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;

      // Canvasサイズを設定
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          resolve();
        };
      });

      // 背景ぼかし処理をフレームごとに適用
      const processFrame = () => {
        if (!isBlurEnabled) {
          return;
        }

        // フレームをCanvasに描画
        ctx.filter = `blur(${blurIntensity}px)`;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';

        requestAnimationFrame(processFrame);
      };

      processFrame();

      // CanvasからMediaStreamを生成
      const processedStream = canvas.captureStream(30); // 30 FPS

      // 元のオーディオトラックを追加
      const audioTracks = originalStream.getAudioTracks();
      audioTracks.forEach(track => {
        processedStream.addTrack(track);
      });

      processedStreamRef.current = processedStream;
      return processedStream;
    },
    [isBlurEnabled, blurIntensity]
  );

  /**
   * クリーンアップ
   */
  useEffect(() => {
    return () => {
      if (processedStreamRef.current) {
        processedStreamRef.current.getTracks().forEach(track => track.stop());
        processedStreamRef.current = null;
      }
    };
  }, []);

  return {
    isBlurEnabled,
    blurIntensity,
    canvasRef,
    toggleBlur,
    changeBlurIntensity,
    applyBlurToStream,
  };
}
