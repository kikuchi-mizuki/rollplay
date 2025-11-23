import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Mic, Send, MessageSquare, Trash2, Loader2 } from 'lucide-react';
import { RecordingState } from '../types';
import { formatDuration } from '../lib/audio';

/**
 * コンポーザー（入力エリア）コンポーネント
 * @param onSend - 送信時のコールバック（テキストを渡す）
 * @param onStartRecording - 録音開始時のコールバック
 * @param onStopRecording - 録音停止時のコールバック
 * @param isRecording - 録音中かどうか
 * @param recordingState - 録音状態
 * @param isSending - 送信中かどうか
 * @param onClear - 会話をクリアするコールバック
 * @param onShowEvaluation - 講評を表示するコールバック
 */
interface ComposerProps {
  onSend: (text: string) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  isRecording: boolean;
  recordingState?: RecordingState;
  isSending?: boolean;
  onClear: () => void;
  onShowEvaluation: () => void;
  isLoadingEvaluation?: boolean;
  onTestSpeech?: () => void; // 音声テスト用
}

export function Composer({
  onSend,
  onStartRecording,
  onStopRecording,
  isRecording,
  recordingState,
  isSending = false,
  onClear,
  onShowEvaluation,
  isLoadingEvaluation = false,
  onTestSpeech,
}: ComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isPressed, setIsPressed] = useState(false);
  const pressTimerRef = useRef<number | null>(null);

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

  // 録音ボタンの長押し処理
  const handleMouseDown = () => {
    setIsPressed(true);
    pressTimerRef.current = window.setTimeout(() => {
      onStartRecording();
    }, 200); // 200ms長押しで録音開始
  };

  const handleMouseUp = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    setIsPressed(false);
    if (isRecording) {
      onStopRecording();
    }
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      onStopRecording();
    } else {
      onStartRecording();
    }
  };

  const canSend = text.trim().length > 0 && !isSending;

  return (
    <div className="w-full">
      {/* 録音レベル表示（録音中のみ） */}
      {isRecording && recordingState && (
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
            {recordingState.duration < 2 && (
              <span className="text-xs text-yellow-400">(最低2秒)</span>
            )}
          </div>
        </div>
      )}

      {/* 入力エリア */}
      <div className="flex items-center gap-3">
        {/* 音声録音ボタン */}
        <button
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleToggleRecording}
          className={`btn-icon flex-shrink-0 ${
            isRecording ? 'bg-danger hover:bg-danger/90' : ''
          } ${isPressed ? 'scale-95' : ''}`}
          aria-pressed={isRecording}
          aria-label={isRecording ? '録音を停止' : '音声録音'}
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
      <div className="flex items-center gap-2 md:gap-3 mt-3 flex-wrap">
        <button
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
          onClick={onClear}
          className="btn btn-secondary text-xs md:text-sm"
          aria-label="会話をクリア"
        >
          <Trash2 size={14} className="mr-1.5" />
          会話をクリア
        </button>
        {onTestSpeech && (
          <button
            onClick={onTestSpeech}
            className="btn btn-secondary text-xs md:text-sm bg-blue-600 hover:bg-blue-700"
            aria-label="音声テスト"
          >
            🔊 音声テスト
          </button>
        )}
      </div>
    </div>
  );
}

