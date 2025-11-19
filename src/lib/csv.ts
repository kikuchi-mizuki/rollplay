/**
 * CSV出力ユーティリティ
 */

interface EvaluationData {
  id: string;
  created_at: string;
  scenario_id: string;
  scores: {
    questioning_skill: number;
    listening_skill: number;
    proposal_skill: number;
    closing_skill: number;
  };
  total_score: number;
  average_score: number;
  comments?: {
    overall?: string;
    strengths?: string[];
    improvements?: string[];
  };
}

interface ConversationData {
  id: string;
  created_at: string;
  scenario_id: string;
  scenario_title: string;
  duration_seconds: number;
  messages: any[];
}

/**
 * 評価データをCSV形式に変換してダウンロード
 */
export function downloadEvaluationsCSV(evaluations: EvaluationData[], filename: string = 'evaluations.csv') {
  if (evaluations.length === 0) {
    alert('ダウンロードするデータがありません');
    return;
  }

  // CSVヘッダー
  const headers = [
    '日時',
    'シナリオID',
    '質問力',
    '傾聴力',
    '提案力',
    'クロージング力',
    '合計スコア',
    '平均スコア',
    '総評',
    '良かった点',
    '改善点',
  ];

  // データ行を作成
  const rows = evaluations.map(evaluation => {
    const date = new Date(evaluation.created_at);
    const formattedDate = date.toLocaleString('ja-JP');

    return [
      formattedDate,
      evaluation.scenario_id,
      evaluation.scores.questioning_skill,
      evaluation.scores.listening_skill,
      evaluation.scores.proposal_skill,
      evaluation.scores.closing_skill,
      evaluation.total_score,
      evaluation.average_score.toFixed(2),
      `"${evaluation.comments?.overall?.replace(/"/g, '""') || ''}"`,
      `"${evaluation.comments?.strengths?.join(', ').replace(/"/g, '""') || ''}"`,
      `"${evaluation.comments?.improvements?.join(', ').replace(/"/g, '""') || ''}"`,
    ];
  });

  // CSV文字列を生成
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  // BOMを追加（Excelで文字化けしないように）
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });

  // ダウンロード
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 会話データをCSV形式に変換してダウンロード
 */
export function downloadConversationsCSV(conversations: ConversationData[], filename: string = 'conversations.csv') {
  if (conversations.length === 0) {
    alert('ダウンロードするデータがありません');
    return;
  }

  // CSVヘッダー
  const headers = [
    '日時',
    'シナリオID',
    'シナリオ名',
    '所要時間（秒）',
    'メッセージ数',
  ];

  // データ行を作成
  const rows = conversations.map(conversation => {
    const date = new Date(conversation.created_at);
    const formattedDate = date.toLocaleString('ja-JP');

    return [
      formattedDate,
      conversation.scenario_id,
      `"${conversation.scenario_title || ''}"`,
      conversation.duration_seconds || 0,
      conversation.messages?.length || 0,
    ];
  });

  // CSV文字列を生成
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  // BOMを追加（Excelで文字化けしないように）
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });

  // ダウンロード
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 単一の評価データをCSV形式に変換してダウンロード
 */
export function downloadSingleEvaluationCSV(
  evaluation: EvaluationData,
  conversation: { messages: any[] },
  filename?: string
) {
  const date = new Date(evaluation.created_at);
  const formattedDate = date.toLocaleDateString('ja-JP').replace(/\//g, '-');
  const defaultFilename = `evaluation_${formattedDate}.csv`;

  // CSVヘッダー
  const headers = ['項目', '内容'];

  // データ行を作成
  const rows = [
    ['日時', new Date(evaluation.created_at).toLocaleString('ja-JP')],
    ['シナリオID', evaluation.scenario_id],
    ['', ''],
    ['【スコア】', ''],
    ['質問力', evaluation.scores.questioning_skill],
    ['傾聴力', evaluation.scores.listening_skill],
    ['提案力', evaluation.scores.proposal_skill],
    ['クロージング力', evaluation.scores.closing_skill],
    ['合計スコア', evaluation.total_score],
    ['平均スコア', evaluation.average_score.toFixed(2)],
    ['', ''],
    ['【総評】', `"${evaluation.comments?.overall?.replace(/"/g, '""') || ''}"`],
    ['', ''],
    ['【良かった点】', ''],
    ...(evaluation.comments?.strengths || []).map((s: string) => ['', `"${s.replace(/"/g, '""')}"`]),
    ['', ''],
    ['【改善点】', ''],
    ...(evaluation.comments?.improvements || []).map((i: string) => ['', `"${i.replace(/"/g, '""')}"`]),
    ['', ''],
    ['【会話履歴】', ''],
    ['発言者', '内容'],
    ...(conversation.messages || []).map((msg: any) => [
      msg.role === 'user' ? '営業' : '顧客',
      `"${msg.text.replace(/"/g, '""')}"`,
    ]),
  ];

  // CSV文字列を生成
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  // BOMを追加（Excelで文字化けしないように）
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });

  // ダウンロード
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename || defaultFilename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
