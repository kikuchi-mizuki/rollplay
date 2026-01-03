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
 * 録画ストリーム
 */
export interface RecordingStreams {
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
}

/**
 * 録画カスタムフック
 *
 * Phase 2 Day 4: MediaRecorder APIによる録画機能の実装
 * Phase 2 Day 6: Canvas合成録画の実装
 * - カメラストリームの録画
 * - 画面共有ストリームの録画
 * - Canvas合成録画（画面共有+カメラ）
 * - 録画時間のカウント
 * - Blob形式でのデータ保持
 *
 * @param streams - 録画対象のストリーム（カメラ、画面共有）
 * @returns 録画状態、制御関数、録画データ
 */
export function useRecording(streams: RecordingStreams) {
  const { cameraStream, screenStream } = streams;
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<RecordingError | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingData, setRecordingData] = useState<RecordingData | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingTimeRef = useRef<number>(0); // クロージャー問題を回避するためのRef

  // Phase 2 Day 6: Canvas合成用のRef
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  /**
   * 録画時間をカウントアップ（1秒ごと）
   */
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const newTime = prev + 1;
          recordingTimeRef.current = newTime; // Refも同期
          return newTime;
        });
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
   * Canvas合成ストリームを作成
   *
   * Phase 2 Day 6: 画面共有+カメラの合成録画
   * - 画面共有: 1920×1080（メイン）
   * - カメラ: 320×180（右下PinP）
   * - 30fpsで描画ループ
   */
  const createCompositeStream = useCallback((): MediaStream | null => {
    if (!screenStream || !cameraStream) {
      console.log('⚠️ Canvas合成スキップ: 画面共有またはカメラが未起動');
      return null;
    }

    console.log('🎨 Canvas合成ストリーム作成開始...');

    // Canvasを作成
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    canvasRef.current = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('❌ Canvasコンテキスト取得失敗');
      return null;
    }

    // video要素を作成（画面共有用）
    const screenVideo = document.createElement('video');
    screenVideo.srcObject = screenStream;
    screenVideo.autoplay = true;
    screenVideo.muted = true;

    // video要素を作成（カメラ用）
    const cameraVideo = document.createElement('video');
    cameraVideo.srcObject = cameraStream;
    cameraVideo.autoplay = true;
    cameraVideo.muted = true;

    // 描画ループ（30fps）
    const drawFrame = () => {
      if (!canvasRef.current) return;

      // 画面共有を全画面描画
      ctx.drawImage(screenVideo, 0, 0, 1920, 1080);

      // カメラを右下PinP描画（320×180）
      const pipWidth = 320;
      const pipHeight = 180;
      const pipX = 1920 - pipWidth - 20; // 右から20px
      const pipY = 1080 - pipHeight - 20; // 下から20px

      // PinP背景（黒枠）
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(pipX - 2, pipY - 2, pipWidth + 4, pipHeight + 4);

      // カメラ映像
      ctx.drawImage(cameraVideo, pipX, pipY, pipWidth, pipHeight);

      animationFrameRef.current = requestAnimationFrame(drawFrame);
    };

    // 描画開始
    drawFrame();

    // Canvasからストリームを取得（30fps）
    const compositeStream = canvas.captureStream(30);
    compositeStreamRef.current = compositeStream;

    console.log('✅ Canvas合成ストリーム作成完了');
    console.log(`  解像度: ${canvas.width}×${canvas.height}`);
    console.log(`  PinP: ${320}×${180} (右下)`);

    return compositeStream;
  }, [screenStream, cameraStream]);

  /**
   * 録画を開始
   *
   * 要件:
   * - 録画ボタンをクリックすると録画開始
   * - 録画中は「REC」インジケーターと時間が表示される
   * - 録画データはBlob形式で保持
   *
   * Phase 2 Day 6:
   * - 画面共有+カメラの場合、Canvas合成ストリームを録画
   * - カメラのみの場合、カメラストリームを録画
   */
  const startRecording = useCallback(async () => {
    // ストリームの優先順位:
    // 1. 画面共有+カメラ → Canvas合成
    // 2. カメラのみ
    // 3. ストリームなし → エラー
    let recordingStream: MediaStream | null = null;

    if (screenStream && cameraStream) {
      // Canvas合成（画面共有+カメラ）
      console.log('🎬 Canvas合成録画モード');
      recordingStream = createCompositeStream();
      if (!recordingStream) {
        setRecordingError('UnknownError');
        return;
      }
    } else if (cameraStream) {
      // カメラのみ
      console.log('🎬 カメラ録画モード');
      recordingStream = cameraStream;
    } else {
      // ストリームなし
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
      recordingTimeRef.current = 0; // Refもリセット
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

      const mediaRecorder = new MediaRecorder(recordingStream, options);
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
        const duration = recordingTimeRef.current; // Refを使用してクロージャー問題を回避
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
      const videoTrack = recordingStream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        console.log(`  解像度: ${settings.width}x${settings.height}`);
      }

    } catch (error: any) {
      console.error('❌ 録画開始エラー:', error);
      setRecordingError('UnknownError');
    }
  }, [cameraStream, screenStream, createCompositeStream]); // 依存配列を更新

  /**
   * 録画を停止
   *
   * Phase 2 Day 6: Canvas合成のクリーンアップも実施
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      console.log('🛑 録画停止中...');
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      // Canvas合成のクリーンアップ
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
        console.log('  Canvas描画ループ停止');
      }

      if (compositeStreamRef.current) {
        compositeStreamRef.current.getTracks().forEach(track => track.stop());
        compositeStreamRef.current = null;
        console.log('  Canvas合成ストリーム停止');
      }

      canvasRef.current = null;
    }
  }, [isRecording]);

  /**
   * 録画データをクリア
   */
  const clearRecording = useCallback(() => {
    setRecordingData(null);
    setRecordingTime(0);
    recordingTimeRef.current = 0; // Refもリセット
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
