import { Message, Evaluation } from '../types';

// バックエンドAPIのベースURL
// 本番環境: VITE_API_BASE_URL環境変数を使用
// 開発環境: localhost:5001
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
                     (import.meta.env.DEV ? 'http://localhost:5001' : '');

/**
 * シナリオ一覧を取得
 */
export async function getScenarios(): Promise<{ id: string; title: string; enabled: boolean }[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/scenarios`);
    const result = await response.json();

    if (result.success && result.scenarios) {
      return result.scenarios;
    } else {
      throw new Error(result.error || 'シナリオ取得に失敗しました');
    }
  } catch (error) {
    console.error('シナリオ取得エラー:', error);
    throw error;
  }
}

/**
 * メッセージ送信API（実際のバックエンド呼び出し）
 */
export async function sendMessage(message: string, history: Message[], scenarioId?: string): Promise<string> {
  try {
    // 会話履歴をFlask形式に変換
    const conversationHistory = history.map(msg => ({
      speaker: msg.role === 'user' ? '営業' : '顧客',
      text: msg.text
    }));

    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: message,
        history: conversationHistory,
        scenario_id: scenarioId
      })
    });

    const result = await response.json();
    
    if (result.success && result.response) {
      return result.response;
    } else {
      throw new Error(result.error || 'API呼び出しに失敗しました');
    }
  } catch (error) {
    console.error('メッセージ送信エラー:', error);
    throw error;
  }
}

/**
 * 講評取得API（実際のバックエンド呼び出し）
 */
export async function getEvaluation(history: Message[]): Promise<Evaluation> {
  try {
    // 会話履歴をFlask形式に変換
    const conversation = history.map(msg => ({
      speaker: msg.role === 'user' ? '営業' : '顧客',
      text: msg.text
    }));

    const response = await fetch(`${API_BASE_URL}/api/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation: conversation
      })
    });

    const result = await response.json();
    
    if (result.success && result.evaluation) {
      const evalData = result.evaluation;
      
      // Flaskの評価結果をReactのEvaluation型に変換
      return {
        overall: evalData.overall_comment || evalData.comments?.join('. ') || '評価完了しました。',
        strengths: evalData.positive_points || evalData.comments?.filter((c: string) => c.startsWith('✅')) || [],
        improvements: evalData.improvement_points || evalData.comments?.filter((c: string) => c.startsWith('⚠️')) || [],
        scores: {
          questioning: (evalData.scores?.questioning_skill || evalData.scores?.questioning || 0) * 20, // 5段階を100点満点に変換
          listening: (evalData.scores?.listening_skill || evalData.scores?.listening || 0) * 20,
          proposing: (evalData.scores?.proposal_skill || evalData.scores?.proposing || 0) * 20,
          closing: (evalData.scores?.closing_skill || evalData.scores?.closing || 0) * 20,
          total: (evalData.total_score || evalData.scores?.total || 0) * 20,
        },
      };
    } else {
      throw new Error(result.error || '講評取得に失敗しました');
    }
  } catch (error) {
    console.error('講評取得エラー:', error);
    throw error;
  }
}

/**
 * 会話履歴をSupabaseに保存
 */
export async function saveConversation(params: {
  userId: string;
  storeId: string;
  scenarioId: string;
  scenarioTitle: string;
  messages: Message[];
  durationSeconds?: number;
}): Promise<{ conversationId: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: params.userId,
        store_id: params.storeId,
        scenario_id: params.scenarioId,
        scenario_title: params.scenarioTitle,
        messages: params.messages.map(msg => ({
          role: msg.role,
          text: msg.text,
          timestamp: msg.timestamp
        })),
        duration_seconds: params.durationSeconds
      })
    });

    const result = await response.json();

    if (result.success && result.conversation_id) {
      return { conversationId: result.conversation_id };
    } else {
      throw new Error(result.error || '会話履歴の保存に失敗しました');
    }
  } catch (error) {
    console.error('会話保存エラー:', error);
    throw error;
  }
}

/**
 * 評価結果をSupabaseに保存
 */
