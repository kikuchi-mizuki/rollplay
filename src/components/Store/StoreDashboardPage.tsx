import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getStoreMembers, getStoreAnalytics } from '../../lib/api'
import { Users, TrendingUp, Award, BarChart2 } from 'lucide-react'

interface StoreMember {
  id: string
  display_name: string
  email: string
  avatar_url: string | null
  role: string
  conversation_count: number
  evaluation_count: number
  average_score: number
  created_at: string
}

interface ScenarioAnalytics {
  scenario_id: string
  count: number
  average_score: number
}

interface StoreAnalytics {
  store: {
    id: string
    store_code: string
    store_name: string
    region: string | null
  }
  scenarioAnalytics: ScenarioAnalytics[]
  totalEvaluations: number
}

/**
 * 店舗管理者用ダッシュボード
 * 自店舗のメンバーとスコア分析を表示
 */
export function StoreDashboardPage() {
  const navigate = useNavigate()
  const { profile, loading } = useAuth()
  const [members, setMembers] = useState<StoreMember[]>([])
  const [analytics, setAnalytics] = useState<StoreAnalytics | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // データ取得
  const fetchData = async () => {
    if (!profile?.store_id) return

    try {
      setLoadingData(true)
      setError(null)

      const [membersData, analyticsData] = await Promise.all([
        getStoreMembers(profile.store_id),
        getStoreAnalytics(profile.store_id)
      ])

      setMembers(membersData)
      setAnalytics(analyticsData)
    } catch (err: any) {
      console.error('データ取得エラー:', err)
      setError(err.message)
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => {
    if (profile?.store_id) {
      fetchData()
    }
  }, [profile])

  const getScoreColor = (score: number) => {
    if (score >= 4) return 'text-green-400'
    if (score >= 3) return 'text-yellow-400'
    return 'text-red-400'
  }

  const getAverageScore = () => {
    if (members.length === 0) return 0
    const total = members.reduce((sum, member) => sum + member.average_score, 0)
    return (total / members.length).toFixed(1)
  }

  const getScenarioTitle = (scenarioId: string): string => {
    const titles: Record<string, string> = {
      'meeting_1st': '1次面談',
      'meeting_1_5th': '1.5次面談',
      'meeting_2nd': '2次面談',
      'meeting_3rd': '3次面談',
      'kickoff_meeting': 'キックオフMTG',
      'upsell': '追加営業'
    }
    return titles[scenarioId] || scenarioId
  }

  if (loading || loadingData) {
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
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <BarChart2 className="text-[#A29BFE]" size={36} />
            店舗ダッシュボード
          </h1>
          {analytics?.store && (
            <p className="text-slate-400 mt-2">
              {analytics.store.store_name}
              {analytics.store.region && ` (${analytics.store.region})`}
            </p>
          )}
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 glass-card border-red-500/30 bg-red-500/10">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* 統計カード */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Users className="text-blue-400" size={24} />
              </div>
              <div className="text-sm text-slate-400">メンバー数</div>
            </div>
            <div className="text-3xl font-bold text-white">{members.length}</div>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <TrendingUp className="text-green-400" size={24} />
              </div>
              <div className="text-sm text-slate-400">総練習回数</div>
            </div>
            <div className="text-3xl font-bold text-white">
              {members.reduce((sum, m) => sum + m.conversation_count, 0)}
            </div>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <Award className="text-yellow-400" size={24} />
              </div>
              <div className="text-sm text-slate-400">総評価回数</div>
            </div>
            <div className="text-3xl font-bold text-white">
              {members.reduce((sum, m) => sum + m.evaluation_count, 0)}
            </div>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-pink-500/20 rounded-lg">
                <TrendingUp className="text-pink-400" size={24} />
              </div>
              <div className="text-sm text-slate-400">店舗平均スコア</div>
            </div>
            <div className={`text-3xl font-bold ${getScoreColor(Number(getAverageScore()))}`}>
              {getAverageScore()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* シナリオ別分析 */}
          <div className="glass-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <BarChart2 className="text-[#A29BFE]" size={24} />
              シナリオ別スコア
            </h2>

            {analytics?.scenarioAnalytics && analytics.scenarioAnalytics.length > 0 ? (
              <div className="space-y-4">
                {analytics.scenarioAnalytics.map((scenario) => (
                  <div key={scenario.scenario_id} className="border-b border-white/10 pb-4 last:border-0">
                    <div className="flex justify-between items-center mb-2">
                      <div className="text-white font-medium">
                        {getScenarioTitle(scenario.scenario_id)}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-400">
                          {scenario.count}回
                        </span>
                        <span className={`text-lg font-bold ${getScoreColor(scenario.average_score)}`}>
                          {scenario.average_score.toFixed(1)}
                        </span>
                      </div>
                    </div>
                    {/* プログレスバー */}
                    <div className="w-full bg-white/10 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          scenario.average_score >= 4
                            ? 'bg-green-400'
                            : scenario.average_score >= 3
                            ? 'bg-yellow-400'
                            : 'bg-red-400'
                        }`}
                        style={{ width: `${(scenario.average_score / 5) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400">
                まだデータがありません
              </div>
            )}
          </div>

          {/* メンバー一覧 */}
          <div className="glass-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <Users className="text-[#A29BFE]" size={24} />
              メンバー一覧
            </h2>

            {members.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                メンバーがいません
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {member.avatar_url ? (
                        <img
                          src={member.avatar_url}
                          alt={member.display_name}
                          className="w-10 h-10 rounded-full"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] flex items-center justify-center text-white font-bold">
                          {member.display_name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <div className="text-white font-medium">{member.display_name}</div>
                        <div className="text-xs text-slate-400">
                          練習{member.conversation_count}回 • 評価{member.evaluation_count}回
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400 mb-1">平均</div>
                      <div className={`text-lg font-bold ${getScoreColor(member.average_score)}`}>
                        {member.average_score > 0 ? member.average_score.toFixed(1) : '-'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
