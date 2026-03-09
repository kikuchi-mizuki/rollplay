import { Message, Evaluation } from '../types';
import { fetchWithErrorHandling, APIError } from './errors';
import { supabase } from './supabase';
import logger from './logger';

// エラークラスを再エクスポート（他のコンポーネントで使用可能）
export { APIError, NetworkError, TimeoutError, getErrorMessage } from './errors';

// バックエンドAPIのベースURL
// 本番環境: VITE_API_BASE_URL環境変数を使用
// 開発環境: localhost:5001
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
                     (import.meta.env.DEV ? 'http://localhost:5001' : '');

// ===== CSRF保護 =====

// CSRFトークンのキャッシュ
let csrfToken: string | null = null;
let csrfTokenExpiry: number | null = null;

/**
 * CSRFトークンを取得
 * キャッシュされたトークンがあり、有効期限内であればそれを返す
 */
export async function getCsrfToken(): Promise<string> {
  // キャッシュされたトークンがあり、有効期限内であれば返す（30分）
  if (csrfToken && csrfTokenExpiry && Date.now() < csrfTokenExpiry) {
    return csrfToken;
  }

  try {
    // 認証トークンを取得
    const { data: { session } } = await supabase.auth.getSession();
    const authToken = session?.access_token;

    // CSRFトークンを取得
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`CSRFトークン取得失敗: ${response.status}`);
    }

    const result = await response.json();

    if (result.success && result.csrf_token) {
      const token: string = result.csrf_token;
      csrfToken = token;
      csrfTokenExpiry = Date.now() + 30 * 60 * 1000; // 30分
      return token;
    } else {
      throw new Error(result.error || 'CSRFトークン取得失敗');
    }
  } catch (error) {
    logger.error('CSRFトークン取得エラー:', error);
    throw error;
  }
}

/**
 * CSRFトークンをクリア（ログアウト時などに使用）
 */
export function clearCsrfToken() {
  csrfToken = null;
  csrfTokenExpiry = null;
}

/**
 * APIリクエストにCSRFトークンと認証トークンを追加
 */
async function addCsrfTokenToHeaders(headers: HeadersInit = {}): Promise<HeadersInit> {
  const csrfToken = await getCsrfToken();

  // 認証トークンを取得
  const { data: { session } } = await supabase.auth.getSession();
  const authToken = session?.access_token;

  const newHeaders: Record<string, string> = {
    ...(headers as Record<string, string>),
    'X-CSRF-Token': csrfToken,
  };

  if (authToken) {
    newHeaders['Authorization'] = `Bearer ${authToken}`;
  }

  return newHeaders;
}

/**
 * シナリオ一覧を取得
 */
