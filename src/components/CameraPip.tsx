import { Video, Palette } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useBackgroundSegmentation } from '../hooks/useBackgroundSegmentation';

/**
 * カメラPinP（Picture-in-Picture）コンポーネント
 *
 * Phase 2 Day 2: カメラ映像を右下に小窓で表示
 * Session 49: MediaPipeを使用して背景のみをぼかす機能を追加
 *
 * @param cameraVideoRef - カメラプレビュー用のvideoRef
 * @param cameraStream - カメラストリーム（背景セグメンテーション用）
 * @param isRecording - 録画中かどうか（オプション）
 * @param recordingTime - 録画時間（秒）（オプション）
 * @param isFullscreen - フルスクリーン表示かどうか（オプション）
 * @param backgroundMode - 背景モード（外部から制御可能）
 * @param blurIntensity - ぼかし強度（外部から制御可能）
 * @param onBackgroundModeChange - 背景モード変更時のコールバック
 * @param onBlurIntensityChange - ぼかし強度変更時のコールバック
 */
interface CameraPipProps {
  cameraVideoRef: React.RefObject<HTMLVideoElement>;
  cameraStream?: MediaStream | null;
  isRecording?: boolean;
  recordingTime?: number;
  isFullscreen?: boolean;
  backgroundMode?: BackgroundMode;
  blurIntensity?: number;
  onBackgroundModeChange?: (mode: BackgroundMode) => void;
  onBlurIntensityChange?: (intensity: number) => void;
}

type BackgroundMode = 'none' | 'blur';

