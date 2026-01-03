import { useState, useRef, useCallback, useEffect } from 'react';
import * as bodySegmentation from '@tensorflow-models/body-segmentation';
import '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';

/**
 * 背景効果のタイプ
 */
export type BackgroundEffect = 'none' | 'blur' | 'image';

/**
 * 背景置き換えカスタムフック
 *
 * TensorFlow.js BodySegmentationを使用して、人物を検出し背景を処理します。
 *
 * @param sourceStream - 元のカメラストリーム
 * @returns 背景処理制御関数と状態
 */
export function useBackgroundBlur(sourceStream: MediaStream | null) {
  const [backgroundEffect, setBackgroundEffect] = useState<BackgroundEffect>('none');
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const segmenterRef = useRef<bodySegmentation.BodySegmenter | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);

  /**
   * TensorFlow.js BodySegmentationの初期化
   */
  const initializeSegmentation = useCallback(async () => {
    if (segmenterRef.current || isInitialized) return;

    try {
      console.log('🎨 背景処理機能を初期化中...');

      // BodySegmentationモデルを読み込み
      const model = bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation;
      const segmenterConfig: bodySegmentation.MediaPipeSelfieSegmentationMediaPipeModelConfig = {
        runtime: 'mediapipe',
        solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation',
        modelType: 'general',
      };

      const segmenter = await bodySegmentation.createSegmenter(model, segmenterConfig);
      segmenterRef.current = segmenter;
      setIsInitialized(true);

      console.log('✅ 背景処理機能の初期化完了');
    } catch (error) {
      console.error('❌ 背景処理機能の初期化失敗:', error);
    }
  }, [isInitialized]);

  /**
   * 背景処理を開始
   */
  const startProcessing = useCallback(async () => {
    if (!sourceStream || isProcessing) return;

    setIsProcessing(true);

    try {
      // BodySegmentation初期化
      await initializeSegmentation();
      if (!segmenterRef.current) throw new Error('Segmentation初期化失敗');

      // ビデオ要素を作成
      const video = document.createElement('video');
      video.srcObject = sourceStream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      videoRef.current = video;

      // Canvas要素を作成
      const canvas = document.createElement('canvas');
      canvasRef.current = canvas;

      await video.play();

      // Canvasサイズを設定（ビデオがロードされるまで待つ）
      await new Promise<void>((resolve) => {
        const checkVideo = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            resolve();
          } else {
            setTimeout(checkVideo, 100);
          }
        };
        checkVideo();
      });

      // 処理済みストリームを取得
      const stream = canvas.captureStream(30); // 30fps
      setProcessedStream(stream);

      // 処理ループ
      const processFrame = async () => {
        if (!videoRef.current || !canvasRef.current || !segmenterRef.current) {
          return;
        }

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        try {
          // セグメンテーション実行
          const segmentation = await segmenterRef.current.segmentPeople(video);

          if (segmentation.length > 0) {
            // 人物マスクを取得
            const mask = await bodySegmentation.toBinaryMask(
              segmentation,
              { r: 0, g: 0, b: 0, a: 0 },
              { r: 0, g: 0, b: 0, a: 255 }
            );

            // 背景効果を適用
            if (backgroundEffect === 'blur') {
              // 背景ぼかし
              await bodySegmentation.drawBokehEffect(
                canvas,
                video,
                segmentation,
                5, // foregroundThreshold
                15, // backgroundBlurAmount
                5 // edgeBlurAmount
              );
            } else if (backgroundEffect === 'image' && backgroundImageRef.current) {
              // 背景画像置き換え
              ctx.save();

              // 背景画像を描画
              ctx.drawImage(backgroundImageRef.current, 0, 0, canvas.width, canvas.height);

              // 人物マスクを使って人物部分だけを元映像から描画
              ctx.globalCompositeOperation = 'source-over';

              // 一時Canvasで人物だけを抽出
              const tempCanvas = document.createElement('canvas');
              tempCanvas.width = canvas.width;
              tempCanvas.height = canvas.height;
              const tempCtx = tempCanvas.getContext('2d');
              if (tempCtx) {
                tempCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
                // マスクを使って人物だけを抽出
                const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
                for (let i = 0; i < imageData.data.length; i += 4) {
                  const maskValue = mask.data[i + 3];
                  if (maskValue === 0) {
                    imageData.data[i + 3] = 0; // 背景部分を透明に
                  }
                }
                tempCtx.putImageData(imageData, 0, 0);
                ctx.drawImage(tempCanvas, 0, 0);
              }

              ctx.restore();
            } else {
              // 効果なし（元の映像）
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            }
          } else {
            // 人物が検出されない場合は元の映像
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
        } catch (error) {
          console.error('フレーム処理エラー:', error);
          // エラー時は元の映像を表示
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
        }

        // 次のフレーム
        animationFrameRef.current = requestAnimationFrame(processFrame);
      };

      // 処理開始
      processFrame();

      console.log('✅ 背景処理開始');
    } catch (error) {
      console.error('❌ 背景処理開始失敗:', error);
      setIsProcessing(false);
    }
  }, [sourceStream, isProcessing, backgroundEffect, initializeSegmentation]);

  /**
   * 背景処理を停止
   */
  const stopProcessing = useCallback(() => {
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
    console.log('🛑 背景処理停止');
  }, [processedStream]);

  /**
   * 背景効果を設定
   */
  const setEffect = useCallback(async (effect: BackgroundEffect, imageUrl?: string) => {
    setBackgroundEffect(effect);

    // 背景画像を設定
    if (effect === 'image' && imageUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        backgroundImageRef.current = img;
        console.log('✅ 背景画像読み込み完了');
      };
      img.onerror = () => {
        console.error('❌ 背景画像読み込み失敗');
      };
      img.src = imageUrl;
      setBackgroundImage(imageUrl);
    } else {
      backgroundImageRef.current = null;
      setBackgroundImage(null);
    }

    // 処理を再起動
    if (effect !== 'none' && sourceStream) {
      stopProcessing();
      await startProcessing();
    } else if (effect === 'none') {
      stopProcessing();
    }
  }, [sourceStream, startProcessing, stopProcessing]);

  /**
   * ソースストリームが変更されたときの処理
   */
  useEffect(() => {
    if (backgroundEffect !== 'none' && sourceStream) {
      stopProcessing();
      startProcessing();
    }
  }, [sourceStream, backgroundEffect]);

  /**
   * クリーンアップ
   */
  useEffect(() => {
    return () => {
      stopProcessing();
      if (segmenterRef.current) {
        segmenterRef.current.dispose();
        segmenterRef.current = null;
      }
    };
  }, []);

  return {
    backgroundEffect,
    setEffect,
    processedStream: backgroundEffect !== 'none' ? processedStream : null,
    isProcessing,
    backgroundImage,
  };
}
