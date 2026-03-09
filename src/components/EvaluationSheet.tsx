import { X, Copy, Check, Download } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Evaluation, Message } from '../types';
import { downloadSingleEvaluationCSV } from '../lib/csv';

// 評価項目名のマッピング（営業 vs ディレクター）
const SKILL_LABELS = {
  sales: {
    questioning: '質問力',
    listening: '傾聴力',
    proposing: '提案力',
    closing: 'クロージング力'
  },
  director: {
    questioning: 'ヒアリング力',  // バックエンドでhearingからマッピング済み
    listening: 'コミュニケーション力',  // バックエンドでcommunicationからマッピング済み
    proposing: '企画提案力',  // バックエンドでplanningからマッピング済み
    closing: 'プロジェクト管理力'  // バックエンドでproject_managementからマッピング済み
  }
};

function getSkillLabel(skillKey: 'questioning' | 'listening' | 'proposing' | 'closing', scenarioId?: string): string {
  const isDirector = scenarioId?.startsWith('director_');
  return isDirector ? SKILL_LABELS.director[skillKey] : SKILL_LABELS.sales[skillKey];
}

/**
 * 講評シートコンポーネント（下からスライドイン）
 * @param isOpen - シートの表示状態
 * @param evaluation - 講評データ
 * @param messages - 会話履歴
 * @param onClose - 閉じる時のコールバック
 */
interface EvaluationSheetProps {
  isOpen: boolean;
  evaluation: Evaluation | null;
  messages?: Message[];
  onClose: () => void;
  scenarioId?: string;
  isLoading?: boolean;
  savingProgress?: 'idle' | 'evaluating' | 'saving-conversation' | 'saving-evaluation' | 'uploading-recording' | 'completed';
}

