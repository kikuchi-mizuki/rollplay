/**
 * CSV出力ユーティリティ
 */

/**
 * データをCSV形式に変換してダウンロード
 */
export function downloadCSV(data: any[], filename: string, headers: string[]) {
  // ヘッダー行
  const csvRows = [headers.join(',')];

  // データ行
  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header] || '';
      // 値をエスケープ（カンマ、改行、ダブルクォートを含む場合）
      const escaped = String(value).replace(/"/g, '""');
      return escaped.includes(',') || escaped.includes('\n') || escaped.includes('"')
        ? `"${escaped}"`
        : escaped;
    });
    csvRows.push(values.join(','));
  });

  // BOM付きUTF-8で出力（Excelで文字化け防止）
  const csvContent = '\uFEFF' + csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  // ダウンロード
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  // クリーンアップ
  URL.revokeObjectURL(url);
}

/**
 * 評価履歴をCSV出力
 */
export function downloadEvaluationsCSV(
  evaluations: any[],
  getScenarioTitle: (id: string) => string
) {
  const data = evaluations.map(e => ({
    created_at: new Date(e.created_at).toLocaleString('ja-JP'),
    scenario: getScenarioTitle(e.scenario_id),
    average_score: e.average_score.toFixed(2),
    questioning_skill: e.scores.questioning_skill.toFixed(2),
    listening_skill: e.scores.listening_skill.toFixed(2),
    proposal_skill: e.scores.proposal_skill.toFixed(2),
    closing_skill: e.scores.closing_skill.toFixed(2),
    total_score: e.total_score
  }));

  const headers = [
    'created_at',
    'scenario',
    'average_score',
    'questioning_skill',
    'listening_skill',
    'proposal_skill',
    'closing_skill',
    'total_score'
  ];

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `evaluations_${timestamp}.csv`;
  downloadCSV(data, filename, headers);
}

/**
 * 会話履歴をCSV出力
 */
export function downloadConversationsCSV(
  conversations: any[],
  getScenarioTitle: (id: string) => string
) {
  const data = conversations.map(c => {
    const messageCount = c.messages?.length || 0;
    const userMessages = c.messages?.filter((m: any) => m.role === 'user').length || 0;
    const botMessages = c.messages?.filter((m: any) => m.role === 'bot').length || 0;

    return {
      created_at: new Date(c.created_at).toLocaleString('ja-JP'),
      scenario: getScenarioTitle(c.scenario_id),
      message_count: messageCount,
      user_messages: userMessages,
      bot_messages: botMessages,
      duration_seconds: c.duration_seconds || 0,
      duration_minutes: ((c.duration_seconds || 0) / 60).toFixed(1)
    };
  });

  const headers = [
    'created_at',
    'scenario',
    'message_count',
    'user_messages',
    'bot_messages',
    'duration_seconds',
    'duration_minutes'
  ];

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `conversations_${timestamp}.csv`;
  downloadCSV(data, filename, headers);
}

/**
 * 単一の評価をCSV出力（講評シート用）
 */
export function downloadSingleEvaluationCSV(
  evaluation: any,
  _options?: { messages?: any[] }
) {
  const data = [{
    created_at: new Date(evaluation.created_at).toLocaleString('ja-JP'),
    scenario_id: evaluation.scenario_id,
    average_score: evaluation.average_score.toFixed(2),
    questioning_skill: evaluation.scores.questioning_skill.toFixed(2),
    listening_skill: evaluation.scores.listening_skill.toFixed(2),
    proposal_skill: evaluation.scores.proposal_skill.toFixed(2),
    closing_skill: evaluation.scores.closing_skill.toFixed(2),
    total_score: evaluation.total_score,
    overall_comment: evaluation.comments?.overall || '',
    strengths: evaluation.comments?.strengths?.join('; ') || '',
    improvements: evaluation.comments?.improvements?.join('; ') || ''
  }];

  const headers = [
    'created_at',
    'scenario_id',
    'average_score',
    'questioning_skill',
    'listening_skill',
    'proposal_skill',
    'closing_skill',
    'total_score',
    'overall_comment',
    'strengths',
    'improvements'
  ];

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `evaluation_${timestamp}.csv`;
  downloadCSV(data, filename, headers);
}