export function CameraPip({
  cameraVideoRef,
  cameraStream,
  isRecording = false,
  recordingTime = 0,
  isFullscreen = false,
  backgroundMode: externalBackgroundMode,
  blurIntensity: externalBlurIntensity,
  onBackgroundModeChange,
  onBlurIntensityChange,
}: CameraPipProps) {
  // 外部から状態が渡された場合は外部状態を使用、そうでない場合は内部状態を使用
  const [internalBackgroundMode, setInternalBackgroundMode] = useState<BackgroundMode>('none');
  const [internalBlurIntensity, setInternalBlurIntensity] = useState(15); // 5-30px
  const [showSettings, setShowSettings] = useState(false);

  const backgroundMode = externalBackgroundMode ?? internalBackgroundMode;
  const blurIntensity = externalBlurIntensity ?? internalBlurIntensity;

  const setBackgroundMode = (mode: BackgroundMode) => {
    if (onBackgroundModeChange) {
      onBackgroundModeChange(mode);
    } else {
      setInternalBackgroundMode(mode);
    }
  };

  const setBlurIntensity = (intensity: number) => {
    if (onBlurIntensityChange) {
      onBlurIntensityChange(intensity);
    } else {
      setInternalBlurIntensity(intensity);
    }
  };

  // セグメンテーション処理用の内部video ref
  const internalVideoRef = useRef<HTMLVideoElement>(null);

  // カメラストリームを内部video要素と表示用video要素にコピー
  useEffect(() => {
    const copyStream = async () => {
      if (cameraStream) {
        // 内部video要素（セグメンテーション処理用）
        if (internalVideoRef.current) {
          console.log('[CameraPip] Copying stream to internal video');
          internalVideoRef.current.srcObject = cameraStream;

          // video要素の再生を確実に開始
          try {
            await internalVideoRef.current.play();
            console.log('[CameraPip] Internal video started playing');
          } catch (error) {
            console.error('[CameraPip] Failed to play internal video:', error);
          }
        }

        // 表示用video要素（backgroundMode === 'none' の場合に使用）
        if (cameraVideoRef?.current && backgroundMode === 'none') {
          console.log('[CameraPip] Setting stream to display video (backgroundMode: none)');
          cameraVideoRef.current.srcObject = cameraStream;
          try {
            await cameraVideoRef.current.play();
            console.log('[CameraPip] Display video started playing');
          } catch (error) {
            console.error('[CameraPip] Failed to play display video:', error);
          }
        }
      } else {
        console.log('[CameraPip] Stream not available yet', {
          hasStream: !!cameraStream,
          hasInternalRef: !!internalVideoRef.current,
          hasDisplayRef: !!cameraVideoRef?.current
        });
      }
    };

    copyStream();
  }, [cameraStream, cameraVideoRef, backgroundMode]);

  // 背景セグメンテーション（人物と背景を分離）
  const { canvasRef } = useBackgroundSegmentation({
    videoRef: internalVideoRef,
    backgroundMode,
    blurIntensity,
    enabled: backgroundMode !== 'none',
  });

  /**
   * 録画時間をMM:SS形式にフォーマット
   */
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // フルスクリーン時とPinP時でクラスを切り替え
  const containerClass = isFullscreen
    ? "h-full w-full relative bg-black/80 rounded-2xl flex items-center justify-center overflow-hidden"
    : "absolute bottom-4 right-4 w-40 h-30 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-20 transition-all duration-300 hover:scale-105 hover:shadow-3xl";

  return (
    <div className={containerClass}>
      {/* セグメンテーション処理用の内部video要素（非表示だがレンダリングは必要） */}
      <video
        ref={internalVideoRef}
        autoPlay
        muted
        playsInline
        className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none"
        style={{
          opacity: 0,
          zIndex: -1
        }}
        aria-label="セグメンテーション処理用カメラソース"
      />

      {/* 背景モードがnoneの場合は元の映像を表示 */}
      {backgroundMode === 'none' && (
        <video
          ref={cameraVideoRef}
          autoPlay
          muted
          playsInline
          className="relative z-10 w-full h-full object-cover transition-all duration-300"
          aria-label="カメラプレビュー"
        />
      )}

      {/* 背景モードがblur/colorの場合はセグメンテーション処理後のキャンバスを表示 */}
      {backgroundMode !== 'none' && (
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full object-cover transition-all duration-300"
          style={{ zIndex: 5 }}
          aria-label="処理済みカメラプレビュー"
        />
      )}

      {/* 録画中インジケーター */}
      {isRecording && (
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-500/90 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg shadow-lg animate-pulse">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-sm font-medium">REC {formatTime(recordingTime)}</span>
        </div>
      )}

      {/* カメララベルと設定ボタン */}
      {!isRecording && (
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 z-20">
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg shadow-lg">
            <Video size={14} />
            <span className="text-xs font-medium">Camera</span>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="bg-black/60 backdrop-blur-sm text-white p-1.5 rounded-lg shadow-lg hover:bg-black/80 transition-colors"
            aria-label="背景設定"
          >
            <Palette size={14} />
          </button>
        </div>
      )}

      {/* 背景設定パネル */}
      {showSettings && !isRecording && (
        <div className="absolute top-14 left-3 right-3 bg-black/90 backdrop-blur-md rounded-lg p-3 shadow-xl z-30 text-white">
          <div className="space-y-3">
            {/* 背景モード切り替え */}
            <div>
              <label className="text-xs font-medium mb-2 block">背景ぼかし</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setBackgroundMode('none')}
                  className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                    backgroundMode === 'none'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  OFF
                </button>
                <button
                  onClick={() => setBackgroundMode('blur')}
                  className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                    backgroundMode === 'blur'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  ON
                </button>
              </div>
            </div>

            {/* ぼかし強度（ぼかしON時のみ） */}
            {backgroundMode === 'blur' && (
              <div>
                <label className="text-xs font-medium mb-1 block">
                  ぼかし強度: {blurIntensity}px
                </label>
                <input
                  type="range"
                  min="5"
                  max="30"
                  value={blurIntensity}
                  onChange={(e) => setBlurIntensity(Number(e.target.value))}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-purple-600"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* グラデーションオーバーレイ（視覚的な深み） */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent pointer-events-none z-10" />
    </div>
  );
}
