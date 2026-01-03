import { useState, useRef, useCallback, useEffect } from 'react';
import { SelfieSegmentation, Results } from '@mediapipe/selfie_segmentation';

/**
 * 背景ぼかしカスタムフック
 *
 * MediaPipe Selfie Segmentationを使用して、人物を検出し背景をぼかします。
 *
 * @param sourceStream - 元のカメラストリーム
 * @returns 背景ぼかし制御関数と状態
 */
export function useBackgroundBlur(sourceStream: MediaStream | null) {
  const [isBlurEnabled, setIsBlurEnabled] = useState(false);
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const segmentationRef = useRef<SelfieSegmentation | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  /**
   * MediaPipe Selfie Segmentationの初期化
   */
  const initializeSegmentation = useCallback(async () => {
    if (segmentationRef.current || isInitialized) return;

    try {
      console.log('🎨 背景ぼかし機能を初期化中...');

      const selfieSegmentation = new SelfieSegmentation({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
        },
      });

      selfieSegmentation.setOptions({
        modelSelection: 1, // 0: 一般モデル（軽量）, 1: 風景モデル（高精度）
        selfieMode: true,
      });

      // onResultsコールバックを設定
      selfieSegmentation.onResults((results: Results) => {
        if (!outputCanvasRef.current) return;

        const canvas = outputCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Canvasサイズを設定
        canvas.width = results.image.width;
        canvas.height = results.image.height;

        console.log('🎨 背景ぼかし処理中:', canvas.width, 'x', canvas.height);

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. ぼかした背景を描画
        ctx.filter = 'blur(20px)';
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

        // 2. 人物部分（マスクが白い部分）をくり抜く
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);

        // 3. 元画像から人物部分を上に描画
        ctx.globalCompositeOperation = 'source-over';
        // 一時Canvasを作成して人物だけを抽出
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          tempCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
          tempCtx.globalCompositeOperation = 'destination-in';
          tempCtx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
          ctx.drawImage(tempCanvas, 0, 0);
        }

        ctx.restore();
      });

      segmentationRef.current = selfieSegmentation;
      setIsInitialized(true);

      console.log('✅ 背景ぼかし機能の初期化完了');
    } catch (error) {
      console.error('❌ 背景ぼかし機能の初期化失敗:', error);
    }
  }, [isInitialized]);

  /**
   * 背景ぼかし処理を開始
   */
  const startBlur = useCallback(async () => {
    if (!sourceStream || isProcessing) return;

    setIsProcessing(true);

    try {
      // MediaPipe初期化
      await initializeSegmentation();
      if (!segmentationRef.current) throw new Error('Segmentation初期化失敗');

      // ビデオ要素を作成
      const video = document.createElement('video');
      video.srcObject = sourceStream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      videoRef.current = video;

      // 出力Canvas要素を作成
      const outputCanvas = document.createElement('canvas');
      outputCanvasRef.current = outputCanvas;

      await video.play();

      // Canvasサイズを設定（ビデオがロードされるまで待つ）
      await new Promise<void>((resolve) => {
        const checkVideo = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            outputCanvas.width = video.videoWidth;
            outputCanvas.height = video.videoHeight;
            resolve();
          } else {
            setTimeout(checkVideo, 100);
          }
        };
        checkVideo();
      });

      // 処理済みストリームを取得
      const stream = outputCanvas.captureStream(30); // 30fps
      setProcessedStream(stream);

      // 処理ループ
      const processFrame = async () => {
        if (!videoRef.current || !segmentationRef.current) {
          return;
        }

        try {
          // セグメンテーション実行
          await segmentationRef.current.send({ image: videoRef.current });
        } catch (error) {
          console.error('フレーム処理エラー:', error);
        }

        // 次のフレーム
        animationFrameRef.current = requestAnimationFrame(processFrame);
      };

      // 処理開始
      processFrame();

      console.log('✅ 背景ぼかし処理開始');
    } catch (error) {
      console.error('❌ 背景ぼかし処理開始失敗:', error);
      setIsProcessing(false);
    }
  }, [sourceStream, isProcessing, initializeSegmentation]);

  /**
   * 背景ぼかし処理を停止
   */
  const stopBlur = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (processedStream) {
      processedStream.getTracks().forEach(track => track.stop());
      setProcessedStream(null);
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }

    setIsProcessing(false);
    console.log('🛑 背景ぼかし処理停止');
  }, [processedStream]);

  /**
   * 背景ぼかしのトグル
   */
  const toggleBlur = useCallback(async () => {
    if (isBlurEnabled) {
      setIsBlurEnabled(false);
      stopBlur();
    } else {
      setIsBlurEnabled(true);
      await startBlur();
    }
  }, [isBlurEnabled, startBlur, stopBlur]);

  /**
   * ソースストリームが変更されたときの処理
   */
  useEffect(() => {
    if (isBlurEnabled && sourceStream) {
      stopBlur();
      startBlur();
    }
  }, [sourceStream, isBlurEnabled]);

  /**
   * クリーンアップ
   */
  useEffect(() => {
    return () => {
      stopBlur();
      if (segmentationRef.current) {
        segmentationRef.current.close();
        segmentationRef.current = null;
      }
    };
  }, []);

  return {
    isBlurEnabled,
    toggleBlur,
    processedStream: isBlurEnabled ? processedStream : null,
    isProcessing,
  };
}
