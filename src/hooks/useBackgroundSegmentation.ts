import { useEffect, useRef, useState } from 'react';
import * as bodyPix from '@tensorflow-models/body-pix';
import '@tensorflow/tfjs';

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

type BackgroundMode = 'none' | 'blur' | 'color';

interface UseBackgroundSegmentationProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  backgroundMode: BackgroundMode;
  blurIntensity: number;
  backgroundColor: string;
  enabled: boolean;
}

export function useBackgroundSegmentation({
  videoRef,
  backgroundMode,
  blurIntensity,
  backgroundColor,
  enabled,
}: UseBackgroundSegmentationProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<bodyPix.BodyPix | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);

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
          multiplier: 0.75,
          quantBytes: 2,
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
      modelRef.current = null;
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

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // video要素が準備できているかチェック
      if (video.readyState < video.HAVE_CURRENT_DATA || video.videoWidth === 0) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      // キャンバスサイズを映像サイズに合わせる
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      try {
        // セグメンテーションを実行
        const segmentation = await modelRef.current.segmentPerson(video, {
          flipHorizontal: false,
          internalResolution: 'medium',
          segmentationThreshold: 0.7,
        });

        // 背景モードに応じて処理
        if (backgroundMode === 'blur') {
          // 背景のみぼかし
          await applyBlurredBackground(ctx, video, segmentation, blurIntensity);
        } else if (backgroundMode === 'color') {
          // 背景色を適用
          await applyColorBackground(ctx, video, segmentation, backgroundColor);
        } else {
          // 元の映像をそのまま描画
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
      } catch (error) {
        console.error('[BodyPix] セグメンテーションエラー:', error);
      }

      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    processFrame();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isReady, enabled, videoRef, backgroundMode, blurIntensity, backgroundColor]);

  return { canvasRef, isReady };
}

/**
 * 背景のみぼかしを適用
 */
async function applyBlurredBackground(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  segmentation: bodyPix.SemanticPersonSegmentation,
  blurIntensity: number
) {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;

  // 元画像を描画
  ctx.drawImage(video, 0, 0, width, height);
  const originalImageData = ctx.getImageData(0, 0, width, height);

  // ぼかし処理を適用
  ctx.filter = `blur(${blurIntensity}px)`;
  ctx.drawImage(video, 0, 0, width, height);
  ctx.filter = 'none';
  const blurredImageData = ctx.getImageData(0, 0, width, height);

  // マスクを使って人物部分のみ元画像を復元
  const maskData = segmentation.data;
  for (let i = 0; i < maskData.length; i++) {
    const pixelIndex = i * 4;
    if (maskData[i] === 1) {
      // 人物部分は元画像を使用
      blurredImageData.data[pixelIndex] = originalImageData.data[pixelIndex];
      blurredImageData.data[pixelIndex + 1] = originalImageData.data[pixelIndex + 1];
      blurredImageData.data[pixelIndex + 2] = originalImageData.data[pixelIndex + 2];
      blurredImageData.data[pixelIndex + 3] = originalImageData.data[pixelIndex + 3];
    }
  }

  ctx.putImageData(blurredImageData, 0, 0);
}

/**
 * 背景に色を適用
 */
async function applyColorBackground(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  segmentation: bodyPix.SemanticPersonSegmentation,
  backgroundColor: string
) {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;

  // 背景色で塗りつぶし
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // 元画像を取得
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;

  tempCtx.drawImage(video, 0, 0, width, height);
  const imageData = tempCtx.getImageData(0, 0, width, height);

  // マスクを使って人物部分のみ抽出
  const maskData = segmentation.data;
  for (let i = 0; i < maskData.length; i++) {
    const pixelIndex = i * 4;
    if (maskData[i] === 0) {
      // 背景部分は透明
      imageData.data[pixelIndex + 3] = 0;
    }
  }

  // 人物部分を上に重ねる
  tempCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(tempCanvas, 0, 0, width, height);
}
