import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getConversations, getEvaluations } from '../../lib/api';
import { downloadEvaluationsCSV, downloadConversationsCSV } from '../../lib/csv';
import { Header } from '../Header';
import { ScoreChart } from './ScoreChart';

interface ConversationHistory {
  id: string;
  scenario_id: string;
  scenario_title: string;
  created_at: string;
  duration_seconds: number;
  messages: any[];
}

interface EvaluationHistory {
  id: string;
  conversation_id: string;
  scenario_id: string;
  created_at: string;
  scores: {
    questioning_skill: number;
    listening_skill: number;
    proposal_skill: number;
    closing_skill: number;
  };
  total_score: number;
  average_score: number;
  comments: {
    overall: string;
    strengths: string[];
    improvements: string[];
  };
}

export function HistoryPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationHistory[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'conversations' | 'evaluations'>('conversations');

  useEffect(() => {
    if (user) {
      loadHistory();
    }
  }, [user, selectedScenario]);

  const loadHistory = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // 会話履歴を取得
      const conversationsData = await getConversations({
        userId: user.id,
        ...(selectedScenario !== 'all' && { scenarioId: selectedScenario }),
        limit: 50,
      });
      setConversations(conversationsData);

      // 評価履歴を取得
      const evaluationsData = await getEvaluations({
        userId: user.id,
        ...(selectedScenario !== 'all' && { scenarioId: selectedScenario }),
        limit: 50,
      });
      setEvaluations(evaluationsData);
    } catch (err) {
      console.error('履歴取得エラー:', err);
      setError('履歴の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}分${secs}秒`;
  };

  const getScoreColor = (score: number) => {
    if (score >= 4) return 'text-green-400';
    if (score >= 3) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getAverageScore = () => {
    if (evaluations.length === 0) return 0;
    const total = evaluations.reduce((sum, evaluation) => sum + evaluation.average_score, 0);
    return (total / evaluations.length).toFixed(2);
  };

  const uniqueScenarios = Array.from(
    new Set(conversations.map(c => c.scenario_id))
  ).map(id => {
    const conv = conversations.find(c => c.scenario_id === id);
    return { id, title: conv?.scenario_title || id };
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0D0E20] via-[#16172B] to-[#272A46]">
      <Header isConnected={true} scenarios={[]} selectedScenarioId="" onScenarioChange={() => {}} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* ヘッダー */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/')}
            className="mb-4 text-gray-400 hover:text-white transition-colors flex items-center gap-2"
          >
            <span>←</span> ロープレに戻る
          </button>
          <h1 className="text-3xl font-bold text-white mb-2">練習履歴</h1>
          <p className="text-gray-400">
            {profile?.display_name}さんの練習記録
          </p>
        </div>

        {/* 統計カード */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <div className="text-gray-400 text-sm mb-1">総練習回数</div>
            <div className="text-3xl font-bold text-white">{conversations.length}回</div>
          </div>
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <div className="text-gray-400 text-sm mb-1">評価完了</div>
            <div className="text-3xl font-bold text-white">{evaluations.length}回</div>
          </div>
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <div className="text-gray-400 text-sm mb-1">平均スコア</div>
            <div className="text-3xl font-bold text-white">{getAverageScore()}点</div>
          </div>
        </div>

        {/* スコア推移グラフ */}
        {evaluations.length > 0 && (
          <div className="mb-8 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h2 className="text-xl font-bold text-white mb-4">スコア推移</h2>
            <ScoreChart evaluations={evaluations} />
          </div>
        )}

        {/* フィルター */}
        <div className="mb-6 flex gap-4 flex-wrap items-center">
          <select
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="all">全シナリオ</option>
            {uniqueScenarios.map(scenario => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.title}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('conversations')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                viewMode === 'conversations'
                  ? 'bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] text-white'
                  : 'bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              会話履歴
            </button>
            <button
              onClick={() => setViewMode('evaluations')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                viewMode === 'evaluations'
                  ? 'bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] text-white'
                  : 'bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              評価履歴
            </button>
          </div>

          <button
            onClick={() => {
              if (viewMode === 'conversations') {
                downloadConversationsCSV(conversations, `conversations_${new Date().toISOString().split('T')[0]}.csv`);
              } else {
                downloadEvaluationsCSV(evaluations, `evaluations_${new Date().toISOString().split('T')[0]}.csv`);
              }
            }}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white hover:bg-white/10 transition-colors flex items-center gap-2"
            title="CSV出力"
          >
            <Download size={18} />
            <span>CSV出力</span>
          </button>
        </div>

        {/* ローディング・エラー表示 */}
        {loading && (
          <div className="text-center py-12 text-gray-400">
            読み込み中...
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400">
            {error}
          </div>
        )}

        {/* 会話履歴表示 */}
        {!loading && !error && viewMode === 'conversations' && (
          <div className="space-y-4">
            {conversations.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                まだ練習履歴がありません
              </div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-1">
                        {conv.scenario_title}
                      </h3>
                      <p className="text-sm text-gray-400">
                        {formatDate(conv.created_at)} • {formatDuration(conv.duration_seconds)}
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-purple-500/20 text-purple-300 rounded-full text-sm">
                      {conv.messages.length}メッセージ
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 評価履歴表示 */}
        {!loading && !error && viewMode === 'evaluations' && (
          <div className="space-y-4">
            {evaluations.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                まだ評価履歴がありません
              </div>
            ) : (
              evaluations.map((evaluation) => (
                <div
                  key={evaluation.id}
                  className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-1">
                        シナリオ: {evaluation.scenario_id}
                      </h3>
                      <p className="text-sm text-gray-400">
                        {formatDate(evaluation.created_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-400">平均スコア</div>
                      <div className={`text-2xl font-bold ${getScoreColor(evaluation.average_score)}`}>
                        {evaluation.average_score.toFixed(1)}点
                      </div>
                    </div>
                  </div>

                  {/* スコア詳細 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-gray-400 mb-1">質問力</div>
                      <div className={`text-lg font-semibold ${getScoreColor(evaluation.scores.questioning_skill)}`}>
                        {evaluation.scores.questioning_skill}点
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400 mb-1">傾聴力</div>
                      <div className={`text-lg font-semibold ${getScoreColor(evaluation.scores.listening_skill)}`}>
                        {evaluation.scores.listening_skill}点
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400 mb-1">提案力</div>
                      <div className={`text-lg font-semibold ${getScoreColor(evaluation.scores.proposal_skill)}`}>
                        {evaluation.scores.proposal_skill}点
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400 mb-1">クロージング力</div>
                      <div className={`text-lg font-semibold ${getScoreColor(evaluation.scores.closing_skill)}`}>
                        {evaluation.scores.closing_skill}点
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
