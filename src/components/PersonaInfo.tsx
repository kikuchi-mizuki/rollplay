import { ChevronDown, ChevronUp, Building2, MapPin, User, DollarSign } from 'lucide-react';
import { useState } from 'react';
import { Persona } from '../types';

interface PersonaInfoProps {
  persona: Persona | null;
  isVisible: boolean;
}

/**
 * 顧客情報の常時表示コンポーネント
 * 会話中も選択したペルソナ情報を表示
 */
export function PersonaInfo({ persona, isVisible }: PersonaInfoProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isVisible || !persona) return null;

  return (
    <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
      {/* ヘッダー */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <User className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-bold text-white">顧客情報</h3>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>

      {/* コンテンツ */}
      {isExpanded && (
        <div className="p-4 pt-0 space-y-4">
          {/* ペルソナ名 */}
          <div>
            <h4 className="text-xl font-bold text-white mb-2">{persona.persona_name}</h4>
          </div>

          {/* 基本情報 */}
          <div className="space-y-2">
            {persona.base_profile?.business_type && (
              <div className="flex items-start gap-2">
                <Building2 className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500">業種</div>
                  <div className="text-sm text-gray-200">{persona.base_profile.business_type}</div>
                </div>
              </div>
            )}

            {persona.base_profile?.location && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500">地域</div>
                  <div className="text-sm text-gray-200">{persona.base_profile.location}</div>
                </div>
              </div>
            )}

            {(persona as any).company_details?.role && (
              <div className="flex items-start gap-2">
                <User className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500">役職</div>
                  <div className="text-sm text-gray-200">{(persona as any).company_details.role}</div>
                </div>
              </div>
            )}

            {persona.base_profile?.budget_sense && (
              <div className="flex items-start gap-2">
                <DollarSign className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500">予算感</div>
                  <div className="text-sm text-yellow-300 font-semibold">
                    {persona.base_profile.budget_sense}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 企業規模 */}
          {(persona as any).company_details?.employees && (persona as any).company_details?.revenue && (
            <div className="pt-3 border-t border-gray-700">
              <div className="text-xs text-gray-500 mb-2">企業規模</div>
              <div className="flex items-center gap-4 text-sm text-gray-300">
                <span>{(persona as any).company_details.employees}</span>
                <span className="text-gray-600">|</span>
                <span>{(persona as any).company_details.revenue}</span>
              </div>
            </div>
          )}

          {/* 課題 */}
          {persona.base_profile?.pain_points && Array.isArray(persona.base_profile.pain_points) && (
            <div className="pt-3 border-t border-gray-700">
              <div className="text-xs text-gray-500 mb-2">主な課題</div>
              <ul className="space-y-1">
                {persona.base_profile.pain_points.slice(0, 3).map((point: string, idx: number) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-red-400 text-xs mt-1">●</span>
                    <span className="text-xs text-gray-300 leading-relaxed">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 現状 */}
          {persona.base_profile?.current_video_status && (
            <div className="pt-3 border-t border-gray-700">
              <div className="text-xs text-gray-500 mb-2">動画制作の現状</div>
              <p className="text-xs text-gray-300 leading-relaxed">
                {persona.base_profile.current_video_status}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
