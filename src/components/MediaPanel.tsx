import { Play } from 'lucide-react';
import { RecordingState } from '../types';
import { formatDuration } from '../lib/audio';
import { useEffect } from 'react';
import { CameraPip } from './CameraPip';

/**
 * メディアパネルコンポーネント（映像プレビュー領域）
 * @param isRecording - 録音中かどうか
 * @param recordingState - 録音状態（録音中の時のみ使用）
 * @param videoSrc - 動画のソースURL（オプション）
 * @param imageSrc - 画像のソースURL（オプション）
 * @param subtitle - 字幕テキスト（オプション）
 * @param cameraVideoRef - Phase 2: カメラプレビュー用のvideoRef（オプション）
 * @param isCameraActive - Phase 2: カメラがアクティブかどうか（オプション）
 * @param cameraStream - Phase 2: カメラストリーム（オプション）
 * @param screenVideoRef - Phase 2 Day 3: 画面共有用のvideoRef（オプション）
 * @param isScreenSharing - Phase 2 Day 3: 画面共有中かどうか（オプション）
 * @param isVideoRecording - Phase 2 Day 4: ビデオ録画中かどうか（オプション）
 * @param videoRecordingTime - Phase 2 Day 4: ビデオ録画時間（秒）（オプション）
 */
interface MediaPanelProps {
  isRecording?: boolean;
  recordingState?: RecordingState;
  videoSrc?: string;
  imageSrc?: string;
  subtitle?: string;
  cameraVideoRef?: React.RefObject<HTMLVideoElement>; // Phase 2
  isCameraActive?: boolean; // Phase 2
  cameraStream?: MediaStream | null; // Phase 2: カメラストリーム
  screenVideoRef?: React.RefObject<HTMLVideoElement>; // Phase 2 Day 3
  isScreenSharing?: boolean; // Phase 2 Day 3
  isVideoRecording?: boolean; // Phase 2 Day 4
  videoRecordingTime?: number; // Phase 2 Day 4
}

export function MediaPanel({
  isRecording = false,
  recordingState,
  videoSrc,
  imageSrc,
  subtitle,
  cameraVideoRef, // Phase 2
  isCameraActive = false, // Phase 2
  cameraStream = null, // Phase 2: カメラストリーム
  screenVideoRef, // Phase 2 Day 3
  isScreenSharing = false, // Phase 2 Day 3
  isVideoRecording = false, // Phase 2 Day 4
  videoRecordingTime = 0, // Phase 2 Day 4
}: MediaPanelProps) {
  // 画面共有時のカメラPinP用にsrcObjectを設定
  useEffect(() => {
    if (isScreenSharing && isCameraActive && cameraStream && cameraVideoRef?.current) {
      cameraVideoRef.current.srcObject = cameraStream;
      console.log('✅ MediaPanel: カメラPinPのsrcObject設定完了');
    }
  }, [isScreenSharing, isCameraActive, cameraStream, cameraVideoRef]);
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
      <div className={`flex-1 relative bg-black/80 rounded-t-2xl flex items-center justify-center ${isScreenSharing ? 'pb-32 md:pb-0' : 'pb-2 md:pb-0'}`}>
        {/* Phase 2 Day 3: 画面共有映像（スマホは上部配置、PCは中央配置） */}
        {isScreenSharing && screenVideoRef ? (
          <video
            ref={screenVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-contain object-top md:object-center"
            aria-label="画面共有プレビュー"
          />
        ) : videoSrc ? (
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

        {/* 字幕（2行表示、自動スクロール） */}
        {subtitle && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white px-4 py-3 text-sm text-center backdrop-blur-sm">
            <div className="line-clamp-2 transition-all duration-300">
              {subtitle}
            </div>
          </div>
        )}

        {/* 録音中オーバーレイ */}
        {renderWaveform()}

        {/* カメラPinP（右下） - 背景ぼかし機能付き - カメラON時は常に表示 */}
        {isCameraActive && cameraVideoRef && (
          <CameraPip
            cameraVideoRef={cameraVideoRef}
            cameraStream={cameraStream}
            isRecording={isVideoRecording}
            recordingTime={videoRecordingTime}
          />
        )}

        {/* Phase 2: 画面共有時のPinP表示（アバター） - 右下配置 */}
        {isScreenSharing && imageSrc && (
          <div className="absolute bottom-4 right-48 w-24 h-24 bg-black rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-10">
            <img
              src={imageSrc}
              alt="AI相談者のアバター"
              className="w-full h-full object-cover"
            />
          </div>
        )}
      </div>
    </div>
  );
}

