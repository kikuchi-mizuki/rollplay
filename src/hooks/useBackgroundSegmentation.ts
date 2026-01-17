import { useEffect, useRef, useState } from 'react';

// グローバル変数として登録されたSelfieSegmentationにアクセス
declare global {
  interface Window {
    SelfieSegmentation: any;
  }
}

// MediaPipeライブラリを動的に読み込む
async function loadMediaPipe() {
  if (!window.SelfieSegmentation) {
    await import('@mediapipe/selfie_segmentation');
  }
}

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
  const segmentationRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);

  // MediaPipeの初期化
  useEffect(() => {
    if (!enabled) {
      setIsReady(false);
      return;
    }

    let segmenter: any = null;

    const initializeSegmenter = async () => {
      console.log('[BackgroundSegmentation] 初期化開始');

      // MediaPipeライブラリを読み込む
      await loadMediaPipe();
      console.log('[BackgroundSegmentation] loadMediaPipe完了');

      // ライブラリが読み込まれるまで少し待つ
      await new Promise(resolve => setTimeout(resolve, 100));

      if (!window.SelfieSegmentation) {
        console.error('[BackgroundSegmentation] MediaPipe SelfieSegmentation not loaded');
        return;
      }

      console.log('[BackgroundSegmentation] SelfieSegmentationインスタンス作成');
      segmenter = new window.SelfieSegmentation({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${file}`;
        },
      });

      console.log('[BackgroundSegmentation] setOptions設定');
      segmenter.setOptions({
        modelSelection: 1, // 0: 一般モデル, 1: ランドスケープモデル（高精度）
        selfieMode: true,
      });

      console.log('[BackgroundSegmentation] onResults登録');
      segmenter.onResults((results: any) => {
        console.log('[BackgroundSegmentation] onResults呼び出し');
        if (!canvasRef.current || !videoRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // キャンバスサイズを映像サイズに合わせる
        canvas.width = results.image.width;
        canvas.height = results.image.height;
        console.log('[BackgroundSegmentation] Canvas描画:', canvas.width, 'x', canvas.height);

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

      segmentationRef.current = segmenter;
      console.log('[BackgroundSegmentation] 初期化完了、isReadyをtrueに設定');
      setIsReady(true);
    };

    initializeSegmenter();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (segmenter) {
        segmenter.close();
      }
      segmentationRef.current = null;
      setIsReady(false);
    };
  }, [enabled, backgroundMode, blurIntensity, backgroundColor]);

  // 映像処理ループ
  useEffect(() => {
    console.log('[BackgroundSegmentation] 映像処理ループ useEffect', {
      isReady,
      enabled,
      hasVideo: !!videoRef.current,
      hasSegmenter: !!segmentationRef.current,
    });

    if (!isReady || !enabled || !videoRef.current || !segmentationRef.current) {
      return;
    }

    const video = videoRef.current;

    // video要素のメタデータが読み込まれるまで待つ
    const startProcessing = () => {
      console.log('[BackgroundSegmentation] 映像処理ループ開始');

      const processFrame = async () => {
        if (!videoRef.current || !segmentationRef.current) {
          console.log('[BackgroundSegmentation] refs not available, stopping');
          return;
        }

        const video = videoRef.current;

        // video要素のサイズが有効かチェック
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          console.log('[BackgroundSegmentation] Video size is 0, retrying...', {
            width: video.videoWidth,
            height: video.videoHeight,
            readyState: video.readyState
          });
          animationFrameRef.current = requestAnimationFrame(processFrame);
          return;
        }

        // video要素が再生中かチェック
        if (video.readyState < video.HAVE_CURRENT_DATA) {
          console.log('[BackgroundSegmentation] Video not ready, retrying...', {
            readyState: video.readyState,
            required: video.HAVE_CURRENT_DATA
          });
          animationFrameRef.current = requestAnimationFrame(processFrame);
          return;
        }

        try {
          console.log('[BackgroundSegmentation] Sending frame to MediaPipe', {
            width: video.videoWidth,
            height: video.videoHeight
          });
          await segmentationRef.current.send({ image: video });
        } catch (error) {
          console.error('[BackgroundSegmentation] Segmentation error:', error);
        }

        animationFrameRef.current = requestAnimationFrame(processFrame);
      };

      processFrame();
    };

    console.log('[BackgroundSegmentation] Checking video readiness', {
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      srcObject: !!video.srcObject
    });

    // メタデータが既に読み込まれている場合は即座に開始
    if (video.readyState >= video.HAVE_METADATA && video.videoWidth > 0) {
      console.log('[BackgroundSegmentation] Video ready immediately, starting processing');
      startProcessing();
    } else {
      // メタデータの読み込みを待つ
      const onLoadedMetadata = () => {
        console.log('[BackgroundSegmentation] Video metadata loaded event fired', {
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight
        });
        startProcessing();
      };

      console.log('[BackgroundSegmentation] Waiting for video metadata...');
      video.addEventListener('loadedmetadata', onLoadedMetadata);

      return () => {
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }

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
