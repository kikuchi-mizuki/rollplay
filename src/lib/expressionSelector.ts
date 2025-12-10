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
 * 会話の文脈からシーンタイプを判定
 */
type ConversationContext = 'initial_greeting' | 'sharing_concerns' | 'asking_questions' | 'positive_interest' | 'hesitation' | 'agreement' | 'neutral';

/**
 * 表情判定用のメッセージ型
 */
export interface ExpressionMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * 会話履歴から文脈を分析
 */
function analyzeConversationContext(
  currentResponse: string,
  recentMessages: ExpressionMessage[] = [],
  userMessage: string = ''
): ConversationContext {
  const lowerResponse = currentResponse.toLowerCase();
  const lowerUserMsg = userMessage.toLowerCase();

  // 1. 営業の質問内容を分析（ユーザーメッセージ）
  const userIsAskingAbout = {
    concerns: ['困って', '悩み', '課題', '問題', '不安', '心配'].some(k => lowerUserMsg.includes(k)),
    interest: ['興味', '詳しく', '教えて', 'どんな', 'どういう'].some(k => lowerUserMsg.includes(k)),
    price: ['料金', '費用', '価格', '予算', 'いくら'].some(k => lowerUserMsg.includes(k)),
    examples: ['事例', '実績', '他の', '例えば'].some(k => lowerUserMsg.includes(k)),
    proposal: ['提案', 'おすすめ', 'プラン', 'サービス'].some(k => lowerUserMsg.includes(k)),
  };

  // 2. 会話の流れを分析（直近3ターン）
  const recentContext = recentMessages.slice(-3);
  const isEarlyConversation = recentMessages.length < 4; // 最初の2-3ターン
  const hasPositiveFlow = recentContext.some(m =>
    m.text.includes('いいですね') || m.text.includes('ありがとう') || m.text.includes('素晴らしい')
  );

  // 3. AI返答の内容から感情・態度を判定
  const responseContains = {
    // 困惑・悩み（強い感情）
    strongConcern: ['どうしよう', 'うまくいかない', '困って', '焦って', '全然ダメ', 'なかなか伸びない'].some(k => lowerResponse.includes(k)),
    // 軽い懸念・疑問
    mildConcern: ['わからない', 'どうなんでしょう', '不安', '心配', '難しい'].some(k => lowerResponse.includes(k)),
    // 前向き・ポジティブ
    positive: ['いいですね', '楽しみ', '嬉しい', '素晴らしい', '期待'].some(k => lowerResponse.includes(k)),
    // 同意・共感
    agreement: ['そうですね', 'なるほど', 'わかります', '確かに', 'おっしゃる通り'].some(k => lowerResponse.includes(k)),
    // 検討中
    thinking: ['考えて', '検討', 'うーん', 'どうかな'].some(k => lowerResponse.includes(k)),
    // 質問・興味
    asking: ['どんな', 'どういう', '詳しく', '教えて', 'もっと'].some(k => lowerResponse.includes(k)),
  };

  // 4. 文脈に基づいて判定
  // 優先度が高い順にチェック

  // 強い困惑・悩みの表現 → confused
  if (responseContains.strongConcern || (userIsAskingAbout.concerns && responseContains.mildConcern)) {
    return 'sharing_concerns';
  }

  // 前向きな反応 → positive_interest
  if (responseContains.positive || (hasPositiveFlow && responseContains.agreement)) {
    return 'positive_interest';
  }

  // 同意・共感の表現 → agreement
  if (responseContains.agreement && !responseContains.mildConcern) {
    return 'agreement';
  }

  // 検討・思考中 → hesitation
  if (responseContains.thinking || (userIsAskingAbout.price && responseContains.mildConcern)) {
    return 'hesitation';
  }

  // 質問・興味を示す → asking_questions
  if (responseContains.asking || userIsAskingAbout.interest || userIsAskingAbout.examples) {
    return 'asking_questions';
  }

  // 会話の初期段階 → initial_greeting
  if (isEarlyConversation && !responseContains.strongConcern) {
    return 'initial_greeting';
  }

  // それ以外 → neutral
  return 'neutral';
}

/**
 * 文脈から適切な表情を選択
 */
function contextToExpression(context: ConversationContext): ExpressionType {
  const contextMap: Record<ConversationContext, ExpressionType> = {
    'initial_greeting': 'listening',      // 最初は真剣に聞く姿勢
    'sharing_concerns': 'confused',       // 悩み・困惑を共有
    'asking_questions': 'interested',     // 質問・興味
    'positive_interest': 'smile',         // 前向き・ポジティブ
    'hesitation': 'thinking',             // 検討中・迷い
    'agreement': 'nodding',               // 同意・共感
    'neutral': 'listening',               // ニュートラル
  };

  return contextMap[context];
}

/**
 * AIの返答テキストから表情タイプを判定（文脈ベース）
 *
 * @param text AIの返答テキスト
 * @param recentMessages 直近の会話履歴（オプション）
 * @param userMessage 営業の質問内容（オプション）
 * @returns 表情タイプ
 */
export function selectExpressionType(
  text: string,
  recentMessages?: ExpressionMessage[],
  userMessage?: string
): ExpressionType {
  // 文脈を分析
  const context = analyzeConversationContext(text, recentMessages || [], userMessage || '');

  // 文脈から表情を選択
  const expression = contextToExpression(context);

  console.log(`[表情判定] 文脈: ${context} → 表情: ${expression}`);

  return expression;
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
 * AIの返答テキストから最適なアバター表情画像URLを取得（文脈ベース）
 *
 * @param text AIの返答テキスト
 * @param avatarId アバターID（指定しない場合はランダム）
 * @param recentMessages 直近の会話履歴（オプション）
 * @param userMessage 営業の質問内容（オプション）
 * @returns 画像URL
 */
export function getExpressionForResponse(
  text: string,
  avatarId?: string,
  recentMessages?: ExpressionMessage[],
  userMessage?: string
): string {
  const selectedAvatarId = avatarId || selectRandomAvatar();
  const expressionType = selectExpressionType(text, recentMessages, userMessage);
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
    'avatar_03': 'nova',     // 20代女性 - 自然な女性の声（日本語に適している）
  };

  return voiceMap[avatarId] || 'nova';
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
