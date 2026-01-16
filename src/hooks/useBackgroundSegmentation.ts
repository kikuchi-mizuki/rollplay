import { useEffect, useRef, useState } from 'react';
import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';

/**
 * 背景セグメンテーション用カスタムフック
 *
 * MediaPipe Selfie Segmentationを使用して人物と背景を分離し、
 * 背景のみをぼかしたり背景色を適用したりする
 *
 * @param videoRef - ソース映像のvideoRef
 * @param backgroundMode - 背景モード: none/blur/color
 * @param blurIntensity - ぼかし強度 (px)
 * @param backgroundColor - 背景色
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
  const segmentationRef = useRef<SelfieSegmentation | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);

  // MediaPipeの初期化
  useEffect(() => {
    if (!enabled) {
      setIsReady(false);
      return;
    }

    const selfieSegmentation = new SelfieSegmentation({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
      },
    });

    selfieSegmentation.setOptions({
      modelSelection: 1, // 0: 一般モデル, 1: ランドスケープモデル（高精度）
      selfieMode: true,
    });

    selfieSegmentation.onResults((results) => {
      if (!canvasRef.current || !videoRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // キャンバスサイズを映像サイズに合わせる
      canvas.width = results.image.width;
      canvas.height = results.image.height;

      // 背景モードに応じて処理
      if (backgroundMode === 'none') {
        // 何もしない - 元の映像をそのまま描画
        ctx.drawImage(results.image as unknown as HTMLVideoElement, 0, 0, canvas.width, canvas.height);
      } else if (backgroundMode === 'blur') {
        // 背景のみぼかし
        applyBlurredBackground(
          ctx,
          results.image as unknown as HTMLVideoElement,
          results.segmentationMask as unknown as ImageData,
          blurIntensity
        );
      } else if (backgroundMode === 'color') {
        // 背景色を適用
        applyColorBackground(
          ctx,
          results.image as unknown as HTMLVideoElement,
          results.segmentationMask as unknown as ImageData,
          backgroundColor
        );
      }
    });

    segmentationRef.current = selfieSegmentation;
    setIsReady(true);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      selfieSegmentation.close();
      segmentationRef.current = null;
      setIsReady(false);
    };
  }, [enabled, backgroundMode, blurIntensity, backgroundColor]);

  // 映像処理ループ
  useEffect(() => {
    if (!isReady || !enabled || !videoRef.current || !segmentationRef.current) {
      return;
    }

    const processFrame = async () => {
      if (!videoRef.current || !segmentationRef.current) return;

      try {
        await segmentationRef.current.send({ image: videoRef.current });
      } catch (error) {
        console.error('Segmentation error:', error);
      }

      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    processFrame();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isReady, enabled, videoRef]);

  return { canvasRef, isReady };
}

/**
 * 背景のみぼかしを適用
 */
function applyBlurredBackground(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement | HTMLVideoElement,
  mask: ImageData,
  blurIntensity: number
) {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;

  // 一時キャンバスを作成して元画像をコピー
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;

  // 元画像を描画
  tempCtx.drawImage(image, 0, 0, width, height);

  // ぼかし処理を適用した背景を作成
  ctx.filter = `blur(${blurIntensity}px)`;
  ctx.drawImage(image, 0, 0, width, height);
  ctx.filter = 'none';

  // マスクを使って人物部分を上から描画
  const imageData = tempCtx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const maskData = mask.data;

  for (let i = 0; i < maskData.length; i += 4) {
    const alpha = maskData[i] / 255; // 人物の確率 (0-1)

    if (alpha > 0.1) { // 人物部分のみ描画
      pixels[i + 3] = 255 * alpha; // アルファ値を設定
    } else {
      pixels[i + 3] = 0; // 背景部分は透明
    }
  }

  // 人物部分を上に重ねる
  tempCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(tempCanvas, 0, 0, width, height);
}

/**
 * 背景に色を適用
 */
function applyColorBackground(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement | HTMLVideoElement,
  mask: ImageData,
  backgroundColor: string
) {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;

  // 背景色で塗りつぶし
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // 一時キャンバスに元画像をコピー
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;

  tempCtx.drawImage(image, 0, 0, width, height);

  // マスクを使って人物部分のみ抽出
  const imageData = tempCtx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const maskData = mask.data;

  for (let i = 0; i < maskData.length; i += 4) {
    const alpha = maskData[i] / 255; // 人物の確率 (0-1)

    if (alpha < 0.1) {
      // 背景部分は透明
      pixels[i + 3] = 0;
    } else {
      // 人物部分はアルファ値を設定
      pixels[i + 3] = 255 * alpha;
    }
  }

  // 人物部分を上に重ねる
  tempCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(tempCanvas, 0, 0, width, height);
}
