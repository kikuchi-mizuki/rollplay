/**
 * メッセージの役割（送信者）
 */
export type MessageRole = 'bot' | 'user';

/**
 * チャットメッセージ
 */
export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  timestamp: Date;
}

/**
 * 講評データ
 */
export interface Evaluation {
  overall: string;
  strengths: string[];
  improvements: string[];
  scores: {
    questioning: number;
    listening: number;
    proposing: number;
    closing: number;
    total: number;
  };
}

/**
 * 録音状態
 */
export interface RecordingState {
  isRecording: boolean;
  duration: number; // 秒
  level: number; // 0-100
}

/**
 * ペルソナのベースプロフィール
 */
export interface PersonaBaseProfile {
  business_type?: string;
  location?: string;
  business_detail?: string;
  current_video_status?: string;
  age?: number;
  gender?: string;
  [key: string]: any; // その他の動的プロパティ
}

/**
 * SNSアカウント情報
 */
export interface PersonaSnsAccounts {
  [platform: string]: string;
}

/**
 * ペルソナ情報
 */
export interface Persona {
  persona_id: string;
  persona_name?: string;
  name?: string; // 後方互換性のため
  base_profile?: PersonaBaseProfile;
  voice_name?: string;
  speaking_rate?: number;
  sns_accounts?: PersonaSnsAccounts;
  [key: string]: any; // その他の動的プロパティ
}

