import { Video } from 'lucide-react';

/**
 * カメラPinP（Picture-in-Picture）コンポーネント
 *
 * Phase 2 Day 2: カメラ映像を右下に小窓で表示
 *
 * @param cameraVideoRef - カメラプレビュー用のvideoRef
 * @param isRecording - 録画中かどうか（オプション）
 * @param recordingTime - 録画時間（秒）（オプション）
 */
interface CameraPipProps {
  cameraVideoRef: React.RefObject<HTMLVideoElement>;
  isRecording?: boolean;
  recordingTime?: number;
}

export function CameraPip({
  cameraVideoRef,
  isRecording = false,
  recordingTime = 0,
}: CameraPipProps) {
  /**
   * 録画時間をMM:SS形式にフォーマット
   */
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="absolute bottom-4 right-4 w-80 h-60 bg-black rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl z-20 transition-all duration-300 hover:scale-105 hover:shadow-3xl">
      {/* カメラ映像 */}
      <video
        ref={cameraVideoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover"
        aria-label="カメラプレビュー"
      />

      {/* 録画中インジケーター */}
      {isRecording && (
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-500/90 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg shadow-lg animate-pulse">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-sm font-medium">REC {formatTime(recordingTime)}</span>
        </div>
      )}

      {/* カメララベル */}
      {!isRecording && (
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg shadow-lg">
          <Video size={14} />
          <span className="text-xs font-medium">Camera</span>
        </div>
      )}

      {/* グラデーションオーバーレイ（視覚的な深み） */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}
