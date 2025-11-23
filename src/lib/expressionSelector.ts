/**
 * アバター表情選択ロジック
 *
 * AIの返答テキストから感情を判定して、適切な表情タイプを選択します。
 */

export type ExpressionType = 'listening' | 'smile' | 'confused' | 'thinking' | 'nodding' | 'interested';

export interface AvatarExpression {
  avatar_id: string;
  avatar_name: string;
  expression_type: ExpressionType;
  expression_name: string;
  image_url: string;
  description?: string;
}

/**
 * AIの返答テキストから表情タイプを判定
 *
 * @param text AIの返答テキスト
 * @returns 表情タイプ
 */
export function selectExpressionType(text: string): ExpressionType {
  const lowerText = text.toLowerCase();

  // うなずく（同意・共感）
  const noddingKeywords = [
    'そうですね', 'なるほど', 'わかります', '確かに', '同感です',
    'おっしゃる通り', 'その通り', 'ですよね', 'そう思います'
  ];
  if (noddingKeywords.some(keyword => lowerText.includes(keyword))) {
    return 'nodding';
  }

  // 笑顔（ポジティブな反応）
  const smileKeywords = [
    'いいですね', '素晴らしい', '楽しみ', '嬉しい', 'ありがとう',
    '期待', 'ワクワク', 'よかった', '良さそう', '素敵'
  ];
  if (smileKeywords.some(keyword => lowerText.includes(keyword))) {
    return 'smile';
  }

  // 困惑（不安・疑問）
  const confusedKeywords = [
    'どうしよう', '不安', '心配', '難しい', 'わからない',
    'どうすれば', '迷って', '悩んで', 'うまくいかない'
  ];
  if (confusedKeywords.some(keyword => lowerText.includes(keyword))) {
    return 'confused';
  }

  // 考える（質問に対して検討中）
  const thinkingKeywords = [
    'そうですか', 'なるほど', '検討', '考えて', 'うーん',
    'どうかな', 'どうなんでしょう', 'どうでしょう'
  ];
  if (thinkingKeywords.some(keyword => lowerText.includes(keyword))) {
    return 'thinking';
  }

  // 興味を示す（提案に興味）
  const interestedKeywords = [
    'もっと聞きたい', '詳しく', '教えて', 'どんな', 'どういう',
    'もっと知りたい', '興味', 'どのように'
  ];
  if (interestedKeywords.some(keyword => lowerText.includes(keyword))) {
    return 'interested';
  }

  // デフォルト: 真剣に聞く
  return 'listening';
}

/**
 * ランダムにアバターIDを選択
 *
 * @returns アバターID（avatar_01, avatar_02, avatar_03）
 */
export function selectRandomAvatar(): string {
  const avatars = ['avatar_01', 'avatar_02', 'avatar_03'];
  return avatars[Math.floor(Math.random() * avatars.length)];
}

/**
 * アバター表情の画像URLを取得
 *
 * @param avatarId アバターID
 * @param expressionType 表情タイプ
 * @returns 画像URL
 */
export function getExpressionImageUrl(avatarId: string, expressionType: ExpressionType): string {
  return `/avatars/${avatarId}_${expressionType}.png`;
}

/**
 * AIの返答テキストから最適なアバター表情画像URLを取得
 *
 * @param text AIの返答テキスト
 * @param avatarId アバターID（指定しない場合はランダム）
 * @returns 画像URL
 */
export function getExpressionForResponse(text: string, avatarId?: string): string {
  const selectedAvatarId = avatarId || selectRandomAvatar();
  const expressionType = selectExpressionType(text);
  return getExpressionImageUrl(selectedAvatarId, expressionType);
}

/**
 * デフォルト表情（listening）の画像URLを取得
 *
 * @param avatarId アバターID（指定しない場合はavatar_01）
 * @returns 画像URL
 */
export function getDefaultExpression(avatarId: string = 'avatar_01'): string {
  return getExpressionImageUrl(avatarId, 'listening');
}

/**
 * アバターに応じた音声IDを取得（OpenAI TTS用）
 *
 * @param avatarId アバターID
 * @returns OpenAI TTS音声ID
 */
export function getVoiceForAvatar(avatarId: string): string {
  const voiceMap: Record<string, string> = {
    'avatar_01': 'alloy',    // 30代男性 - 落ち着いた声
    'avatar_02': 'nova',     // 40代女性 - 温かい女性の声
    'avatar_03': 'shimmer',  // 20代女性 - 明るい女性の声
  };

  return voiceMap[avatarId] || 'alloy';
}

/**
 * アバター表情の動画URLを取得（D-ID生成動画）
 *
 * @param avatarId アバターID
 * @param expressionType 表情タイプ
 * @returns 動画URL
 */
export function getExpressionVideoUrl(avatarId: string, expressionType: ExpressionType): string {
  return `/videos/${avatarId}/${expressionType}.mp4`;
}

/**
 * AIの返答テキストから最適なアバター表情動画URLを取得
 *
 * @param text AIの返答テキスト
 * @param avatarId アバターID（指定しない場合はランダム）
 * @returns 動画URL
 */
export function getVideoForResponse(text: string, avatarId?: string): string {
  const selectedAvatarId = avatarId || selectRandomAvatar();
  const expressionType = selectExpressionType(text);
  return getExpressionVideoUrl(selectedAvatarId, expressionType);
}

/**
 * デフォルト表情（listening）の動画URLを取得
 *
 * @param avatarId アバターID（指定しない場合はavatar_01）
 * @returns 動画URL
 */
export function getDefaultVideo(avatarId: string = 'avatar_01'): string {
  return getExpressionVideoUrl(avatarId, 'listening');
}
