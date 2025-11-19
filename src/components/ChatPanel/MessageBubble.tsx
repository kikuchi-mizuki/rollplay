import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { MessageRole } from '../../types';

/**
 * メッセージバブルコンポーネント
 * @param role - メッセージの役割（bot または user）
 * @param text - メッセージテキスト
 * @param time - タイムスタンプ
 * @param isGrouped - 連続発言かどうか（true: 角丸を縮小）
 */
interface MessageBubbleProps {
  role: MessageRole;
  text: string;
  time: Date;
  isGrouped?: 'top' | 'middle' | 'bottom' | false;
}

export function MessageBubble({ role, text, time, isGrouped = false }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('コピーに失敗しました', err);
    }
  };

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const groupedClass =
    isGrouped === 'top'
      ? 'message-bubble-grouped-top'
      : isGrouped === 'middle'
      ? 'message-bubble-grouped-middle'
      : isGrouped === 'bottom'
      ? 'message-bubble-grouped-bottom'
      : '';

  const bubbleClass =
    role === 'bot'
      ? `message-bubble-bot ${groupedClass}`
      : `message-bubble-user ${groupedClass}`;

  return (
    <div
      className={`flex gap-2 md:gap-3 ${
        role === 'user' ? 'flex-row-reverse' : 'flex-row'
      }`}
    >
      <div className={`${bubbleClass} ${isGrouped ? 'mt-1' : 'mt-3'} animate-popIn`}>
        <p className="text-[15px] text-slate-200 leading-relaxed whitespace-pre-wrap break-words">{text}</p>
        <div
          className={`flex items-center gap-2 mt-2 ${
            role === 'user' ? 'justify-end' : 'justify-start'
          }`}
        >
          <span
            className={`text-xs ${
              role === 'user' ? 'text-white/70' : 'text-slate-300'
            }`}
          >
            {formatTime(time)}
          </span>
          <button
            onClick={handleCopy}
            className={`p-1 rounded-lg transition-colors ${
              role === 'user'
                ? 'hover:bg-white/20 text-white/70'
                : 'hover:bg-slate-200 text-text-muted'
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60`}
            aria-label="メッセージをコピー"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

