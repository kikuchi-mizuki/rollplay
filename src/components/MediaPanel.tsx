import { Play } from 'lucide-react';
import { RecordingState } from '../types';
import { CameraPip } from './CameraPip';
import { useState, useEffect, memo } from 'react';

/**
 * メディアパネルコンポーネント（映像プレビュー領域）
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
 * @param backgroundMode - 背景モード（オプション）
 * @param blurIntensity - ぼかし強度（オプション）
 * @param onBackgroundModeChange - 背景モード変更時のコールバック（オプション）
 * @param onBlurIntensityChange - ぼかし強度変更時のコールバック（オプション）
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
  backgroundMode?: 'none' | 'blur'; // 背景モード
  blurIntensity?: number; // ぼかし強度
  onBackgroundModeChange?: (mode: 'none' | 'blur') => void;
  onBlurIntensityChange?: (intensity: number) => void;
  onBlurredStreamReady?: (stream: MediaStream | null) => void; // 背景ぼかし済みストリームを親に通知
}

const MediaPanelComponent = ({
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
  backgroundMode, // 背景モード
  blurIntensity, // ぼかし強度
  onBackgroundModeChange,
  onBlurIntensityChange,
  onBlurredStreamReady,
}: MediaPanelProps) => {
  // 字幕を文単位で分割して順次表示
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [sentences, setSentences] = useState<string[]>([]);

  // 文単位で分割する関数
  const splitIntoSentences = (text: string): string[] => {
    if (!text) return [];
    // 句点・感嘆符・疑問符で分割（ただし、後ろに文字が続く場合は分割しない）
    const parts = text.split(/([。！？])/);
    const sentences: string[] = [];

    for (let i = 0; i < parts.length; i += 2) {
      const sentence = parts[i] + (parts[i + 1] || '');
      if (sentence.trim()) {
        sentences.push(sentence.trim());
      }
    }

    return sentences.length > 0 ? sentences : [text];
  };

  // subtitleが変更されたら文を分割
  useEffect(() => {
    if (subtitle) {
      const newSentences = splitIntoSentences(subtitle);
      setSentences(newSentences);
      setCurrentSentenceIndex(0);
    } else {
      setSentences([]);
      setCurrentSentenceIndex(0);
    }
  }, [subtitle]);

  // 2秒ごとに次の文を表示
  useEffect(() => {
    if (sentences.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentSentenceIndex((prev) => {
        if (prev >= sentences.length - 1) {
          return 0; // 最後まで表示したら最初に戻る
        }
        return prev + 1;
      });
    }, 2000); // 2秒ごと

    return () => clearInterval(interval);
  }, [sentences]);

  // 現在表示する字幕
  const displayedSubtitle = sentences.length > 0 ? sentences[currentSentenceIndex] : subtitle;

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

        {/* 字幕（1〜2行表示、文単位で自動切り替え） - z-30で最前面に表示 */}
        {displayedSubtitle && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white px-4 py-3 text-sm text-center backdrop-blur-sm z-30">
            <div className="line-clamp-2 transition-all duration-300">
              {displayedSubtitle}
            </div>
          </div>
        )}

        {/* カメラPinP（右下） - 背景ぼかし機能付き - カメラON時は常に表示 */}
        {isCameraActive && cameraVideoRef && (
          <CameraPip
            cameraVideoRef={cameraVideoRef}
            cameraStream={cameraStream}
            isRecording={isVideoRecording}
            recordingTime={videoRecordingTime}
            backgroundMode={backgroundMode}
            blurIntensity={blurIntensity}
            onBackgroundModeChange={onBackgroundModeChange}
            onBlurIntensityChange={onBlurIntensityChange}
            onBlurredStreamReady={onBlurredStreamReady}
            hasSubtitle={!!subtitle}
          />
        )}

        {/* Phase 2: 画面共有時のPinP表示（アバター） - 右下配置（字幕がある場合は上にずらす） */}
        {isScreenSharing && imageSrc && (
          <div className={`absolute right-48 w-24 h-24 bg-black rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-10 ${
            subtitle ? 'bottom-16' : 'bottom-4'
          }`}>
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
};

// React.memoでラップして不要な再レンダリングを防止
export const MediaPanel = memo(MediaPanelComponent);

