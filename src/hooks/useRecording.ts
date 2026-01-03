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
   * - 画面共有: 実際の解像度を使用（メイン）
   * - カメラ: 1/6サイズ（右下PinP）
   * - 30fpsで描画ループ
   * - 音声トラックも含める
   */
  const createCompositeStream = useCallback((): MediaStream | null => {
    if (!screenStream || !cameraStream) {
      console.log('⚠️ Canvas合成スキップ: 画面共有またはカメラが未起動');
      return null;
    }

    console.log('🎨 Canvas合成ストリーム作成開始...');

    // 画面共有の実際の解像度を取得
    const screenVideoTrack = screenStream.getVideoTracks()[0];
    const screenSettings = screenVideoTrack?.getSettings();
    const screenWidth = screenSettings?.width || 1920;
    const screenHeight = screenSettings?.height || 1080;

    console.log(`  画面共有解像度: ${screenWidth}x${screenHeight}`);

    // Canvasを作成（画面共有の解像度に合わせる）
    const canvas = document.createElement('canvas');
    canvas.width = screenWidth;
    canvas.height = screenHeight;
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
    screenVideo.playsInline = true;

    // video要素を作成（カメラ用）
    const cameraVideo = document.createElement('video');
    cameraVideo.srcObject = cameraStream;
    cameraVideo.autoplay = true;
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;

    console.log('🎥 video要素の準備中...');

    // video要素の準備完了を待つ
    let isScreenReady = false;
    let isCameraReady = false;

    screenVideo.onloadedmetadata = () => {
      console.log('✅ 画面共有video準備完了', {
        readyState: screenVideo.readyState,
        videoWidth: screenVideo.videoWidth,
        videoHeight: screenVideo.videoHeight,
      });
      isScreenReady = true;

      // 実際のvideoサイズに合わせてCanvasをリサイズ
      if (screenVideo.videoWidth > 0 && screenVideo.videoHeight > 0) {
        canvas.width = screenVideo.videoWidth;
        canvas.height = screenVideo.videoHeight;
        console.log(`📐 Canvas解像度を実際のvideoサイズに調整: ${canvas.width}x${canvas.height}`);
      }

      screenVideo.play().catch(err => console.warn('画面共有video再生エラー:', err));
    };

    cameraVideo.onloadedmetadata = () => {
      console.log('✅ カメラvideo準備完了', {
        readyState: cameraVideo.readyState,
        videoWidth: cameraVideo.videoWidth,
        videoHeight: cameraVideo.videoHeight,
      });
      isCameraReady = true;
      cameraVideo.play().catch(err => console.warn('カメラvideo再生エラー:', err));
    };

    // 描画ループ（30fps）
    const drawFrame = () => {
      if (!canvasRef.current) return;

      // video要素が準備できているかチェック（readyState >= 3 = HAVE_FUTURE_DATA）
      if (isScreenReady && isCameraReady &&
          screenVideo.readyState >= 3 && cameraVideo.readyState >= 3) {
        // 画面共有を全画面描画
        ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);

        // カメラを右下PinP描画（画面の1/6サイズ）
        const pipWidth = Math.floor(canvas.width / 6);
        const pipHeight = Math.floor(canvas.height / 6);
        const pipX = canvas.width - pipWidth - 20; // 右から20px
        const pipY = canvas.height - pipHeight - 20; // 下から20px

        // PinP背景（黒枠）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(pipX - 2, pipY - 2, pipWidth + 4, pipHeight + 4);

        // カメラ映像
        ctx.drawImage(cameraVideo, pipX, pipY, pipWidth, pipHeight);
      } else {
        // video要素がまだ準備できていない場合は黒背景を描画
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // デバッグ情報を描画
        ctx.fillStyle = 'white';
        ctx.font = '20px Arial';
        ctx.fillText('準備中...', canvas.width / 2 - 50, canvas.height / 2);
        ctx.font = '14px Arial';
        ctx.fillText(`画面共有: ${isScreenReady} (${screenVideo.readyState})`, 20, 40);
        ctx.fillText(`カメラ: ${isCameraReady} (${cameraVideo.readyState})`, 20, 60);
      }

      animationFrameRef.current = requestAnimationFrame(drawFrame);
    };

    // 描画開始
    drawFrame();

    // Canvasからストリームを取得（30fps）
    const compositeStream = canvas.captureStream(30);

    // 音声トラックを追加（画面共有の音声 + カメラの音声）
    const audioTracks: MediaStreamTrack[] = [];

    // 画面共有の音声トラック
    const screenAudioTracks = screenStream.getAudioTracks();
    if (screenAudioTracks.length > 0) {
      audioTracks.push(...screenAudioTracks);
      console.log(`  画面共有音声: ${screenAudioTracks.length}トラック追加`);
    }

    // カメラの音声トラック
    const cameraAudioTracks = cameraStream.getAudioTracks();
    if (cameraAudioTracks.length > 0) {
      audioTracks.push(...cameraAudioTracks);
      console.log(`  カメラ音声: ${cameraAudioTracks.length}トラック追加`);
    }

    // 音声トラックを合成ストリームに追加
    audioTracks.forEach(track => compositeStream.addTrack(track));

    compositeStreamRef.current = compositeStream;

    console.log('✅ Canvas合成ストリーム作成完了');
    console.log(`  解像度: ${canvas.width}×${canvas.height}`);
    console.log(`  PinPサイズ: ${Math.floor(canvas.width / 6)}×${Math.floor(canvas.height / 6)} (右下)`);
    console.log(`  音声トラック数: ${audioTracks.length}`);

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
    // 1. 画面共有のみ → 画面共有ストリームをそのまま録画（アプリ全体録画に最適）
    // 2. 画面共有+カメラ → Canvas合成（外部資料+カメラPinP）
    // 3. カメラのみ → カメラストリームを録画
    // 4. ストリームなし → エラー
    let recordingStream: MediaStream | null = null;

    if (screenStream && !cameraStream) {
      // 画面共有のみ（「このタブ」を共有している場合、アプリ全体が録画される）
      console.log('🎬 画面共有録画モード（アプリ全体録画）');
      recordingStream = screenStream;
    } else if (screenStream && cameraStream) {
      // Canvas合成（画面共有+カメラ）
      console.log('🎬 Canvas合成録画モード（外部資料+カメラPinP）');
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
      // WebM形式で録画（video+audio、VP8/VP9 + Opusコーデック、Chrome/Firefoxでサポート）
      const options: MediaRecorderOptions = {
        mimeType: 'video/webm;codecs=vp9,opus',
        audioBitsPerSecond: 128000, // 128kbps
        videoBitsPerSecond: 2500000, // 2.5Mbps
      };

      // VP9+Opusがサポートされていない場合はVP8+Opusにフォールバック
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        console.log('  VP9+Opus未対応、VP8+Opusを使用');
        options.mimeType = 'video/webm;codecs=vp8,opus';
      }

      // VP8+Opusも未対応の場合はデフォルトのコーデックを使用
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        console.log('  VP8+Opus未対応、デフォルトコーデックを使用');
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
   * 録画データをダウンロード
   *
   * Phase 2 Day 7: WebMファイルのダウンロード機能
   * - Blob + URL.createObjectURL()
   * - ファイル名: roleplay_YYYYMMDD_HHMMSS.webm
   */
  const downloadRecording = useCallback(() => {
    if (!recordingData) {
      console.warn('⚠️ ダウンロード: 録画データがありません');
      return;
    }

    console.log('💾 録画データダウンロード開始...');

    // ファイル名生成（roleplay_YYYYMMDD_HHMMSS.webm）
    const now = recordingData.timestamp;
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const filename = `roleplay_${year}${month}${day}_${hours}${minutes}${seconds}.webm`;

    // BlobからURLを作成
    const url = URL.createObjectURL(recordingData.blob);

    // <a>要素を作成してダウンロード
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // URLを解放
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);

    console.log('✅ ダウンロード完了');
    console.log(`  ファイル名: ${filename}`);
    console.log(`  サイズ: ${(recordingData.blob.size / 1024 / 1024).toFixed(2)} MB`);
  }, [recordingData]);

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
    downloadRecording, // Phase 2 Day 7: ダウンロード機能
    getErrorMessage,
    formatRecordingTime,
  };
}
