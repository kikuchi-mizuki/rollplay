import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * トースト通知コンポーネント
 * @param message - 表示するメッセージ
 * @param type - トーストのタイプ（success, error, info）
 * @param onClose - 閉じる時のコールバック
 * @param duration - 表示時間（ミリ秒、デフォルト: 3000）
 */
interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type = 'info', onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const typeStyles = {
    success: 'bg-success text-white',
    error: 'bg-danger text-white',
    info: 'bg-slate-700 text-white',
  };

  return (
    <div
      className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-[300] ${typeStyles[type]} rounded-2xl px-4 py-3 shadow-xl flex items-center gap-3 min-w-[280px] max-w-[90vw] animate-in slide-in-from-top-5`}
      role="alert"
      aria-live="assertive"
    >
      <span className="flex-1 text-sm font-medium">{message}</span>
      <button
        onClick={onClose}
        className="p-1 hover:bg-white/20 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        aria-label="トーストを閉じる"
      >
        <X size={16} />
      </button>
    </div>
  );
}

