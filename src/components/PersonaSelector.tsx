import { useState, useEffect } from 'react';

interface PersonaSelectorProps {
  isOpen: boolean;
  onSelect: (personaId: string) => void;
  onClose: () => void;
}

interface Persona {
  persona_id: string;
  persona_name: string;
  base_profile: {
    business_type: string;
    location: string;
    business_detail: string;
    current_video_status: string;
    budget_sense: string;
    pain_points: string[];
  };
  company_details: {
    employees: string;
    revenue: string;
    role: string;
  };
}

/**
 * ペルソナ選択モーダルコンポーネント
 * 会話開始前に10個のペルソナから選択できる
 */
export function PersonaSelector({ isOpen, onSelect, onClose }: PersonaSelectorProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      // ペルソナ一覧を取得
      fetch('/api/scenarios/personas')
        .then(res => res.json())
        .then(data => {
          setPersonas(data.personas || []);
          setLoading(false);
        })
        .catch(err => {
          console.error('ペルソナ取得エラー:', err);
          setLoading(false);
        });
    }
  }, [isOpen]);

  const handleSelect = (personaId: string) => {
    setSelectedPersonaId(personaId);
  };

  const handleConfirm = () => {
    if (selectedPersonaId) {
      onSelect(selectedPersonaId);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[85vh] overflow-hidden border border-gray-700">
        {/* ヘッダー */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-6">
          <h2 className="text-2xl font-bold text-white mb-2">顧客ペルソナを選択</h2>
          <p className="text-purple-100 text-sm">
            営業ロープレの相手となる顧客を選んでください（10パターン）
          </p>
        </div>

        {/* コンテンツ */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {personas.map((persona) => (
                <div
                  key={persona.persona_id}
                  onClick={() => handleSelect(persona.persona_id)}
                  className={`
                    cursor-pointer rounded-xl p-5 border-2 transition-all
                    ${selectedPersonaId === persona.persona_id
                      ? 'border-purple-500 bg-purple-500/10 shadow-lg shadow-purple-500/20'
                      : 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800'
                    }
                  `}
                >
                  {/* ペルソナ名 */}
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-bold text-white flex-1">
                      {persona.persona_name}
                    </h3>
                    {selectedPersonaId === persona.persona_id && (
                      <div className="ml-2 flex-shrink-0">
                        <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* 業種・地域 */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-full border border-blue-500/30">
                      {persona.base_profile.business_type}
                    </span>
                    <span className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded-full border border-green-500/30">
                      {persona.base_profile.location}
                    </span>
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-300 text-xs rounded-full border border-purple-500/30">
                      {persona.company_details.role}
                    </span>
                  </div>

                  {/* 事業詳細 */}
                  <p className="text-gray-300 text-sm mb-3 line-clamp-2">
                    {persona.base_profile.business_detail}
                  </p>

                  {/* 課題 */}
                  <div className="space-y-1 mb-3">
                    {persona.base_profile.pain_points.slice(0, 2).map((point, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="text-red-400 text-xs mt-0.5">●</span>
                        <span className="text-gray-400 text-xs">{point}</span>
                      </div>
                    ))}
                  </div>

                  {/* 予算感 */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-700">
                    <div className="text-xs text-gray-500">予算感</div>
                    <div className="text-sm font-semibold text-yellow-400">
                      {persona.base_profile.budget_sense}
                    </div>
                  </div>

                  {/* 企業規模 */}
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs text-gray-500">企業規模</div>
                    <div className="text-xs text-gray-400">
                      {persona.company_details.employees} / {persona.company_details.revenue}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="bg-gray-900 p-6 border-t border-gray-700 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedPersonaId}
            className={`
              px-8 py-2 rounded-lg font-semibold transition-all
              ${selectedPersonaId
                ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white shadow-lg'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }
            `}
          >
            この顧客で開始
          </button>
        </div>
      </div>
    </div>
  );
}
