import { Message, Evaluation } from '../types';

/**
 * メッセージ送信API（実際のバックエンド呼び出し）
 */
export async function sendMessage(message: string, history: Message[]): Promise<string> {
  try {
    // 会話履歴をFlask形式に変換
    const conversationHistory = history.map(msg => ({
      speaker: msg.role === 'user' ? '営業' : '顧客',
      text: msg.text
    }));

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: message,
        history: conversationHistory
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
export async function getEvaluation(history: Message[], _scenarioId?: string): Promise<Evaluation> {
  try {
    // 会話履歴をFlask形式に変換
    const conversation = history.map(msg => ({
      speaker: msg.role === 'user' ? '営業' : '顧客',
      text: msg.text
    }));

    const response = await fetch('/api/evaluate', {
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
        overall: evalData.overall || evalData.overall_comment || evalData.comments?.join('. ') || '評価完了しました。',
        strengths: evalData.strengths || evalData.positive_points || evalData.comments?.filter((c: string) => c.startsWith('✅')) || [],
        improvements: evalData.improvements || evalData.improvement_points || evalData.comments?.filter((c: string) => c.startsWith('⚠️')) || [],
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

