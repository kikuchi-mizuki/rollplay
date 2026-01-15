import { Video, Palette } from 'lucide-react';
import { useState } from 'react';

/**
 * カメラPinP（Picture-in-Picture）コンポーネント
 *
 * Phase 2 Day 2: カメラ映像を右下に小窓で表示
 *
 * @param cameraVideoRef - カメラプレビュー用のvideoRef
 * @param isRecording - 録画中かどうか（オプション）
 * @param recordingTime - 録画時間（秒）（オプション）
 * @param isFullscreen - フルスクリーン表示かどうか（オプション）
 */
interface CameraPipProps {
  cameraVideoRef: React.RefObject<HTMLVideoElement>;
  isRecording?: boolean;
  recordingTime?: number;
  isFullscreen?: boolean;
}

type BackgroundMode = 'none' | 'blur' | 'color';

const BACKGROUND_COLORS = [
  { name: 'グレー', value: '#1a1a2e' },
  { name: 'ブルー', value: '#0f4c75' },
  { name: 'グリーン', value: '#16213e' },
  { name: 'パープル', value: '#2d1b69' },
  { name: 'ホワイト', value: '#f0f0f0' },
];

export function CameraPip({
  cameraVideoRef,
  isRecording = false,
  recordingTime = 0,
  isFullscreen = false,
}: CameraPipProps) {
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('none');
  const [selectedColor, setSelectedColor] = useState(BACKGROUND_COLORS[0].value);
  const [showSettings, setShowSettings] = useState(false);
  const [blurIntensity, setBlurIntensity] = useState(15); // 5-30px

  /**
   * 録画時間をMM:SS形式にフォーマット
   */
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  /**
   * 背景モードに応じたスタイルを取得
   */
  const getVideoStyle = (): React.CSSProperties => {
    if (backgroundMode === 'blur') {
      return {
        filter: `blur(${blurIntensity}px) brightness(0.9)`,
      };
    }
    return {};
  };

  const getBackgroundStyle = (): React.CSSProperties => {
    if (backgroundMode === 'color') {
      return {
        backgroundColor: selectedColor,
      };
    }
    return {};
  };

  // フルスクリーン時とPinP時でクラスを切り替え
  const containerClass = isFullscreen
    ? "h-full w-full relative bg-black/80 rounded-2xl flex items-center justify-center overflow-hidden"
    : "absolute bottom-4 right-4 w-40 h-30 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-20 transition-all duration-300 hover:scale-105 hover:shadow-3xl";

  return (
    <div className={containerClass}
      style={getBackgroundStyle()}
    >
      {/* 背景色モードの場合、ぼかした映像を後ろに表示 */}
      {backgroundMode === 'color' && (
        <div className="absolute inset-0" style={{ backgroundColor: selectedColor }} />
      )}

      {/* カメラ映像 */}
      <video
        ref={cameraVideoRef}
        autoPlay
        muted
        playsInline
        className="relative z-10 w-full h-full object-cover transition-all duration-300"
        style={getVideoStyle()}
        aria-label="カメラプレビュー"
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
            {/* 背景モード選択 */}
            <div>
              <label className="text-xs font-medium mb-2 block">背景モード</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setBackgroundMode('none')}
                  className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                    backgroundMode === 'none'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  なし
                </button>
                <button
                  onClick={() => setBackgroundMode('blur')}
                  className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                    backgroundMode === 'blur'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  ぼかし
                </button>
                <button
                  onClick={() => setBackgroundMode('color')}
                  className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                    backgroundMode === 'color'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  背景色
                </button>
              </div>
            </div>

            {/* ぼかし強度（ぼかしモード時のみ） */}
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

            {/* 背景色選択（背景色モード時のみ） */}
            {backgroundMode === 'color' && (
              <div>
                <label className="text-xs font-medium mb-2 block">背景色</label>
                <div className="grid grid-cols-5 gap-2">
                  {BACKGROUND_COLORS.map((color) => (
                    <button
                      key={color.value}
                      onClick={() => setSelectedColor(color.value)}
                      className={`w-full aspect-square rounded border-2 transition-all ${
                        selectedColor === color.value
                          ? 'border-purple-400 scale-110'
                          : 'border-white/20 hover:border-white/40'
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={color.name}
                      aria-label={color.name}
                    />
                  ))}
                </div>
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
