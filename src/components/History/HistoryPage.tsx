import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getConversations, getEvaluations, getScenarios } from '../../lib/api';
import { downloadEvaluationsCSV, downloadConversationsCSV } from '../../lib/csv';
import { History, BarChart3, TrendingUp, Calendar, Download } from 'lucide-react';

interface Conversation {
  id: string;
  scenario_id: string;
  messages: any[];
  duration_seconds: number;
  created_at: string;
}

interface EvaluationRecord {
  id: string;
  scenario_id: string;
  scores: {
    questioning_skill: number;
    listening_skill: number;
    proposal_skill: number;
    closing_skill: number;
  };
  total_score: number;
  average_score: number;
  created_at: string;
}

export function HistoryPage() {
  const { profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [scenarios, setScenarios] = useState<{ id: string; title: string }[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [profile, selectedScenario]);

  const loadData = async () => {
    if (!profile) return;

    try {
      setLoading(true);

      // シナリオ一覧を取得
      const scenariosData = await getScenarios();
      setScenarios(scenariosData.filter(s => s.enabled));

      // 会話履歴を取得
      const conversationsData = await getConversations({
        userId: profile.id,
        scenarioId: selectedScenario === 'all' ? undefined : selectedScenario,
        limit: 50
      });
      setConversations(conversationsData);

      // 評価履歴を取得
      const evaluationsData = await getEvaluations({
        userId: profile.id,
        scenarioId: selectedScenario === 'all' ? undefined : selectedScenario,
        limit: 50
      });
      setEvaluations(evaluationsData);

    } catch (error) {
      console.error('データ取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  // 統計情報を計算
  const stats = {
    totalPractices: conversations.length,
    totalEvaluations: evaluations.length,
    averageScore: evaluations.length > 0
      ? (evaluations.reduce((sum, e) => sum + e.average_score, 0) / evaluations.length).toFixed(1)
      : '0.0'
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getScenarioTitle = (scenarioId: string) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    return scenario?.title || scenarioId;
  };

  const getScoreColor = (score: number) => {
    if (score >= 4) return 'text-green-400';
    if (score >= 3) return 'text-yellow-400';
    return 'text-red-400';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white text-lg">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0D0E20] via-[#16172B] to-[#272A46] p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <History size={32} />
            練習履歴
          </h1>
          <p className="text-white/60">過去の練習記録と評価結果を確認できます</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-2">
              <History className="text-primary" size={24} />
              <h3 className="text-white/80 text-sm">総練習回数</h3>
            </div>
            <p className="text-3xl font-bold text-white">{stats.totalPractices}回</p>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-2">
              <BarChart3 className="text-primary" size={24} />
              <h3 className="text-white/80 text-sm">評価完了回数</h3>
            </div>
            <p className="text-3xl font-bold text-white">{stats.totalEvaluations}回</p>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-2">
              <TrendingUp className="text-primary" size={24} />
              <h3 className="text-white/80 text-sm">平均スコア</h3>
            </div>
            <p className="text-3xl font-bold text-white">{stats.averageScore}<span className="text-xl text-white/60">/5.0</span></p>
          </div>
        </div>

        <div className="glass-card p-4 mb-6">
          <label className="text-white/80 text-sm mb-2 block">シナリオで絞り込み</label>
          <select
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
            className="w-full md:w-64 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all" className="bg-slate-800">すべてのシナリオ</option>
            {scenarios.map(scenario => (
              <option key={scenario.id} value={scenario.id} className="bg-slate-800">
                {scenario.title}
              </option>
            ))}
          </select>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Calendar size={24} />
              評価履歴
            </h2>
            {evaluations.length > 0 && (
              <button
                onClick={() => downloadEvaluationsCSV(evaluations, getScenarioTitle)}
                className="btn btn-secondary text-sm flex items-center gap-2"
              >
                <Download size={16} />
                CSV出力
              </button>
            )}
          </div>

          {evaluations.length === 0 ? (
            <div className="text-center py-12 text-white/60">
              <History size={48} className="mx-auto mb-4 opacity-30" />
              <p>評価履歴がありません</p>
              <p className="text-sm mt-2">練習を開始して講評を受けてみましょう</p>
            </div>
          ) : (
            <div className="space-y-4">
              {evaluations.map((evaluation) => (
                <div
                  key={evaluation.id}
                  className="p-4 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-white font-semibold">{getScenarioTitle(evaluation.scenario_id)}</h3>
                      <p className="text-white/60 text-sm">{formatDate(evaluation.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${getScoreColor(evaluation.average_score)}`}>
                        {evaluation.average_score.toFixed(1)}
                      </p>
                      <p className="text-white/60 text-xs">平均スコア</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white/5 rounded p-2">
                      <p className="text-white/60 text-xs mb-1">質問力</p>
                      <p className={`text-lg font-semibold ${getScoreColor(evaluation.scores.questioning_skill)}`}>
                        {evaluation.scores.questioning_skill.toFixed(1)}
                      </p>
                    </div>
                    <div className="bg-white/5 rounded p-2">
                      <p className="text-white/60 text-xs mb-1">傾聴力</p>
                      <p className={`text-lg font-semibold ${getScoreColor(evaluation.scores.listening_skill)}`}>
                        {evaluation.scores.listening_skill.toFixed(1)}
                      </p>
                    </div>
                    <div className="bg-white/5 rounded p-2">
                      <p className="text-white/60 text-xs mb-1">提案力</p>
                      <p className={`text-lg font-semibold ${getScoreColor(evaluation.scores.proposal_skill)}`}>
                        {evaluation.scores.proposal_skill.toFixed(1)}
                      </p>
                    </div>
                    <div className="bg-white/5 rounded p-2">
                      <p className="text-white/60 text-xs mb-1">クロージング</p>
                      <p className={`text-lg font-semibold ${getScoreColor(evaluation.scores.closing_skill)}`}>
                        {evaluation.scores.closing_skill.toFixed(1)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
