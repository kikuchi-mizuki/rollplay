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
  onBlurredStreamReady?: (stream: MediaStream | null) => void; // 背景ぼかし済みストリームを親に通知
  hasSubtitle?: boolean; // 字幕がある場合、PinPを上にずらす
}

type BackgroundMode = 'none' | 'blur';

export function CameraPip({
  cameraVideoRef: _cameraVideoRef, // 親から渡されるが、内部では独自のrefを使用
  cameraStream,
  isRecording = false,
  recordingTime = 0,
  isFullscreen = false,
  backgroundMode: externalBackgroundMode,
  blurIntensity: externalBlurIntensity,
  onBackgroundModeChange,
  onBlurIntensityChange,
  onBlurredStreamReady,
  hasSubtitle = false,
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
  // 表示用の独自video ref（refの競合を避けるため）
  const displayVideoRef = useRef<HTMLVideoElement>(null);

  // カメラストリームを内部video要素と表示用video要素にコピー
  useEffect(() => {
    console.log('[CameraPip] useEffect triggered', {
      hasStream: !!cameraStream,
      backgroundMode,
      isFullscreen,
      hasInternalRef: !!internalVideoRef.current,
      hasDisplayRef: !!displayVideoRef.current
    });

    const copyStream = async () => {
      if (cameraStream) {
        console.log('[CameraPip] Stream available, setting up video elements');

        // 内部video要素（セグメンテーション処理用）
        if (internalVideoRef.current) {
          console.log('[CameraPip] Copying stream to internal video');
          internalVideoRef.current.srcObject = cameraStream;

          // video要素の再生を確実に開始
          try {
            await internalVideoRef.current.play();
            console.log('[CameraPip] Internal video started playing');

            // loadedmetadataイベントを待つ（video要素が完全に準備できるまで）
            await new Promise<void>((resolve) => {
              if (internalVideoRef.current && internalVideoRef.current.readyState >= 2) {
                console.log('[CameraPip] Internal video already loaded');
                resolve();
              } else if (internalVideoRef.current) {
                internalVideoRef.current.addEventListener('loadedmetadata', () => {
                  console.log('[CameraPip] Internal video metadata loaded');
                  resolve();
                }, { once: true });
              }
            });

            // デバッグ: video要素の状態を確認
            console.log('[CameraPip] Internal video state:', {
              readyState: internalVideoRef.current.readyState,
              videoWidth: internalVideoRef.current.videoWidth,
              videoHeight: internalVideoRef.current.videoHeight,
              paused: internalVideoRef.current.paused,
              ended: internalVideoRef.current.ended
            });
          } catch (error) {
            console.error('[CameraPip] Failed to play internal video:', error);
          }
        } else {
          console.warn('[CameraPip] internalVideoRef.current is null');
        }

        // 表示用video要素（backgroundMode === 'none' の場合に使用）
        if (displayVideoRef.current) {
          console.log('[CameraPip] Setting stream to display video (backgroundMode:', backgroundMode, ')');
          displayVideoRef.current.srcObject = cameraStream;
          try {
            await displayVideoRef.current.play();
            console.log('[CameraPip] Display video started playing');
            // デバッグ: video要素の状態を確認
            console.log('[CameraPip] Display video state:', {
              readyState: displayVideoRef.current.readyState,
              videoWidth: displayVideoRef.current.videoWidth,
              videoHeight: displayVideoRef.current.videoHeight,
              paused: displayVideoRef.current.paused,
              ended: displayVideoRef.current.ended,
              displayStyle: window.getComputedStyle(displayVideoRef.current).display
            });
          } catch (error) {
            console.error('[CameraPip] Failed to play display video:', error);
          }
        } else {
          console.warn('[CameraPip] displayVideoRef.current is null (backgroundMode:', backgroundMode, ')');
        }
      } else {
        console.log('[CameraPip] Stream not available yet');
      }
    };

    copyStream();
  }, [cameraStream, backgroundMode, isFullscreen]);

  // 背景セグメンテーション（人物と背景を分離）
  const { canvasRef, isReady } = useBackgroundSegmentation({
    videoRef: internalVideoRef,
    backgroundMode,
    blurIntensity,
    enabled: backgroundMode !== 'none',
  });

  // 背景ぼかし済みストリームを生成して親に通知（録画用）
  useEffect(() => {
    let clonedTracks: MediaStreamTrack[] = [];

    if (backgroundMode !== 'none' && isReady && canvasRef.current && onBlurredStreamReady) {
      console.log('[CameraPip] 背景ぼかし済みストリームを生成中...');
      try {
        // CanvasからMediaStreamを取得（30fps）
        const blurredStream = canvasRef.current.captureStream(30);

        // カメラストリームの音声トラックを追加（背景ぼかしは映像のみ）
        if (cameraStream) {
          const audioTracks = cameraStream.getAudioTracks();
          audioTracks.forEach(track => {
            const clonedTrack = track.clone();
            blurredStream.addTrack(clonedTrack);
            clonedTracks.push(clonedTrack); // クリーンアップ用に保存
          });
          console.log('[CameraPip] 背景ぼかし済みストリームに音声トラックを追加:', audioTracks.length);
        }

        onBlurredStreamReady(blurredStream);
        console.log('[CameraPip] 背景ぼかし済みストリームを親に通知');
      } catch (error) {
        console.error('[CameraPip] 背景ぼかし済みストリーム生成エラー:', error);
        onBlurredStreamReady(null);
      }
    } else if (backgroundMode === 'none' && onBlurredStreamReady) {
      // 背景ぼかしOFFの場合はnullを通知
      onBlurredStreamReady(null);
    }

    // クリーンアップ: cloneしたトラックを停止
    return () => {
      clonedTracks.forEach(track => {
        track.stop();
      });
    };
  }, [backgroundMode, isReady, canvasRef, cameraStream, onBlurredStreamReady]);

  /**
   * 録画時間をMM:SS形式にフォーマット
   */
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // フルスクリーン時とPinP時でクラスを切り替え（字幕がある場合は上にずらす）
  const containerClass = isFullscreen
    ? "h-full w-full relative bg-black/80 rounded-2xl flex items-center justify-center overflow-hidden"
    : `absolute ${hasSubtitle ? 'bottom-16' : 'bottom-4'} right-4 w-40 h-32 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-20 transition-all duration-300 hover:scale-105 hover:shadow-3xl`;

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
          opacity: 0.01,
          zIndex: -1
        }}
        aria-label="セグメンテーション処理用カメラソース"
      />

      {/* 表示用video要素（常にレンダリング、backgroundModeで表示切り替え） */}
      <video
        ref={displayVideoRef}
        autoPlay
        muted
        playsInline
        className="absolute top-0 left-0 w-full h-full object-cover transition-all duration-300"
        style={{
          display: backgroundMode === 'none' ? 'block' : 'none',
          zIndex: 10
        }}
        aria-label="カメラプレビュー"
      />

      {/* 背景モードがblur/colorの場合はセグメンテーション処理後のキャンバスを表示 */}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full object-cover transition-all duration-300"
        style={{
          display: backgroundMode !== 'none' ? 'block' : 'none',
          zIndex: 20
        }}
        aria-label="処理済みカメラプレビュー"
      />

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
            aria-label="背景設定を開く"
            aria-expanded={showSettings}
            aria-controls="camera-settings-panel"
          >
            <Palette size={14} />
          </button>
        </div>
      )}

      {/* 背景設定パネル */}
      {showSettings && !isRecording && (
        <div
          id="camera-settings-panel"
          role="dialog"
          aria-labelledby="camera-settings-title"
          className="absolute top-14 left-3 right-3 bg-black/90 backdrop-blur-md rounded-lg p-3 shadow-xl z-30 text-white"
        >
          <div className="space-y-3">
            {/* 背景モード切り替え */}
            <div>
              <label id="camera-settings-title" className="text-xs font-medium mb-2 block">背景ぼかし</label>
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
