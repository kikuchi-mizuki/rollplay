import { Settings, LogOut, User, Store, History } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

/**
 * ヘッダーコンポーネント
 * @param isConnected - 接続状態（true: 接続済み、false: 未接続）
 * @param scenarios - シナリオ一覧
 * @param selectedScenarioId - 選択中のシナリオID
 * @param onScenarioChange - シナリオ変更時のコールバック
 */
interface HeaderProps {
  isConnected?: boolean;
  scenarios?: { id: string; title: string; enabled: boolean }[];
  selectedScenarioId?: string;
  onScenarioChange?: (scenarioId: string) => void;
}

export function Header({
  isConnected = true,
  scenarios = [],
  selectedScenarioId = '',
  onScenarioChange
}: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false);
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-[100] bg-white/10 backdrop-blur-md border-b border-white/10 shadow-lg">
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-3 md:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-success animate-pulse-recording' : 'bg-slate-400'
                }`}
                aria-label={isConnected ? '接続済み' : '未接続'}
                role="status"
              />
              <span className="text-xs text-white/80 hidden sm:inline">
                {isConnected ? '準備完了' : '接続中...'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {scenarios.length > 0 && (
              <select
                value={selectedScenarioId}
                onChange={(e) => onScenarioChange?.(e.target.value)}
                className="px-3 py-1.5 text-sm bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                aria-label="シナリオを選択"
              >
                {scenarios.filter(s => s.enabled).map((scenario) => (
                  <option key={scenario.id} value={scenario.id} className="bg-slate-800 text-white">
                    {scenario.title}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => navigate('/history')}
              className="btn-icon text-white/80 hover:text-white"
              aria-label="練習履歴"
              title="練習履歴"
            >
              <History size={20} />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="btn-icon text-white/80 hover:text-white"
              aria-label="設定を開く"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </div>
      {/* ユーザーメニュー */}
      {showSettings && (
        <div className="absolute top-full right-4 mt-2 glass-card w-64 shadow-xl z-[200] p-4">
          {/* ユーザー情報 */}
          <div className="flex items-center gap-3 pb-3 border-b border-white/10">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.display_name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <User size={20} className="text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {profile?.display_name || 'ユーザー'}
              </p>
              <p className="text-xs text-white/60 truncate">
                {profile?.email || ''}
              </p>
            </div>
          </div>

          {/* メニュー項目 */}
          <div className="py-3 space-y-2">
            {/* 本部管理者専用メニュー */}
            {profile?.role === 'admin' && (
              <button
                onClick={() => {
                  setShowSettings(false)
                  navigate('/admin/stores')
                }}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-white/80 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                <Store size={16} />
                <span>店舗管理</span>
              </button>
            )}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-white/80 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <LogOut size={16} />
              <span>ログアウト</span>
            </button>
          </div>

          <button
            onClick={() => setShowSettings(false)}
            className="mt-2 w-full btn btn-outline text-xs"
          >
            閉じる
          </button>
        </div>
      )}
    </header>
  );
}