export async function saveEvaluation(params: {
  conversationId: string;
  userId: string;
  storeId: string;
  scenarioId: string;
  evaluation: Evaluation;
}): Promise<{ evaluationId: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/evaluations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: params.conversationId,
        user_id: params.userId,
        store_id: params.storeId,
        scenario_id: params.scenarioId,
        scores: {
          questioning_skill: params.evaluation.scores.questioning / 20, // 100点満点を5段階に戻す
          listening_skill: params.evaluation.scores.listening / 20,
          proposal_skill: params.evaluation.scores.proposing / 20,
          closing_skill: params.evaluation.scores.closing / 20,
        },
        total_score: params.evaluation.scores.total,
        average_score: params.evaluation.scores.total / 4,
        comments: {
          overall: params.evaluation.overall,
          strengths: params.evaluation.strengths,
          improvements: params.evaluation.improvements,
        }
      })
    });

    const result = await response.json();

    if (result.success && result.evaluation_id) {
      return { evaluationId: result.evaluation_id };
    } else {
      throw new Error(result.error || '評価結果の保存に失敗しました');
    }
  } catch (error) {
    console.error('評価保存エラー:', error);
    throw error;
  }
}

/**
 * 会話履歴一覧を取得
 */
export async function getConversations(params: {
  userId: string;
  scenarioId?: string;
  limit?: number;
}): Promise<any[]> {
  try {
    const queryParams = new URLSearchParams({
      user_id: params.userId,
      ...(params.scenarioId && { scenario_id: params.scenarioId }),
      ...(params.limit && { limit: params.limit.toString() }),
    });

    const response = await fetch(`${API_BASE_URL}/api/conversations?${queryParams}`);
    const result = await response.json();

    if (result.success && result.conversations) {
      return result.conversations;
    } else {
      throw new Error(result.error || '会話履歴の取得に失敗しました');
    }
  } catch (error) {
    console.error('会話履歴取得エラー:', error);
    throw error;
  }
}

/**
 * 評価履歴一覧を取得
 */
export async function getEvaluations(params: {
  userId: string;
  scenarioId?: string;
  limit?: number;
}): Promise<any[]> {
  try {
    const queryParams = new URLSearchParams({
      user_id: params.userId,
      ...(params.scenarioId && { scenario_id: params.scenarioId }),
      ...(params.limit && { limit: params.limit.toString() }),
    });

    const response = await fetch(`${API_BASE_URL}/api/evaluations?${queryParams}`);
    const result = await response.json();

    if (result.success && result.evaluations) {
      return result.evaluations;
    } else {
      throw new Error(result.error || '評価履歴の取得に失敗しました');
    }
  } catch (error) {
    console.error('評価履歴取得エラー:', error);
    throw error;
  }
}

/**
 * 全店舗の統計情報を取得（本部管理者専用）
 */
export async function getStoresStats(): Promise<any> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/stores/stats`);
    const result = await response.json();

    if (result.success && result.stats) {
      return result.stats;
    } else {
      throw new Error(result.error || '統計情報の取得に失敗しました');
    }
  } catch (error) {
    console.error('統計情報取得エラー:', error);
    throw error;
  }
}

/**
 * 店舗別ランキングを取得（本部管理者専用）
 */
export async function getStoresRankings(): Promise<any[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/stores/rankings`);
    const result = await response.json();

    if (result.success && result.rankings) {
      return result.rankings;
    } else {
      throw new Error(result.error || 'ランキング取得に失敗しました');
    }
  } catch (error) {
    console.error('ランキング取得エラー:', error);
    throw error;
  }
}

/**
 * 店舗メンバー一覧を取得（店舗管理者・本部管理者）
 */
export async function getStoreMembers(storeId: string): Promise<any[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/stores/${storeId}/members`);
    const result = await response.json();

    if (result.success && result.members) {
      return result.members;
    } else {
      throw new Error(result.error || 'メンバー取得に失敗しました');
    }
  } catch (error) {
    console.error('メンバー取得エラー:', error);
    throw error;
  }
}

/**
 * 店舗分析データを取得（店舗管理者・本部管理者）
 */
export async function getStoreAnalytics(storeId: string): Promise<any> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/stores/${storeId}/analytics`);
    const result = await response.json();

    if (result.success) {
      return {
        store: result.store,
        scenarioAnalytics: result.scenario_analytics,
        totalEvaluations: result.total_evaluations
      };
    } else {
      throw new Error(result.error || '分析データ取得に失敗しました');
    }
  } catch (error) {
    console.error('分析データ取得エラー:', error);
    throw error;
  }
}