export function EvaluationSheet({ isOpen, evaluation, messages = [], onClose, scenarioId, isLoading = false, savingProgress = 'idle' }: EvaluationSheetProps) {
  const [activeTab, setActiveTab] = useState<'overall' | 'strengths' | 'improvements' | 'scores' | 'detailed'>(
    'overall'
  );
  const [copied, setCopied] = useState(false);

  // デバッグ: 評価データをコンソールに出力
  useEffect(() => {
    if (isOpen && evaluation) {
      console.log('[EvaluationSheet] 評価データ全体:', evaluation);
      console.log('[EvaluationSheet] detailedFeedback:', evaluation.detailedFeedback);
      console.log('[EvaluationSheet] detailedFeedbackの有無:', !!evaluation.detailedFeedback);
      if (evaluation.detailedFeedback) {
        console.log('[EvaluationSheet] questioning:', evaluation.detailedFeedback.questioning);
        console.log('[EvaluationSheet] listening:', evaluation.detailedFeedback.listening);
        console.log('[EvaluationSheet] proposing:', evaluation.detailedFeedback.proposing);
        console.log('[EvaluationSheet] closing:', evaluation.detailedFeedback.closing);
      }
    }
  }, [isOpen, evaluation]);

  if (!isOpen || !evaluation) return null;

  const handleDownloadCSV = () => {
    // 評価データをCSV出力用の形式に変換
    const evaluationData = {
      id: 'current',
      created_at: new Date().toISOString(),
      scenario_id: 'current_scenario',
      scores: {
        questioning_skill: evaluation.scores.questioning / 20, // 100点満点を5段階に戻す
        listening_skill: evaluation.scores.listening / 20,
        proposal_skill: evaluation.scores.proposing / 20,
        closing_skill: evaluation.scores.closing / 20,
      },
      total_score: evaluation.scores.total,
      average_score: evaluation.scores.total / 4,
      comments: {
        overall: evaluation.overall,
        strengths: evaluation.strengths,
        improvements: evaluation.improvements,
      },
    };

    downloadSingleEvaluationCSV(evaluationData, { messages });
  };

  const handleCopy = async () => {
    const text = [
      `【総評】\n${evaluation.overall}`,
      `\n【良かった点】\n${evaluation.strengths.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      `\n【改善点】\n${evaluation.improvements.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      `\n【スコア】\n${getSkillLabel('questioning', scenarioId)}: ${evaluation.scores.questioning}\n${getSkillLabel('listening', scenarioId)}: ${evaluation.scores.listening}\n${getSkillLabel('proposing', scenarioId)}: ${evaluation.scores.proposing}\n${getSkillLabel('closing', scenarioId)}: ${evaluation.scores.closing}\n総合: ${evaluation.scores.total}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('コピーに失敗しました', err);
    }
  };

  const tabs = [
    { id: 'overall' as const, label: '総評' },
    { id: 'strengths' as const, label: '良かった点' },
    { id: 'improvements' as const, label: '改善点' },
    { id: 'scores' as const, label: 'スコア' },
    { id: 'detailed' as const, label: '詳細分析' },
  ];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end md:items-center md:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evaluation-sheet-title"
    >
      {/* 背景オーバーレイ */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* シート本体 */}
      <div className="relative w-full md:w-[90%] lg:w-[800px] md:max-h-[90vh] bg-surface rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col max-h-[95vh] animate-in slide-in-from-bottom md:slide-in-from-bottom-4">
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-slate-200">
          <h2 id="evaluation-sheet-title" className="text-xl font-bold text-text">
            講評
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadCSV}
              className="btn-icon text-text-muted hover:text-primary"
              aria-label="CSV出力"
              title="CSV出力"
            >
              <Download size={20} />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="btn-icon text-text-muted hover:text-primary"
              aria-label="講評をコピー"
            >
              {copied ? <Check size={20} /> : <Copy size={20} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-icon text-text-muted hover:text-text"
              aria-label="シートを閉じる"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* 保存進捗インジケータ */}
        {(isLoading || savingProgress !== 'idle') && (
          <div className="px-4 md:px-6 py-3 bg-blue-50 border-b border-blue-200">
            <div className="flex items-center gap-3">
              <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
              <div className="flex-1">
                <div className="text-sm font-medium text-primary mb-1">
                  {savingProgress === 'evaluating' && '講評を生成中...'}
                  {savingProgress === 'saving-conversation' && '会話を保存中...'}
                  {savingProgress === 'saving-evaluation' && '評価を保存中...'}
                  {savingProgress === 'uploading-recording' && '録画データをアップロード中...'}
                  {savingProgress === 'completed' && '保存完了'}
                  {savingProgress === 'idle' && isLoading && '処理中...'}
                </div>
                <div className="w-full bg-blue-200 rounded-full h-1.5">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all duration-500"
                    style={{
                      width:
                        savingProgress === 'evaluating' ? '25%' :
                        savingProgress === 'saving-conversation' ? '50%' :
                        savingProgress === 'saving-evaluation' ? '75%' :
                        savingProgress === 'uploading-recording' ? '90%' :
                        savingProgress === 'completed' ? '100%' : '10%'
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* タブ */}
        <div className="flex border-b border-slate-200 overflow-x-auto scrollbar-thin min-h-[48px]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === tab.id
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text'
              }`}
              aria-selected={activeTab === tab.id}
              role="tab"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-thin">
          {activeTab === 'overall' && (
            <div className="space-y-4">
              <p className="text-slate-800 leading-7 whitespace-pre-wrap">{evaluation.overall}</p>
            </div>
          )}

          {activeTab === 'strengths' && (
            <div className="space-y-3">
              {evaluation.strengths.map((strength, index) => (
                <div key={index} className="glass-card p-4 border-l-2 border-green-400/50">
                  <p className="text-slate-800 leading-relaxed">{strength}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'improvements' && (
            <div className="space-y-3">
              {evaluation.improvements.map((improvement, index) => (
                <div key={index} className="glass-card p-4 border-l-2 border-orange-400/50">
                  <p className="text-slate-800 leading-relaxed">{improvement}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'scores' && (
            <div>
              {/* スコアカード */}
              <div className="space-y-4 mb-6">
                {/* スキル1 */}
                <div className="glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-slate-600">{getSkillLabel('questioning', scenarioId)}</div>
                    <div className="text-2xl font-bold text-slate-900">
                      {evaluation.scores.questioning}
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-[#6C5CE7] h-2 rounded-full transition-all duration-500"
                      style={{ width: `${evaluation.scores.questioning}%` }}
                    ></div>
                  </div>
                </div>

                {/* スキル2 */}
                <div className="glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-slate-600">{getSkillLabel('listening', scenarioId)}</div>
                    <div className="text-2xl font-bold text-slate-900">
                      {evaluation.scores.listening}
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-[#6C5CE7] h-2 rounded-full transition-all duration-500"
                      style={{ width: `${evaluation.scores.listening}%` }}
                    ></div>
                  </div>
                </div>

                {/* スキル3 */}
                <div className="glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-slate-600">{getSkillLabel('proposing', scenarioId)}</div>
                    <div className="text-2xl font-bold text-slate-900">
                      {evaluation.scores.proposing}
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-[#6C5CE7] h-2 rounded-full transition-all duration-500"
                      style={{ width: `${evaluation.scores.proposing}%` }}
                    ></div>
                  </div>
                </div>

                {/* スキル4 */}
                <div className="glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-slate-600">{getSkillLabel('closing', scenarioId)}</div>
                    <div className="text-2xl font-bold text-slate-900">
                      {evaluation.scores.closing}
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-[#6C5CE7] h-2 rounded-full transition-all duration-500"
                      style={{ width: `${evaluation.scores.closing}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* 総合スコア */}
              <div className="glass-card p-6 text-center border border-[#6C5CE7]/30">
                <div className="text-sm font-medium text-slate-600 mb-2">総合スコア</div>
                <div className="text-5xl font-bold text-[#6C5CE7] mb-1">
                  {Math.round(evaluation.scores.total / 4)}
                </div>
                <div className="text-sm text-slate-500">/ 100点</div>
              </div>

              {/* アクションプラン */}
              {evaluation.actionPlan && evaluation.actionPlan.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-slate-700 mb-3">次回への改善アクションプラン</h3>
                  <div className="space-y-3">
                    {evaluation.actionPlan.map((action, index) => (
                      <div key={index} className="glass-card p-4 border-l-2 border-[#6C5CE7]/50">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-[#6C5CE7] text-white rounded-full flex items-center justify-center font-medium text-xs">
                            {index + 1}
                          </div>
                          <p className="text-slate-800 flex-1 leading-relaxed text-sm">{action}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'detailed' && (
            <div className="space-y-6">
              {/* スキル1の詳細 */}
              {evaluation.detailedFeedback?.questioning && (
                <div className="glass-card p-5">
                  <h3 className="text-base font-semibold text-slate-900 mb-4">{getSkillLabel('questioning', scenarioId)}</h3>
                  {evaluation.detailedFeedback.questioning.rationale && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-slate-700 mb-2">評価理由</h4>
                      <p className="text-slate-800 leading-relaxed text-sm">
                        {evaluation.detailedFeedback.questioning.rationale}
                      </p>
                    </div>
                  )}
                  {evaluation.detailedFeedback.questioning.examples && evaluation.detailedFeedback.questioning.examples.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-slate-700 mb-2">具体例</h4>
                      <ul className="space-y-2">
                        {evaluation.detailedFeedback.questioning.examples.map((example, idx) => (
                          <li key={idx} className="bg-slate-50 p-3 rounded-lg text-sm text-slate-700 border-l-2 border-slate-300">
                            {example}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* スキル2の詳細 */}
              {evaluation.detailedFeedback?.listening && (
                <div className="glass-card p-5">
                  <h3 className="text-base font-semibold text-slate-900 mb-4">{getSkillLabel('listening', scenarioId)}</h3>
                  {evaluation.detailedFeedback.listening.rationale && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-slate-700 mb-2">評価理由</h4>
                      <p className="text-slate-800 leading-relaxed text-sm">
                        {evaluation.detailedFeedback.listening.rationale}
                      </p>
                    </div>
                  )}
                  {evaluation.detailedFeedback.listening.examples && evaluation.detailedFeedback.listening.examples.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-slate-700 mb-2">具体例</h4>
                      <ul className="space-y-2">
                        {evaluation.detailedFeedback.listening.examples.map((example, idx) => (
                          <li key={idx} className="bg-slate-50 p-3 rounded-lg text-sm text-slate-700 border-l-2 border-slate-300">
                            {example}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* スキル3の詳細 */}
              {evaluation.detailedFeedback?.proposing && (
                <div className="glass-card p-5">
                  <h3 className="text-base font-semibold text-slate-900 mb-4">{getSkillLabel('proposing', scenarioId)}</h3>
                  {evaluation.detailedFeedback.proposing.rationale && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-slate-700 mb-2">評価理由</h4>
                      <p className="text-slate-800 leading-relaxed text-sm">
                        {evaluation.detailedFeedback.proposing.rationale}
                      </p>
                    </div>
                  )}
                  {evaluation.detailedFeedback.proposing.examples && evaluation.detailedFeedback.proposing.examples.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-slate-700 mb-2">具体例</h4>
                      <ul className="space-y-2">
                        {evaluation.detailedFeedback.proposing.examples.map((example, idx) => (
                          <li key={idx} className="bg-slate-50 p-3 rounded-lg text-sm text-slate-700 border-l-2 border-slate-300">
                            {example}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* スキル4の詳細 */}
              {evaluation.detailedFeedback?.closing && (
                <div className="glass-card p-5">
                  <h3 className="text-base font-semibold text-slate-900 mb-4">{getSkillLabel('closing', scenarioId)}</h3>
                  {evaluation.detailedFeedback.closing.rationale && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-slate-700 mb-2">評価理由</h4>
                      <p className="text-slate-800 leading-relaxed text-sm">
                        {evaluation.detailedFeedback.closing.rationale}
                      </p>
                    </div>
                  )}
                  {evaluation.detailedFeedback.closing.examples && evaluation.detailedFeedback.closing.examples.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-slate-700 mb-2">具体例</h4>
                      <ul className="space-y-2">
                        {evaluation.detailedFeedback.closing.examples.map((example, idx) => (
                          <li key={idx} className="bg-slate-50 p-3 rounded-lg text-sm text-slate-700 border-l-2 border-slate-300">
                            {example}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* 詳細分析がない場合（4つのスキル全てが存在しない場合のみ） */}
              {(!evaluation.detailedFeedback ||
                (!evaluation.detailedFeedback.questioning &&
                 !evaluation.detailedFeedback.listening &&
                 !evaluation.detailedFeedback.proposing &&
                 !evaluation.detailedFeedback.closing)) && (
                <div className="glass-card p-8 text-center">
                  <h3 className="text-base font-semibold text-slate-900 mb-2">詳細分析データがありません</h3>
                  <p className="text-sm text-slate-600 mb-4">
                    新しく会話を開始して講評を受けると、各スキルの詳細な分析が表示されます
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

