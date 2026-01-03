import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * 録画のエラータイプ
 */
export type RecordingError =
  | 'NoStreamError'        // ストリームが提供されていない
  | 'NotSupportedError'    // MediaRecorderがサポートされていない
  | 'UnknownError';        // その他のエラー

/**
 * 録画データ
 */
export interface RecordingData {
  blob: Blob;
  duration: number;
  timestamp: Date;
}

/**
 * 録画カスタムフック
 *
 * Phase 2 Day 4: MediaRecorder APIによる録画機能の実装
 * - カメラストリームの録画
 * - 録画時間のカウント
 * - Blob形式でのデータ保持
 *
 * @param stream - 録画対象のMediaStream（カメラストリーム）
 * @returns 録画状態、制御関数、録画データ
 */
export function useRecording(stream: MediaStream | null) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<RecordingError | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingData, setRecordingData] = useState<RecordingData | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * 録画時間をカウントアップ（1秒ごと）
   */
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  /**
   * 録画を開始
   *
   * 要件:
   * - 録画ボタンをクリックすると録画開始
   * - 録画中は「REC」インジケーターと時間が表示される
   * - 録画データはBlob形式で保持
   */
  const startRecording = useCallback(async () => {
    // ストリームが提供されていない場合はエラー
    if (!stream) {
      console.error('❌ 録画エラー: ストリームが提供されていません');
      setRecordingError('NoStreamError');
      return;
    }

    // MediaRecorderのサポート確認
    if (!window.MediaRecorder) {
      console.error('❌ 録画エラー: MediaRecorderがサポートされていません');
      setRecordingError('NotSupportedError');
      return;
    }

    try {
      console.log('🎬 録画開始...');

      // 録画データをリセット
      chunksRef.current = [];
      setRecordingTime(0);
      setRecordingData(null);
      setRecordingError(null);

      // MediaRecorderを作成
      // WebM形式で録画（VP8/VP9コーデック、Chrome/Firefoxでサポート）
      const options: MediaRecorderOptions = {
        mimeType: 'video/webm;codecs=vp9',
      };

      // VP9がサポートされていない場合はVP8にフォールバック
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        console.log('  VP9未対応、VP8を使用');
        options.mimeType = 'video/webm;codecs=vp8';
      }

      // VP8も未対応の場合はデフォルトのコーデックを使用
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        console.log('  VP8も未対応、デフォルトコーデックを使用');
        delete options.mimeType;
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      // 録画データが利用可能になったら保存
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
          console.log(`  録画データ受信: ${event.data.size} bytes`);
        }
      };

      // 録画停止時の処理
      mediaRecorder.onstop = () => {
        console.log('✅ 録画停止');
        console.log(`  総データサイズ: ${chunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0)} bytes`);

        // Blobを作成
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const duration = recordingTime;
        const timestamp = new Date();

        setRecordingData({
          blob,
          duration,
          timestamp,
        });

        console.log('✅ 録画データ保存完了');
        console.log(`  時間: ${duration}秒`);
        console.log(`  サイズ: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
      };

      // 録画エラー時の処理
      mediaRecorder.onerror = (event: Event) => {
        console.error('❌ 録画エラー:', event);
        setRecordingError('UnknownError');
        setIsRecording(false);
      };

      // 録画開始（1秒ごとにデータを取得）
      mediaRecorder.start(1000);
      setIsRecording(true);

      console.log('✅ 録画開始成功');
      console.log(`  MIMEタイプ: ${mediaRecorder.mimeType}`);
      console.log(`  ビットレート: ${stream.getVideoTracks()[0].getSettings().width}x${stream.getVideoTracks()[0].getSettings().height}`);

    } catch (error: any) {
      console.error('❌ 録画開始エラー:', error);
      setRecordingError('UnknownError');
    }
  }, [stream, recordingTime]);

  /**
   * 録画を停止
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      console.log('🛑 録画停止中...');
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  /**
   * 録画データをクリア
   */
  const clearRecording = useCallback(() => {
    setRecordingData(null);
    setRecordingTime(0);
    chunksRef.current = [];
    console.log('🗑️ 録画データをクリアしました');
  }, []);

  /**
   * エラーメッセージを取得
   */
  const getErrorMessage = useCallback((): string | null => {
    if (!recordingError) return null;

    switch (recordingError) {
      case 'NoStreamError':
        return 'カメラまたは画面共有を開始してから録画してください。';
      case 'NotSupportedError':
        return 'お使いのブラウザは録画機能に対応していません。Chrome、Firefox、Safariをお試しください。';
      case 'UnknownError':
        return '録画に失敗しました。ページを再読み込みしてください。';
      default:
        return '不明なエラーが発生しました。';
    }
  }, [recordingError]);

  /**
   * 録画時間をMM:SS形式にフォーマット
   */
  const formatRecordingTime = useCallback((): string => {
    const minutes = Math.floor(recordingTime / 60);
    const seconds = recordingTime % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [recordingTime]);

  return {
    isRecording,
    recordingError,
    recordingTime,
    recordingData,
    startRecording,
    stopRecording,
    clearRecording,
    getErrorMessage,
    formatRecordingTime,
  };
}
