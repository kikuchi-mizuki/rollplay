import { Play, Volume2 } from 'lucide-react';
import { RecordingState } from '../types';
import { formatDuration } from '../lib/audio';

/**
 * メディアパネルコンポーネント（映像プレビュー領域）
 * @param isRecording - 録音中かどうか
 * @param recordingState - 録音状態（録音中の時のみ使用）
 * @param videoSrc - 動画のソースURL（オプション）
 * @param imageSrc - 画像のソースURL（オプション）
 * @param subtitle - 字幕テキスト（オプション）
 */
interface MediaPanelProps {
  isRecording?: boolean;
  recordingState?: RecordingState;
  videoSrc?: string;
  imageSrc?: string;
  subtitle?: string;
}

export function MediaPanel({
  isRecording = false,
  recordingState,
  videoSrc,
  imageSrc,
  subtitle,
}: MediaPanelProps) {
  // 録音中の波形バーを生成
  const renderWaveform = () => {
    if (!isRecording || !recordingState) return null;

    return (
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-2xl">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-2">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="wave-bar w-1 bg-primary rounded-full"
                style={{
                  height: `${20 + recordingState.level * 0.3}%`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
        </div>
        <div className="text-white text-lg font-medium">
          {formatDuration(recordingState.duration)}
        </div>
        <p className="text-white/80 text-sm mt-2">録音中...</p>
      </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      {/* メディアコンテンツ */}
      <div className="flex-1 relative aspect-[16/9] bg-black/80 rounded-t-2xl flex items-center justify-center md:aspect-video pb-2 md:pb-0">
        {videoSrc ? (
          <video
            src={videoSrc}
            className="w-full h-full object-contain"
            controls={false}
            muted
            playsInline
            loop
            autoPlay
            aria-label="プレビュー映像"
          />
        ) : imageSrc ? (
          <img
            src={imageSrc}
            alt="プレビュー画像"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 animate-floatIn">
            <Play size={48} className="text-slate-400 opacity-70" />
            <p className="text-slate-400 text-sm tracking-wide">メディアがありません</p>
          </div>
        )}

        {/* 字幕 */}
        {subtitle && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white px-4 py-3 text-sm text-center">
            {subtitle}
          </div>
        )}

        {/* 録音中オーバーレイ */}
        {renderWaveform()}
      </div>

      {/* 下部のコントロール（将来拡張用） */}
      <div className="hidden md:flex items-center justify-center gap-2 p-2 bg-black/50 border-t border-white/10">
        <button
          className="btn-icon text-white hover:bg-white/20"
          aria-label="再生/一時停止"
        >
          <Play size={16} />
        </button>
        <button
          className="btn-icon text-white hover:bg-white/20"
          aria-label="音量調整"
        >
          <Volume2 size={16} />
        </button>
      </div>
    </div>
  );
}

