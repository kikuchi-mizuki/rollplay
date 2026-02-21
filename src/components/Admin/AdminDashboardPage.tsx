import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getStoresStats, getStoresRankings, getOnlineUsers } from '../../lib/api'
import { BarChart3, TrendingUp, Users, MessageSquare, Award, Building2, Radio } from 'lucide-react'

interface StoreRanking {
  store_id: string
  store_code: string
  store_name: string
  region: string | null
  user_count: number
  conversation_count: number
  evaluation_count: number
  average_score: number
}

interface StoresStats {
  total_stores: number
  total_users: number
  total_conversations: number
  total_evaluations: number
  overall_avg_score: number
}

interface OnlineUser {
  id: string
  display_name: string
  email: string
  store_id: string
  store_name: string
  store_code: string
  region: string
  last_active_at: string
  role: string
}

/**
 * 本部管理者用ダッシュボード
 * 全店舗の統計情報とランキングを表示
 */
export function AdminDashboardPage() {
  const navigate = useNavigate()
  const { profile, loading } = useAuth()
  const [stats, setStats] = useState<StoresStats | null>(null)
  const [rankings, setRankings] = useState<StoreRanking[]>([])
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [onlineCount, setOnlineCount] = useState(0)
  const [loadingData, setLoadingData] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'rankings' | 'online'>('rankings')

  // 権限チェック
  useEffect(() => {
    if (!loading && profile?.role !== 'admin') {
      navigate('/')
    }
  }, [loading, profile, navigate])

  // データ取得
  const fetchData = async () => {
    try {
      setLoadingData(true)
      setError(null)

      const [statsData, rankingsData, onlineData] = await Promise.all([
        getStoresStats(),
        getStoresRankings(),
        getOnlineUsers(5)
      ])

      setStats(statsData)
      setRankings(rankingsData)
      setOnlineUsers(onlineData.onlineUsers)
      setOnlineCount(onlineData.count)
    } catch (err: any) {
      console.error('データ取得エラー:', err)
      setError(err.message)
    } finally {
      setLoadingData(false)
    }
  }

  // オンラインユーザーのみを再取得（自動更新用）
  const fetchOnlineUsers = async () => {
    try {
      const onlineData = await getOnlineUsers(5)
      setOnlineUsers(onlineData.onlineUsers)
      setOnlineCount(onlineData.count)
    } catch (err: any) {
      console.error('オンラインユーザー取得エラー:', err)
    }
  }

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchData()
    }
  }, [profile])

  // オンラインユーザーを30秒ごとに更新
  useEffect(() => {
    if (profile?.role === 'admin' && activeTab === 'online') {
      const interval = setInterval(() => {
        fetchOnlineUsers()
      }, 30000) // 30秒

      return () => clearInterval(interval)
    }
  }, [profile, activeTab])

  const getRankMedal = (rank: number) => {
    if (rank === 1) return '🥇'
    if (rank === 2) return '🥈'
    if (rank === 3) return '🥉'
    return `${rank}位`
  }

  const getScoreColor = (score: number) => {
    if (score >= 4) return 'text-green-400'
    if (score >= 3) return 'text-yellow-400'
    return 'text-red-400'
  }

  if (loading || (profile?.role === 'admin' && loadingData && !stats)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D0E20] via-[#16172B] to-[#272A46]">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">読み込み中...</h2>
        </div>
      </div>
    )
  }

  if (profile?.role !== 'admin') {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0D0E20] via-[#16172B] to-[#272A46] py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/')}
            className="text-[#A29BFE] hover:text-[#B9B0FF] mb-4 flex items-center gap-2 transition-colors"
          >
            ← メイン画面に戻る
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <BarChart3 className="text-[#A29BFE]" size={36} />
                本部管理者ダッシュボード
              </h1>
              <p className="text-slate-400 mt-2">全店舗の統計情報とランキング</p>
            </div>
            <button
              onClick={() => navigate('/admin/stores')}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white transition-all flex items-center gap-2"
            >
              <Building2 size={18} />
              店舗管理
            </button>
          </div>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 glass-card border-red-500/30 bg-red-500/10">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* 統計カード */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <div className="glass-card p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <Building2 className="text-purple-400" size={24} />
                </div>
                <div className="text-sm text-slate-400">総店舗数</div>
              </div>
              <div className="text-3xl font-bold text-white">{stats.total_stores}</div>
            </div>

            <div className="glass-card p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <Users className="text-blue-400" size={24} />
                </div>
                <div className="text-sm text-slate-400">総ユーザー数</div>
              </div>
              <div className="text-3xl font-bold text-white">{stats.total_users}</div>
            </div>

            <div className="glass-card p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <MessageSquare className="text-green-400" size={24} />
                </div>
                <div className="text-sm text-slate-400">総練習回数</div>
              </div>
              <div className="text-3xl font-bold text-white">{stats.total_conversations}</div>
            </div>

            <div className="glass-card p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-yellow-500/20 rounded-lg">
                  <Award className="text-yellow-400" size={24} />
                </div>
                <div className="text-sm text-slate-400">総評価回数</div>
              </div>
              <div className="text-3xl font-bold text-white">{stats.total_evaluations}</div>
            </div>

            <div className="glass-card p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-pink-500/20 rounded-lg">
                  <TrendingUp className="text-pink-400" size={24} />
                </div>
                <div className="text-sm text-slate-400">全体平均スコア</div>
              </div>
              <div className={`text-3xl font-bold ${getScoreColor(stats.overall_avg_score)}`}>
                {stats.overall_avg_score.toFixed(1)}
              </div>
            </div>
          </div>
        )}

        {/* タブUI */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab('rankings')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
                  activeTab === 'rankings'
                    ? 'bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Award size={20} />
                店舗別ランキング
              </button>
              <button
                onClick={() => setActiveTab('online')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
                  activeTab === 'online'
                    ? 'bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Radio size={20} />
                ログイン中のユーザー
                {onlineCount > 0 && (
                  <span className="px-2 py-0.5 bg-green-500 text-white text-xs rounded-full">
                    {onlineCount}
                  </span>
                )}
              </button>
            </div>
            <div className="text-sm text-slate-400">
              {activeTab === 'rankings' ? '平均スコア順' : '最終アクティブ順'}
            </div>
          </div>

          {loadingData ? (
            <div className="text-center py-12 text-slate-400">
              読み込み中...
            </div>
          ) : activeTab === 'rankings' ? (
            rankings.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <p>まだデータがありません</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-3 px-4 font-semibold text-slate-300 w-20">順位</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-300">店舗名</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-300">店舗コード</th>
                      <th className="text-center py-3 px-4 font-semibold text-slate-300">ユーザー数</th>
                      <th className="text-center py-3 px-4 font-semibold text-slate-300">練習回数</th>
                      <th className="text-center py-3 px-4 font-semibold text-slate-300">評価回数</th>
                      <th className="text-right py-3 px-4 font-semibold text-slate-300">平均スコア</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankings.map((store, index) => (
                      <tr
                        key={store.store_id}
                        className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                          index < 3 ? 'bg-gradient-to-r from-white/5 to-transparent' : ''
                        }`}
                      >
                        <td className="py-4 px-4">
                          <span className="text-2xl">
                            {getRankMedal(index + 1)}
                          </span>
                        </td>
                        <td className="py-4 px-4 font-medium text-white">
                          {store.store_name}
                          {store.region && (
                            <span className="ml-2 text-xs text-slate-400">
                              ({store.region})
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          <code className="px-2 py-1 bg-white/10 rounded text-xs text-slate-300 font-mono">
                            {store.store_code}
                          </code>
                        </td>
                        <td className="py-4 px-4 text-center text-slate-300">
                          {store.user_count}
                        </td>
                        <td className="py-4 px-4 text-center text-slate-300">
                          {store.conversation_count}
                        </td>
                        <td className="py-4 px-4 text-center text-slate-300">
                          {store.evaluation_count}
                        </td>
                        <td className="py-4 px-4 text-right">
                          <span className={`text-lg font-bold ${getScoreColor(store.average_score)}`}>
                            {store.average_score.toFixed(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* オンラインユーザーテーブル */
            onlineUsers.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <p>現在ログイン中のユーザーはいません</p>
                <p className="text-sm mt-2">（過去5分以内にアクティブなユーザーを表示）</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-3 px-4 font-semibold text-slate-300">ステータス</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-300">ユーザー名</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-300">メール</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-300">店舗名</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-300">店舗コード</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-300">リージョン</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-300">権限</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-300">最終アクティブ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onlineUsers.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors"
                      >
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            <span className="text-xs text-green-400 font-semibold">オンライン</span>
                          </div>
                        </td>
                        <td className="py-4 px-4 font-medium text-white">
                          {user.display_name}
                        </td>
                        <td className="py-4 px-4 text-slate-300 text-sm">
                          {user.email}
                        </td>
                        <td className="py-4 px-4 text-slate-300">
                          {user.store_name}
                        </td>
                        <td className="py-4 px-4">
                          <code className="px-2 py-1 bg-white/10 rounded text-xs text-slate-300 font-mono">
                            {user.store_code}
                          </code>
                        </td>
                        <td className="py-4 px-4 text-slate-300">
                          {user.region}
                        </td>
                        <td className="py-4 px-4">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            user.role === 'admin' ? 'bg-purple-500/20 text-purple-300' :
                            user.role === 'manager' ? 'bg-blue-500/20 text-blue-300' :
                            'bg-gray-500/20 text-gray-300'
                          }`}>
                            {user.role === 'admin' ? '管理者' : user.role === 'manager' ? 'マネージャー' : 'ユーザー'}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-slate-300 text-sm">
                          {new Date(user.last_active_at).toLocaleString('ja-JP')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-4 text-sm text-slate-400 text-center">
                  自動更新: 30秒ごと
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
