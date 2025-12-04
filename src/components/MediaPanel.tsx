import { Play } from 'lucide-react';
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
      <div className="flex-1 relative bg-black/80 rounded-t-2xl flex items-center justify-center pb-2 md:pb-0">
        {videoSrc ? (
          <video
            src={videoSrc}
            className="w-full h-full object-contain"
            style={{ objectPosition: 'center' }}
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
            alt="AI相談者のアバター"
            className="max-w-full max-h-full object-contain transition-all duration-500 ease-in-out animate-fadeIn hover:scale-105"
            style={{
              animation: 'fadeIn 0.5s ease-in-out, breathe 3s ease-in-out infinite',
              objectPosition: 'center',
              margin: 'auto',
              display: 'block'
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 animate-floatIn">
            <Play size={48} className="text-slate-400 opacity-70" />
            <p className="text-slate-400 text-sm tracking-wide">メディアがありません</p>
          </div>
        )}

        {/* 字幕 */}
        {subtitle && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white px-4 py-3 text-sm text-center line-clamp-2">
            {subtitle}
          </div>
        )}

        {/* 録音中オーバーレイ */}
        {renderWaveform()}
      </div>
    </div>
  );
}

