import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Mic, Send, MessageSquare, Trash2, Loader2 } from 'lucide-react';
import { RecordingState } from '../types';
import { formatDuration } from '../lib/audio';

/**
 * コンポーザー（入力エリア）コンポーネント
 * @param onSend - 送信時のコールバック（テキストを渡す）
 * @param isRecording - VADモード中の録音中かどうか
 * @param recordingState - 録音状態
 * @param isSending - 送信中かどうか
 * @param onClear - 会話をクリアするコールバック
 * @param onShowEvaluation - 講評を表示するコールバック
 * @param onToggleVAD - 会話モードのトグル
 * @param isVADMode - 会話モード中かどうか
 */
interface ComposerProps {
  onSend: (text: string) => void;
  isRecording: boolean;
  recordingState?: RecordingState;
  isSending?: boolean;
  onClear: () => void;
  onShowEvaluation: () => void;
  isLoadingEvaluation?: boolean;
  onToggleVAD: () => void;
  isVADMode: boolean;
}

export function Composer({
  onSend,
  isRecording,
  recordingState,
  isSending = false,
  onClear,
  onShowEvaluation,
  isLoadingEvaluation = false,
  onToggleVAD,
  isVADMode,
}: ComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // テキストエリアの自動リサイズ（max-h-32 = 128px）
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        128 // max-h-32 = 8rem = 128px
      )}px`;
    }
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = text.trim().length > 0 && !isSending;

  return (
    <div className="w-full">
      {/* VADモード中の音声検出表示 */}
      {isVADMode && isRecording && recordingState && (
        <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-xl mb-3">
          <div className="flex items-center gap-1 flex-1">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="wave-bar w-1 bg-primary rounded-full"
                style={{
                  height: `${Math.max(20, recordingState.level * 0.5)}%`,
                  minHeight: '8px',
                  animationDelay: `${i * 0.05}s`,
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-primary">
              {formatDuration(recordingState.duration)}
            </span>
          </div>
        </div>
      )}

      {/* 入力エリア */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* 会話モードボタン（VAD） */}
        <button
          type="button"
          onClick={onToggleVAD}
          className={`btn-icon flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 ${
            isVADMode ? 'bg-danger hover:bg-danger/90 animate-pulse' : ''
          }`}
          aria-pressed={isVADMode}
          aria-label={isVADMode ? '会話モード停止' : '会話モード開始'}
        >
          <Mic size={18} className="sm:w-5 sm:h-5" />
        </button>

        {/* テキスト入力 */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力..."
          className="flex-1 resize-none bg-transparent text-white placeholder:text-slate-400 text-sm sm:text-base leading-6 focus:outline-none min-h-[40px] sm:min-h-[44px] max-h-32 overflow-y-auto px-1"
          rows={1}
          maxLength={2000}
          aria-label="メッセージ入力"
        />

        {/* 送信ボタン */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="btn-primary flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="送信"
        >
          {isSending ? (
            <Loader2 size={18} className="animate-spin sm:w-5 sm:h-5" />
          ) : (
            <Send size={18} className="sm:w-5 sm:h-5" />
          )}
        </button>
      </div>

      {/* サブアクション */}
      <div className="flex items-center gap-2 sm:gap-3 mt-3 flex-wrap">
        <button
          type="button"
          onClick={onShowEvaluation}
          disabled={isLoadingEvaluation}
          className="btn btn-secondary text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed flex-1 sm:flex-none min-w-[120px]"
          aria-label="講評を表示"
        >
          {isLoadingEvaluation ? (
            <>
              <Loader2 size={14} className="mr-1 sm:mr-1.5 animate-spin" />
              <span className="hidden sm:inline">考え中...</span>
              <span className="sm:hidden">考え中</span>
            </>
          ) : (
            <>
              <MessageSquare size={14} className="mr-1 sm:mr-1.5" />
              <span className="hidden sm:inline">講評を見る</span>
              <span className="sm:hidden">講評</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="btn btn-secondary text-xs sm:text-sm flex-1 sm:flex-none min-w-[100px]"
          aria-label="会話をクリア"
        >
          <Trash2 size={14} className="mr-1 sm:mr-1.5" />
          <span className="hidden sm:inline">会話をクリア</span>
          <span className="sm:hidden">クリア</span>
        </button>
      </div>
    </div>
  );
}

