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

