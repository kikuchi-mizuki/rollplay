import { X } from 'lucide-react';

/**
 * 確認ダイアログコンポーネント
 * @param isOpen - ダイアログの表示状態
 * @param title - タイトル
 * @param message - メッセージ
 * @param confirmLabel - 確認ボタンのラベル（デフォルト: "確認"）
 * @param cancelLabel - キャンセルボタンのラベル（デフォルト: "キャンセル"）
 * @param onConfirm - 確認時のコールバック
 * @param onCancel - キャンセル時のコールバック
 */
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = '確認',
  cancelLabel = 'キャンセル',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
    >
      <div className="card max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 id="confirm-dialog-title" className="text-lg font-semibold text-text">
            {title}
          </h2>
          <button
            onClick={onCancel}
            className="btn-icon text-text-muted hover:text-text"
            aria-label="ダイアログを閉じる"
          >
            <X size={20} />
          </button>
        </div>
        <p id="confirm-dialog-message" className="text-text-muted mb-6">
          {message}
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn btn-outline">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} className="btn btn-primary">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

