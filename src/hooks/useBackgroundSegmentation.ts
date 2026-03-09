import { useEffect, useRef, useState } from 'react';
import * as bodyPix from '@tensorflow-models/body-pix';
import * as tf from '@tensorflow/tfjs';

/**
 * 背景セグメンテーション用カスタムフック (BodyPix版)
 *
 * TensorFlow.js BodyPixを使用して人物と背景を分離し、
 * 背景のみをぼかしたり背景色を適用したりする
 *
 * @param videoRef - ソース映像のvideoRef
 * @param backgroundMode - 背景モード: none/blur/color
 * @param blurIntensity - ぼかし強度 (px)
 * @param backgroundColor - 背景色
 * @param enabled - 有効化フラグ
 */

type BackgroundMode = 'none' | 'blur';

interface UseBackgroundSegmentationProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  backgroundMode: BackgroundMode;
  blurIntensity: number;
  enabled: boolean;
}

export function useBackgroundSegmentation({
  videoRef,
  backgroundMode,
  blurIntensity,
  enabled,
}: UseBackgroundSegmentationProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<bodyPix.BodyPix | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);

  // 処理中フラグ（フレームスキップ防止）
  const isProcessingRef = useRef(false);

  // パフォーマンス測定用
  const frameCountRef = useRef(0);
  const lastLogTimeRef = useRef(Date.now());

  // メモリリーク防止：フレームレート制限（30fps→15fps）
  const lastFrameTimeRef = useRef(0);
  const TARGET_FRAME_INTERVAL = 1000 / 15; // 15fps（メモリチャーン削減）

  // BodyPixモデルの初期化
  useEffect(() => {
    if (!enabled) {
      setIsReady(false);
      return;
    }

    let isMounted = true;

    const initializeModel = async () => {
      console.log('[BodyPix] モデル読み込み開始...');

      try {
        const model = await bodyPix.load({
          architecture: 'MobileNetV1',
          outputStride: 16,
          multiplier: 1.0, // 0.75→1.0に変更（より高精度）
          quantBytes: 4,
        });

        if (isMounted) {
          modelRef.current = model;
          setIsReady(true);
          console.log('[BodyPix] モデル読み込み完了');
        }
      } catch (error) {
        console.error('[BodyPix] モデル読み込みエラー:', error);
      }
    };

    initializeModel();

    return () => {
      isMounted = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      // メモリリーク防止：BodyPixモデルを明示的にdispose
      if (modelRef.current) {
        try {
          // BodyPixモデルはTensorFlow.jsのモデルなので、disposeメソッドを持つ
          if (typeof (modelRef.current as any).dispose === 'function') {
            (modelRef.current as any).dispose();
            console.log('[BodyPix] モデルをdisposeしました');
          }
        } catch (err) {
          console.warn('[BodyPix] モデルdisposeエラー（無視可能）:', err);
        }
        modelRef.current = null;
      }
      setIsReady(false);
    };
  }, [enabled]);

  // 映像処理ループ
  useEffect(() => {
    if (!isReady || !enabled || !videoRef.current || !modelRef.current || !canvasRef.current) {
      return;
    }

    const processFrame = async () => {
      if (!videoRef.current || !modelRef.current || !canvasRef.current) {
        return;
      }

      // 前のフレームの処理中ならスキップ
      if (isProcessingRef.current) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      // フレームレート制限（メモリチャーン削減）
      const now = performance.now();
      if (now - lastFrameTimeRef.current < TARGET_FRAME_INTERVAL) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }
      lastFrameTimeRef.current = now;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      // video要素が準備できているかチェック
      if (video.readyState < video.HAVE_CURRENT_DATA || video.videoWidth === 0) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      isProcessingRef.current = true;

      // キャンバスサイズを映像サイズに合わせる
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        console.log('[BodyPix] Canvas resized:', { width: canvas.width, height: canvas.height });
      }

      try {
        // セグメンテーションを実行（人物検出を優先）
        const segStartTime = performance.now();
        const segmentation = await modelRef.current.segmentPerson(video, {
          flipHorizontal: false,
          internalResolution: 'medium', // 速度と精度のバランス
          segmentationThreshold: 0.3, // さらに下げて検出を容易に
          maxDetections: 5,
          scoreThreshold: 0.3,
        });
        const segDuration = performance.now() - segStartTime;

        // デバッグ：人物検出の統計
        const personPixelCount = segmentation.data.filter((v: number) => v === 1).length;
        const totalPixels = segmentation.data.length;
        const personRatio = personPixelCount / totalPixels;

        // フレームカウントと定期ログ
        frameCountRef.current++;
        const now = Date.now();
        if (now - lastLogTimeRef.current >= 2000) { // 2秒ごとにログ
          // TensorFlowメモリ使用量を取得（メモリリーク監視）
          const memInfo = tf.memory();
          console.log('[BodyPix] パフォーマンス統計:', {
            fps: (frameCountRef.current / 2).toFixed(1),
            avgSegTime: segDuration.toFixed(1) + 'ms',
            personRatio: (personRatio * 100).toFixed(1) + '%',
            resolution: `${canvas.width}x${canvas.height}`,
            tfMemory: `${(memInfo.numBytes / 1024 / 1024).toFixed(1)}MB (${memInfo.numTensors} tensors)`
          });
          frameCountRef.current = 0;
          lastLogTimeRef.current = now;
        }

        if (personRatio < 0.05) {
          console.warn('[BodyPix] 人物検出率が低い:', {
            personRatio: (personRatio * 100).toFixed(2) + '%',
            personPixels: personPixelCount,
            totalPixels,
            segmentationTime: segDuration.toFixed(1) + 'ms'
          });
        }

        // 現在フレームのみ使用（時間的安定化を無効化して即座に追従）
        const currentMask = segmentation.data;

        // 背景モードに応じて処理
        if (backgroundMode === 'blur') {
          // 背景のみぼかし（エッジブレンディング付き）
          await applyBlurredBackground(ctx, video, currentMask, canvas.width, canvas.height, blurIntensity);

          // デバッグ: 描画後のcanvasの状態を確認
          if (frameCountRef.current === 0) {
            const imageData = ctx.getImageData(0, 0, Math.min(10, canvas.width), Math.min(10, canvas.height));
            console.log('[BodyPix] Canvas content check (first 10x10 pixels):', {
              hasData: imageData.data.some(v => v > 0),
              samplePixel: `rgba(${imageData.data[0]}, ${imageData.data[1]}, ${imageData.data[2]}, ${imageData.data[3]})`,
              canvasSize: `${canvas.width}x${canvas.height}`,
              canvasStyle: `display: ${canvas.style.display}, zIndex: ${canvas.style.zIndex}`
            });
          }
        } else {
          // 元の映像をそのまま描画
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
      } catch (error) {
        console.error('[BodyPix] セグメンテーションエラー:', error);
      }

      isProcessingRef.current = false;
      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    processFrame();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      // Canvas要素のクリーンアップ（メモリリーク防止）
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
        canvasRef.current = null;
        console.log('[BodyPix] Canvas要素をクリーンアップ');
      }
    };
  }, [isReady, enabled, videoRef, backgroundMode, blurIntensity]);

  return { canvasRef, isReady };
}

