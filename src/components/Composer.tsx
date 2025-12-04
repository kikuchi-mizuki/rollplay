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
      <div className="flex items-center gap-3">
        {/* 会話モードボタン（VAD） */}
        <button
          type="button"
          onClick={onToggleVAD}
          className={`btn-icon flex-shrink-0 ${
            isVADMode ? 'bg-danger hover:bg-danger/90 animate-pulse' : ''
          }`}
          aria-pressed={isVADMode}
          aria-label={isVADMode ? '会話モード停止' : '会話モード開始'}
        >
          <Mic size={20} />
        </button>

        {/* テキスト入力 */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力... (Cmd/Ctrl + Enter で送信)"
          className="flex-1 resize-none bg-transparent text-white placeholder:text-slate-400 leading-6 focus:outline-none min-h-[44px] max-h-32 overflow-y-auto"
          rows={1}
          maxLength={2000}
          aria-label="メッセージ入力"
        />

        {/* 送信ボタン */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="btn-primary flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="送信"
        >
          {isSending ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <Send size={20} />
          )}
        </button>
      </div>

      {/* サブアクション */}
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          onClick={onShowEvaluation}
          disabled={isLoadingEvaluation}
          className="btn btn-secondary text-xs md:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="講評を表示"
        >
          {isLoadingEvaluation ? (
            <>
              <Loader2 size={14} className="mr-1.5 animate-spin" />
              考え中...
            </>
          ) : (
            <>
              <MessageSquare size={14} className="mr-1.5" />
              講評を見る
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="btn btn-secondary text-xs md:text-sm"
          aria-label="会話をクリア"
        >
          <Trash2 size={14} className="mr-1.5" />
          会話をクリア
        </button>
      </div>
    </div>
  );
}

