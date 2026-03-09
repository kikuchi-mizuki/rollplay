import { useState, useEffect } from 'react';
import { getScenarios } from '../lib/api';

interface PersonaSelectorProps {
  isOpen: boolean;
  onSelect: (personaId: string, scenarioId: string, difficulty?: 'beginner' | 'intermediate' | 'advanced', personaData?: Persona) => void;
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

interface Scenario {
  id: string;
  title: string;
  enabled: boolean;
  category?: string;
}

/**
 * ペルソナ選択モーダルコンポーネント
 * 会話開始前に10個のペルソナから選択できる
 */
export function PersonaSelector({ isOpen, onSelect, onClose }: PersonaSelectorProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<'sales' | 'director'>('sales');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');

  useEffect(() => {
    if (isOpen) {
      // シナリオ一覧とペルソナ一覧を取得
      Promise.all([
        getScenarios(),
        fetch('/api/scenarios/personas').then(res => res.json())
      ])
        .then(([scenariosData, personasData]) => {
          const fetchedScenarios = scenariosData || [];
          setScenarios(fetchedScenarios);
          setPersonas(personasData.personas || []);

          // デフォルトシナリオを設定（営業の最初のシナリオ）
          const salesScenarios = fetchedScenarios.filter((s: Scenario) => s.enabled && s.category === 'sales');
          if (salesScenarios.length > 0) {
            setSelectedScenarioId(salesScenarios[0].id);
          }

          setLoading(false);
        })
        .catch(err => {
          console.error('データ取得エラー:', err);
          setLoading(false);
        });
    }
  }, [isOpen]);

  // ロール変更時にシナリオを自動切り替え
  useEffect(() => {
    if (scenarios.length > 0) {
      const filteredScenarios = scenarios.filter(s => s.enabled && s.category === selectedRole);
      if (filteredScenarios.length > 0 && !filteredScenarios.find(s => s.id === selectedScenarioId)) {
        setSelectedScenarioId(filteredScenarios[0].id);
      }
    }
  }, [selectedRole, scenarios]);

  const handleSelect = (personaId: string) => {
    setSelectedPersonaId(personaId);
  };

  const handleConfirm = () => {
    if (selectedPersonaId && selectedScenarioId) {
      const selectedPersona = personas.find(p => p.persona_id === selectedPersonaId);
      onSelect(selectedPersonaId, selectedScenarioId, selectedDifficulty, selectedPersona);
      onClose();
    }
  };

  const handleRandomSelect = () => {
    if (personas.length > 0 && selectedScenarioId) {
      const randomIndex = Math.floor(Math.random() * personas.length);
      const randomPersona = personas[randomIndex];

      // デバッグ: 選択されたシナリオを確認
      const selectedScenario = scenarios.find(s => s.id === selectedScenarioId);
      console.log('[おまかせ] 選択されたシナリオID:', selectedScenarioId);
      console.log('[おまかせ] 選択されたシナリオ:', selectedScenario);
      console.log('[おまかせ] ランダムペルソナ:', randomPersona.persona_name);

      onSelect(randomPersona.persona_id, selectedScenarioId, selectedDifficulty, randomPersona);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[150] p-0 sm:p-4">
      <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-5xl w-full h-[90vh] sm:max-h-[85vh] overflow-hidden border-t border-x sm:border border-gray-700 flex flex-col">
        {/* ヘッダー */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-4 sm:p-6 flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">ロープレ設定</h2>
          <p className="text-purple-100 text-xs sm:text-sm">
            ロール・シナリオ・難易度・顧客を選択してください
          </p>
        </div>

        {/* コンテンツ */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
            </div>
          ) : (
            <>
              {/* ロール選択 */}
              <div className="mb-4 sm:mb-6">
                <h3 className="text-white font-semibold mb-3 text-sm sm:text-base">1. ロール選択</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setSelectedRole('sales')}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      selectedRole === 'sales'
                        ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/20'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-center">
                      <div className="text-2xl mb-1">💼</div>
                      <div className={`font-semibold text-base ${selectedRole === 'sales' ? 'text-blue-400' : 'text-gray-300'}`}>
                        営業として練習
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        クライアントへの提案営業
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => setSelectedRole('director')}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      selectedRole === 'director'
                        ? 'border-purple-500 bg-purple-500/10 shadow-lg shadow-purple-500/20'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-center">
                      <div className="text-2xl mb-1">🎬</div>
                      <div className={`font-semibold text-base ${selectedRole === 'director' ? 'text-purple-400' : 'text-gray-300'}`}>
                        ディレクターとして練習
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        制作要件のヒアリング・提案
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* シナリオ選択 */}
              <div className="mb-4 sm:mb-6">
                <h3 className="text-white font-semibold mb-3 text-sm sm:text-base">2. シナリオ選択</h3>
                <select
                  value={selectedScenarioId}
                  onChange={(e) => setSelectedScenarioId(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border-2 border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500 transition-colors"
                >
                  {scenarios
                    .filter(s => s.enabled && s.category === selectedRole)
                    .map(scenario => (
                      <option key={scenario.id} value={scenario.id}>
                        {scenario.title}
                      </option>
                    ))}
                </select>
              </div>

              {/* 難易度選択 */}
              <div className="mb-4 sm:mb-6">
                <h3 className="text-white font-semibold mb-3 text-sm sm:text-base">3. 難易度レベル</h3>
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <button
                    onClick={() => setSelectedDifficulty('beginner')}
                    className={`p-2 sm:p-4 rounded-lg border-2 transition-all ${
                      selectedDifficulty === 'beginner'
                        ? 'border-green-500 bg-green-500/10 shadow-lg shadow-green-500/20'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl mb-1">⭐</div>
                      <div className={`font-semibold text-sm sm:text-base ${selectedDifficulty === 'beginner' ? 'text-green-400' : 'text-gray-300'}`}>
                        初級
                      </div>
                      <div className="text-xs text-gray-500 mt-1 hidden sm:block">
                        優しく丁寧な対応
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => setSelectedDifficulty('intermediate')}
                    className={`p-2 sm:p-4 rounded-lg border-2 transition-all ${
                      selectedDifficulty === 'intermediate'
                        ? 'border-yellow-500 bg-yellow-500/10 shadow-lg shadow-yellow-500/20'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl mb-1">⭐⭐</div>
                      <div className={`font-semibold text-sm sm:text-base ${selectedDifficulty === 'intermediate' ? 'text-yellow-400' : 'text-gray-300'}`}>
                        中級
                      </div>
                      <div className="text-xs text-gray-500 mt-1 hidden sm:block">
                        標準的な対応
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => setSelectedDifficulty('advanced')}
                    className={`p-2 sm:p-4 rounded-lg border-2 transition-all ${
                      selectedDifficulty === 'advanced'
                        ? 'border-red-500 bg-red-500/10 shadow-lg shadow-red-500/20'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl mb-1">⭐⭐⭐</div>
                      <div className={`font-semibold text-sm sm:text-base ${selectedDifficulty === 'advanced' ? 'text-red-400' : 'text-gray-300'}`}>
                        上級
                      </div>
                      <div className="text-xs text-gray-500 mt-1 hidden sm:block">
                        厳しい質問あり
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* ペルソナ選択 */}
              <div className="mb-3">
                <h3 className="text-white font-semibold mb-3 text-sm sm:text-base">4. 顧客ペルソナ選択</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              {personas.map((persona) => (
                <div
                  key={persona.persona_id}
                  onClick={() => handleSelect(persona.persona_id)}
                  className={`
                    cursor-pointer rounded-xl p-4 sm:p-5 border-2 transition-all
                    ${selectedPersonaId === persona.persona_id
                      ? 'border-purple-500 bg-purple-500/10 shadow-lg shadow-purple-500/20'
                      : 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800'
                    }
                  `}
                >
                  {/* ペルソナ名 */}
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-base sm:text-lg font-bold text-white flex-1 break-words pr-2">
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
                  <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-3">
                    <span className="px-2 py-0.5 sm:py-1 bg-blue-500/20 text-blue-300 text-[10px] sm:text-xs rounded-full border border-blue-500/30 whitespace-nowrap">
                      {persona.base_profile.business_type}
                    </span>
                    <span className="px-2 py-0.5 sm:py-1 bg-green-500/20 text-green-300 text-[10px] sm:text-xs rounded-full border border-green-500/30 whitespace-nowrap">
                      {persona.base_profile.location}
                    </span>
                    <span className="px-2 py-0.5 sm:py-1 bg-purple-500/20 text-purple-300 text-[10px] sm:text-xs rounded-full border border-purple-500/30 whitespace-nowrap">
                      {persona.company_details.role}
                    </span>
                  </div>

                  {/* 事業詳細 */}
                  <p className="text-gray-300 text-xs sm:text-sm mb-3 break-words overflow-hidden"
                     style={{
                       display: '-webkit-box',
                       WebkitLineClamp: 2,
                       WebkitBoxOrient: 'vertical',
                       overflow: 'hidden'
                     }}>
                    {persona.base_profile.business_detail}
                  </p>

                  {/* 課題 */}
                  <div className="space-y-1 mb-3">
                    {persona.base_profile.pain_points.slice(0, 2).map((point, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="text-red-400 text-xs mt-0.5 flex-shrink-0">●</span>
                        <span className="text-gray-400 text-xs break-words">{point}</span>
                      </div>
                    ))}
                  </div>

                  {/* 予算感 */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-700">
                    <div className="text-[10px] sm:text-xs text-gray-500">予算感</div>
                    <div className="text-xs sm:text-sm font-semibold text-yellow-400 break-words text-right">
                      {persona.base_profile.budget_sense}
                    </div>
                  </div>

                  {/* 企業規模 */}
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-[10px] sm:text-xs text-gray-500">企業規模</div>
                    <div className="text-[10px] sm:text-xs text-gray-400 break-words text-right">
                      {persona.company_details.employees} / {persona.company_details.revenue}
                    </div>
                  </div>
                </div>
              ))}
              </div>
            </>
          )}
        </div>

        {/* フッター */}
        <div className="bg-gray-900 p-4 sm:p-6 border-t border-gray-700 flex-shrink-0">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm sm:text-base order-3 sm:order-1"
            >
              キャンセル
            </button>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 order-1 sm:order-2">
              <button
                onClick={handleRandomSelect}
                disabled={loading || personas.length === 0}
                className="px-6 py-2 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-white rounded-lg font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                title="ランダムに顧客を選択します"
              >
                おまかせ
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selectedPersonaId}
                className={`
                  px-6 py-2 rounded-lg font-semibold transition-all text-sm sm:text-base
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
      </div>
    </div>
  );
}