export async function getScenarios(): Promise<{ id: string; title: string; enabled: boolean; category?: string }[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/scenarios`);
    const result = await response.json();

    if (result.success && result.scenarios) {
      return result.scenarios;
    } else {
      throw new Error(result.error || 'シナリオ取得に失敗しました');
    }
  } catch (error) {
    logger.error('シナリオ取得エラー:', error);
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

    // CSRFトークンを追加
    const headers = await addCsrfTokenToHeaders({
      'Content-Type': 'application/json',
    });

    const response = await fetchWithErrorHandling(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers,
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
      throw new APIError(result.error || 'メッセージ送信に失敗しました', response.status);
    }
  } catch (error) {
    logger.error('メッセージ送信エラー:', error);
    // エラーを適切に再スロー
    throw error;
  }
}

/**
 * 講評取得API（実際のバックエンド呼び出し）
 * @param history - 会話履歴
 * @param scenarioId - シナリオID（Week 5: Few-shot評価対応）
 */
export async function getEvaluation(history: Message[], scenarioId?: string): Promise<Evaluation> {
  try {
    // シナリオIDからカテゴリを判定（director_で始まるものはディレクター）
    const isDirector = scenarioId?.startsWith('director_') || scenarioId?.includes('director');
    const userSpeaker = isDirector ? 'ディレクター' : '営業';
    const assistantSpeaker = isDirector ? 'お客様' : '顧客';

    logger.info(`[講評API] シナリオ判定: scenarioId=${scenarioId}, isDirector=${isDirector}, userSpeaker=${userSpeaker}`);

    // 会話履歴をFlask形式に変換
    const conversation = history.map(msg => ({
      speaker: msg.role === 'user' ? userSpeaker : assistantSpeaker,
      text: msg.text
    }));

    // デバッグ: 送信するデータをログ出力
    logger.info(`[講評API] 送信データ: conversation.length=${conversation.length}, history.length=${history.length}`);
    if (conversation.length === 0) {
      logger.error('[講評API] ⚠️ 会話データが空です！');
    } else {
      logger.info(`[講評API] 最初のメッセージ: ${JSON.stringify(conversation[0])}`);
      logger.info(`[講評API] 最後のメッセージ: ${JSON.stringify(conversation[conversation.length - 1])}`);
    }

    // CSRFトークンを追加
    const headers = await addCsrfTokenToHeaders({
      'Content-Type': 'application/json',
    });

    const response = await fetchWithErrorHandling(`${API_BASE_URL}/api/evaluate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conversation: conversation,
        scenario_id: scenarioId  // Week 5: シナリオIDを送信
      })
    }, 60000); // 評価生成は時間がかかるため60秒タイムアウト

    const result = await response.json();
    
    if (result.success && result.evaluation) {
      const evalData = result.evaluation;

      // デバッグログ: 受信した評価データを出力
      logger.debug('[講評API] 受信データ:', evalData);
      logger.debug('[講評API] overall:', evalData.overall);
      logger.debug('[講評API] strengths:', evalData.strengths);
      logger.debug('[講評API] improvements:', evalData.improvements);

      // Flaskの評価結果をReactのEvaluation型に変換
      // 空配列・空文字列もチェックして、適切にフォールバック
      const overall = (evalData.overall && evalData.overall.trim() !== '')
        ? evalData.overall
        : (evalData.overall_comment && evalData.overall_comment.trim() !== '')
          ? evalData.overall_comment
          : evalData.comments?.join('. ') || '評価完了しました。';

      const strengths = (evalData.strengths && Array.isArray(evalData.strengths) && evalData.strengths.length > 0)
        ? evalData.strengths
        : (evalData.positive_points && Array.isArray(evalData.positive_points) && evalData.positive_points.length > 0)
          ? evalData.positive_points
          : evalData.comments?.filter((c: string) => c.startsWith('✅')) || ['評価データを確認中です。'];

      const improvements = (evalData.improvements && Array.isArray(evalData.improvements) && evalData.improvements.length > 0)
        ? evalData.improvements
        : (evalData.improvement_points && Array.isArray(evalData.improvement_points) && evalData.improvement_points.length > 0)
          ? evalData.improvement_points
          : evalData.comments?.filter((c: string) => c.startsWith('⚠️')) || ['継続的な練習で更なる向上を目指しましょう。'];

      logger.debug('[講評API] 変換後 overall:', overall);
      logger.debug('[講評API] 変換後 strengths:', strengths);
      logger.debug('[講評API] 変換後 improvements:', improvements);
      logger.debug('[講評API] detailedFeedback:', evalData.detailedFeedback);
      logger.debug('[講評API] actionPlan:', evalData.actionPlan);

      return {
        overall,
        strengths,
        improvements,
        scores: {
          // バックエンドで既に100点満点に変換済み（1-5点 × 20）なので、ここでは変換不要
          questioning: evalData.scores?.questioning_skill || evalData.scores?.questioning || 0,
          listening: evalData.scores?.listening_skill || evalData.scores?.listening || 0,
          proposing: evalData.scores?.proposal_skill || evalData.scores?.proposing || 0,
          closing: evalData.scores?.closing_skill || evalData.scores?.closing || 0,
          total: evalData.total_score || evalData.scores?.total || 0,
        },
        detailedFeedback: evalData.detailedFeedback,
        actionPlan: evalData.actionPlan,
      };
    } else {
      throw new APIError(result.error || '講評取得に失敗しました', response.status);
    }
  } catch (error) {
    logger.error('講評取得エラー:', error);
    // エラーを適切に再スロー
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
  persona?: any; // ペルソナ情報（会話内固定用）
}): Promise<{ conversationId: string }> {
  try {
    // CSRFトークンを追加
    const headers = await addCsrfTokenToHeaders({
      'Content-Type': 'application/json',
    });

    const response = await fetchWithErrorHandling(`${API_BASE_URL}/api/conversations`, {
      method: 'POST',
      headers,
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
        duration_seconds: params.durationSeconds,
        persona: params.persona // ペルソナ情報を送信
      })
    });

    const result = await response.json();

    if (result.success && result.conversation_id) {
      return { conversationId: result.conversation_id };
    } else {
      throw new APIError(result.error || '会話履歴の保存に失敗しました', response.status);
    }
  } catch (error) {
    logger.error('会話保存エラー:', error);
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
    // CSRFトークンを追加
    const headers = await addCsrfTokenToHeaders({
      'Content-Type': 'application/json',
    });

    const response = await fetchWithErrorHandling(`${API_BASE_URL}/api/evaluations`, {
      method: 'POST',
      headers,
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
      throw new APIError(result.error || '評価結果の保存に失敗しました', response.status);
    }
  } catch (error) {
    logger.error('評価保存エラー:', error);
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
    logger.error('会話履歴取得エラー:', error);
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
    logger.error('評価履歴取得エラー:', error);
    throw error;
  }
}