/**
 * 背景のみぼかしを適用（エッジブレンディング付き）
 */
async function applyBlurredBackground(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  maskData: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  blurIntensity: number
) {
  // 元画像を描画
  ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
  const originalImageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);

  // ぼかし処理を適用
  ctx.filter = `blur(${blurIntensity}px)`;
  ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
  ctx.filter = 'none';
  const blurredImageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);

  // 軽量なエッジブレンディング
  for (let i = 0; i < maskData.length; i++) {
    const pixelIndex = i * 4;
    const personValue = maskData[i]; // 0-1の値（安定化済み）

    // Smoothstep補間でスムーズなブレンド
    const blendFactor = smoothstep(personValue);

    // ブレンド適用
    blurredImageData.data[pixelIndex] =
      originalImageData.data[pixelIndex] * blendFactor +
      blurredImageData.data[pixelIndex] * (1 - blendFactor);
    blurredImageData.data[pixelIndex + 1] =
      originalImageData.data[pixelIndex + 1] * blendFactor +
      blurredImageData.data[pixelIndex + 1] * (1 - blendFactor);
    blurredImageData.data[pixelIndex + 2] =
      originalImageData.data[pixelIndex + 2] * blendFactor +
      blurredImageData.data[pixelIndex + 2] * (1 - blendFactor);
  }

  ctx.putImageData(blurredImageData, 0, 0);
}

/**
 * Smoothstep関数：滑らかな補間
 */
function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
