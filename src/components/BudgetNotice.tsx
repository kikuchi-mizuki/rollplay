import { AlertCircle, X } from 'lucide-react';
import { useState, useEffect } from 'react';

/**
 * 月間予算制限の告知バナー
 * 月1万円の予算上限を通知
 */
export function BudgetNotice() {
  const [isVisible, setIsVisible] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // ローカルストレージから非表示設定を読み込む
    const dismissed = localStorage.getItem('budget_notice_dismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
      setIsVisible(false);
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    setIsDismissed(true);
    // 非表示設定をローカルストレージに保存（セッション期間中のみ）
    localStorage.setItem('budget_notice_dismissed', 'true');
  };

  if (!isVisible || isDismissed) {
    return null;
  }

  return (
    <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-4">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <AlertCircle className="h-5 w-5 text-amber-400" />
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-amber-800">
            ご利用について
          </h3>
          <div className="mt-2 text-sm text-amber-700">
            <p>
              本サービスは月間予算を設けて運用しています。
              予算に達した場合、月初までサービスが一時停止される場合がありますのでご了承ください。
            </p>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              <li>会話: 月間約2万回まで</li>
              <li>音声認識: 月間約1万回まで</li>
              <li>音声合成: 月間約1.5万回まで</li>
            </ul>
            <p className="mt-2 text-xs">
              ※ 利用状況により制限が変更される場合があります
            </p>
          </div>
        </div>
        <div className="ml-auto flex-shrink-0">
          <button
            type="button"
            className="inline-flex rounded-md bg-amber-50 p-1.5 text-amber-500 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 focus:ring-offset-amber-50"
            onClick={handleDismiss}
          >
            <span className="sr-only">閉じる</span>
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