/**
 * 全店舗の統計情報を取得（本部管理者専用）
 */
export async function getStoresStats(): Promise<any> {
  try {
    // 認証トークンを取得
    const { data: { session } } = await supabase.auth.getSession();
    const authToken = session?.access_token;

    if (!authToken) {
      throw new Error('認証が必要です');
    }

    const response = await fetch(`${API_BASE_URL}/api/admin/stores/stats`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    const result = await response.json();

    if (result.success && result.stats) {
      return result.stats;
    } else {
      throw new Error(result.error || '統計情報の取得に失敗しました');
    }
  } catch (error) {
    logger.error('統計情報取得エラー:', error);
    throw error;
  }
}

/**
 * 店舗別ランキングを取得（本部管理者専用）
 */
export async function getStoresRankings(): Promise<any[]> {
  try {
    // 認証トークンを取得
    const { data: { session } } = await supabase.auth.getSession();
    const authToken = session?.access_token;

    if (!authToken) {
      throw new Error('認証が必要です');
    }

    const response = await fetch(`${API_BASE_URL}/api/admin/stores/rankings`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    const result = await response.json();

    if (result.success && result.rankings) {
      return result.rankings;
    } else {
      throw new Error(result.error || 'ランキング取得に失敗しました');
    }
  } catch (error) {
    logger.error('ランキング取得エラー:', error);
    throw error;
  }
}

/**
 * ログイン中のユーザー一覧を取得（本部管理者専用）
 */
export async function getOnlineUsers(thresholdMinutes: number = 5): Promise<any> {
  try {
    // 認証トークンを取得
    const { data: { session } } = await supabase.auth.getSession();
    const authToken = session?.access_token;

    if (!authToken) {
      throw new Error('認証が必要です');
    }

    const response = await fetch(`${API_BASE_URL}/api/admin/online-users?threshold=${thresholdMinutes}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    const result = await response.json();

    if (result.success) {
      return {
        onlineUsers: result.online_users,
        count: result.count,
        thresholdMinutes: result.threshold_minutes
      };
    } else {
      throw new Error(result.error || 'オンラインユーザー取得に失敗しました');
    }
  } catch (error) {
    logger.error('オンラインユーザー取得エラー:', error);
    throw error;
  }
}

/**
 * 全ユーザー一覧を取得（本部管理者専用）
 */
export async function getAllUsers(filters?: { store_id?: string; role?: string; search?: string }): Promise<any> {
  try {
    // 認証トークンを取得
    const { data: { session } } = await supabase.auth.getSession();
    const authToken = session?.access_token;

    if (!authToken) {
      throw new Error('認証が必要です');
    }

    const params = new URLSearchParams();
    if (filters?.store_id) params.append('store_id', filters.store_id);
    if (filters?.role) params.append('role', filters.role);
    if (filters?.search) params.append('search', filters.search);

    const url = `${API_BASE_URL}/api/admin/users${params.toString() ? '?' + params.toString() : ''}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    const result = await response.json();

    if (result.success) {
      return {
        users: result.users,
        count: result.count
      };
    } else {
      throw new Error(result.error || 'ユーザー一覧取得に失敗しました');
    }
  } catch (error) {
    logger.error('ユーザー一覧取得エラー:', error);
    throw error;
  }
}

/**
 * ユーザーを削除（本部管理者専用）
 */
export async function deleteUser(userId: string): Promise<void> {
  try {
    // CSRFトークンを追加
    const headers = await addCsrfTokenToHeaders({});

    const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers
    });
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'ユーザー削除に失敗しました');
    }
  } catch (error) {
    logger.error('ユーザー削除エラー:', error);
    throw error;
  }
}

