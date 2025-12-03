import { X, Copy, Check, Download } from 'lucide-react';
import { useState } from 'react';
import { Evaluation, Message } from '../types';
import { downloadSingleEvaluationCSV } from '../lib/csv';

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
}

export function EvaluationSheet({ isOpen, evaluation, messages = [], onClose }: EvaluationSheetProps) {
  const [activeTab, setActiveTab] = useState<'overall' | 'strengths' | 'improvements' | 'scores'>(
    'overall'
  );
  const [copied, setCopied] = useState(false);

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
      `\n【スコア】\n質問力: ${evaluation.scores.questioning}\n傾聴力: ${evaluation.scores.listening}\n提案力: ${evaluation.scores.proposing}\nクロージング力: ${evaluation.scores.closing}\n総合: ${evaluation.scores.total}`,
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

        {/* タブ */}
        <div className="flex border-b border-slate-200 overflow-x-auto scrollbar-thin">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
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
            <div>
              <p className="text-text leading-7 whitespace-pre-wrap">{evaluation.overall}</p>
            </div>
          )}

          {activeTab === 'strengths' && (
            <div className="space-y-3">
              {evaluation.strengths.map((strength, index) => (
                <div key={index} className="card bg-success/5 border-l-4 border-success">
                  <p className="text-text">{strength}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'improvements' && (
            <div className="space-y-3">
              {evaluation.improvements.map((improvement, index) => (
                <div key={index} className="card bg-warn/5 border-l-4 border-warn">
                  <p className="text-text">{improvement}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'scores' && (
            <div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="card text-center">
                  <div className="text-sm text-text-muted mb-2">質問力</div>
                  <div className="text-2xl font-bold text-text">
                    {evaluation.scores.questioning}
                  </div>
                </div>
                <div className="card text-center">
                  <div className="text-sm text-text-muted mb-2">傾聴力</div>
                  <div className="text-2xl font-bold text-text">
                    {evaluation.scores.listening}
                  </div>
                </div>
                <div className="card text-center">
                  <div className="text-sm text-text-muted mb-2">提案力</div>
                  <div className="text-2xl font-bold text-text">
                    {evaluation.scores.proposing}
                  </div>
                </div>
                <div className="card text-center">
                  <div className="text-sm text-text-muted mb-2">クロージング力</div>
                  <div className="text-2xl font-bold text-text">
                    {evaluation.scores.closing}
                  </div>
                </div>
              </div>
              <div className="card bg-primary/5 text-center border-2 border-primary">
                <div className="text-sm text-text-muted mb-2">総合スコア</div>
                <div className="text-4xl font-bold text-primary">
                  {evaluation.scores.total}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