/**
 * ユーザーの権限を変更（本部管理者専用）
 */
export async function updateUserRole(userId: string, role: 'admin' | 'manager' | 'user'): Promise<any> {
  try {
    // CSRFトークンを追加
    const headers = await addCsrfTokenToHeaders({
      'Content-Type': 'application/json'
    });

    const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/role`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ role })
    });
    const result = await response.json();

    if (result.success) {
      return result.user;
    } else {
      throw new Error(result.error || 'ユーザー権限変更に失敗しました');
    }
  } catch (error) {
    logger.error('ユーザー権限変更エラー:', error);
    throw error;
  }
}

/**
 * ユーザーの所属店舗を変更（本部管理者専用）
 */
export async function updateUserStore(userId: string, storeId: string): Promise<any> {
  try {
    // CSRFトークンを追加
    const headers = await addCsrfTokenToHeaders({
      'Content-Type': 'application/json'
    });

    const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/store`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ store_id: storeId })
    });
    const result = await response.json();

    if (result.success) {
      return result.user;
    } else {
      throw new Error(result.error || 'ユーザー店舗変更に失敗しました');
    }
  } catch (error) {
    logger.error('ユーザー店舗変更エラー:', error);
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
    logger.error('メンバー取得エラー:', error);
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
    logger.error('分析データ取得エラー:', error);
    throw error;
  }
}

/**
 * 録画ファイルをアップロード
 * セッション32: 練習履歴から録画ダウンロード機能
 *
 * @param conversationId - 会話ID
 * @param blob - 録画ファイル（Blob）
 * @param filename - ファイル名
 * @param duration - 録画時間（秒）
 */
export async function uploadRecording(
  conversationId: string,
  blob: Blob,
  filename: string,
  duration: number
): Promise<{ success: boolean; recording_url?: string; error?: string }> {
  try {
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('filename', filename);
    formData.append('duration', duration.toString());

    logger.info(`📤 録画アップロード開始: conversation_id=${conversationId}, filename=${filename}, size=${blob.size}`);

    // CSRFトークンを追加（Content-Typeは指定しない - FormDataで自動設定）
    const headers = await addCsrfTokenToHeaders({});

    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/conversations/${conversationId}/recording`,
      {
        method: 'POST',
        headers,
        body: formData
      },
      120000 // 120秒タイムアウト（大きなファイルのため）
    );

    const result = await response.json();

    if (result.success) {
      logger.info(`✅ 録画アップロード成功: url=${result.recording_url}`);
      return {
        success: true,
        recording_url: result.recording_url
      };
    } else {
      logger.error(`❌ 録画アップロード失敗: ${result.error}`);
      return {
        success: false,
        error: result.error || '録画のアップロードに失敗しました'
      };
    }
  } catch (error) {
    logger.error('録画アップロードエラー:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '録画のアップロードに失敗しました'
    };
  }
}

/**
 * 録画ファイルのURLを取得
 * セッション32: 練習履歴から録画ダウンロード機能
 *
 * @param conversationId - 会話ID
 */
export async function getRecordingUrl(
  conversationId: string
): Promise<{
  success: boolean;
  recording_url?: string;
  recording_filename?: string;
  recording_size_bytes?: number;
  recording_duration_seconds?: number;
  error?: string;
}> {
  try {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/conversations/${conversationId}/recording`,
      {
        method: 'GET'
      }
    );

    const result = await response.json();

    if (result.success) {
      return {
        success: true,
        recording_url: result.recording_url,
        recording_filename: result.recording_filename,
        recording_size_bytes: result.recording_size_bytes,
        recording_duration_seconds: result.recording_duration_seconds
      };
    } else {
      return {
        success: false,
        error: result.error || '録画情報の取得に失敗しました'
      };
    }
  } catch (error) {
    logger.error('録画URL取得エラー:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '録画情報の取得に失敗しました'
    };
  }
}

