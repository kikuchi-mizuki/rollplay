import { useState, useRef, useCallback, useEffect } from 'react';
import type React from 'react';
import RecordRTC from 'recordrtc';

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
  avatarImageSrc?: string; // アバター画像のパス（カメラのみモードでCanvas合成に使用）
  avatarImageSrcRef?: React.MutableRefObject<string | undefined>; // アバター画像のRef（録画中の表情変化に対応）
  aiAudioStream?: MediaStream | null; // AI音声出力のストリーム（Web Audio API）
  audioDestinationRef?: React.MutableRefObject<MediaStreamAudioDestinationNode | null>; // AI音声Destinationのref（ステート更新タイミング問題を回避）
  screenStreamRef?: React.MutableRefObject<MediaStream | null>; // 画面共有のRef（録画中の画面共有開始に対応）
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
  const { cameraStream, screenStream, avatarImageSrc, avatarImageSrcRef, aiAudioStream, audioDestinationRef, screenStreamRef } = streams;
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<RecordingError | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingData, setRecordingData] = useState<RecordingData | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordRTCRef = useRef<RecordRTC | null>(null); // RecordRTCレコーダー
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingTimeRef = useRef<number>(0); // クロージャー問題を回避するためのRef
  const useRecordRTC = useRef<boolean>(true); // RecordRTCを使用するかどうか（AI音声録音問題の対策）
  const isStoppingRef = useRef<boolean>(false); // 停止処理中フラグ（二重停止防止）

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
   * カメラのみの場合のCanvas合成ストリームを作成
   *
   * - カメラ映像を全画面表示（1920x1080）
   * - アバター画像を左上にPinP表示
   * - 30fpsで描画ループ
   * - 音声トラックも含める
   */
  const createCameraOnlyCompositeStream = useCallback((): MediaStream | null => {
    if (!cameraStream) {
      console.log('⚠️ カメラCanvas合成スキップ: カメラが未起動');
      return null;
    }

    console.log('🎨 カメラのみCanvas合成ストリーム作成開始...');

    // Canvas解像度を1920x1080に固定（カメラのみの場合）
    const canvasWidth = 1920;
    const canvasHeight = 1080;

    console.log(`  Canvas解像度: ${canvasWidth}x${canvasHeight}`);

    // Canvasを作成
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvasRef.current = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('❌ Canvasコンテキスト取得失敗');
      return null;
    }

    // video要素を作成（カメラ用）
    const cameraVideo = document.createElement('video');
    cameraVideo.srcObject = cameraStream;
    cameraVideo.autoplay = true;
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;

    // video要素を作成（画面共有用 - 途中から開始される可能性あり）
    let screenVideo: HTMLVideoElement | null = null;
    let isScreenReady = false;

    // アバター画像を読み込み（存在する場合）
    let avatarImage: HTMLImageElement | null = null;
    let lastAvatarImageSrc: string | undefined = undefined; // 前回のアバター画像URL

    // 初期アバター画像を読み込み
    const initialAvatarSrc = avatarImageSrcRef?.current || avatarImageSrc;
    if (initialAvatarSrc) {
      avatarImage = new Image();
      avatarImage.src = initialAvatarSrc;
      lastAvatarImageSrc = initialAvatarSrc;
      console.log(`  初期アバター画像読み込み: ${initialAvatarSrc}`);
    }

    console.log('🎥 video要素の準備中...');

    // video要素の準備完了を待つ
    let isCameraReady = false;

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

      // 画面共有が途中から開始された場合の処理（Refから最新の値を取得）
      const currentScreenStream = screenStreamRef?.current;
      if (currentScreenStream && !screenVideo) {
        console.log('🔄 [録画中] 画面共有開始を検出 → 描画を切り替えます');
        screenVideo = document.createElement('video');
        screenVideo.srcObject = currentScreenStream;
        screenVideo.autoplay = true;
        screenVideo.muted = true;
        screenVideo.playsInline = true;

        screenVideo.onloadedmetadata = () => {
          console.log('✅ [録画中] 画面共有video準備完了');
          screenVideo!.play().then(() => {
            isScreenReady = true;
            console.log('▶️ [録画中] 画面共有video再生開始');
          }).catch(err => console.warn('画面共有video再生エラー:', err));
        };
      }

      // アバター画像の変更をチェック（録画中の表情変化に対応）
      const currentAvatarSrc = avatarImageSrcRef?.current;
      if (currentAvatarSrc && currentAvatarSrc !== lastAvatarImageSrc) {
        console.log(`🔄 アバター画像更新: ${lastAvatarImageSrc} → ${currentAvatarSrc}`);
        avatarImage = new Image();
        avatarImage.src = currentAvatarSrc;
        lastAvatarImageSrc = currentAvatarSrc;
      }

      // 画面共有が利用可能な場合は画面共有を描画（カメラ+アバターをPinP）
      if (screenVideo && isScreenReady && screenVideo.readyState >= 2) {
        // 背景を黒で塗りつぶし
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 画面共有を全画面描画
        try {
          ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
        } catch (err) {
          console.error('❌ 画面共有描画エラー:', err);
        }

        // カメラを右下PinP描画（画面の1/6サイズ）
        if (isCameraReady && cameraVideo.readyState >= 2) {
          const pipWidth = Math.floor(canvas.width / 6);
          const pipHeight = Math.floor(canvas.height / 6);
          const cameraPipX = canvas.width - pipWidth - 20;
          const cameraPipY = canvas.height - pipHeight - 20;

          // カメラPinP背景（黒枠）
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(cameraPipX - 2, cameraPipY - 2, pipWidth + 4, pipHeight + 4);

          // カメラ映像（aspect-fitで描画）
          const cameraAspect = cameraVideo.videoWidth / cameraVideo.videoHeight;
          const pipAspect = pipWidth / pipHeight;

          let cameraDrawWidth = pipWidth;
          let cameraDrawHeight = pipHeight;
          let cameraDrawX = cameraPipX;
          let cameraDrawY = cameraPipY;

          if (cameraAspect > pipAspect) {
            cameraDrawHeight = pipWidth / cameraAspect;
            cameraDrawY = cameraPipY + (pipHeight - cameraDrawHeight) / 2;
          } else {
            cameraDrawWidth = pipHeight * cameraAspect;
            cameraDrawX = cameraPipX + (pipWidth - cameraDrawWidth) / 2;
          }

          ctx.drawImage(cameraVideo, cameraDrawX, cameraDrawY, cameraDrawWidth, cameraDrawHeight);

          // アバターを左下PinP描画
          if (avatarImage && avatarImage.complete) {
            const avatarPipX = 20;
            const avatarPipY = canvas.height - pipHeight - 20;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(avatarPipX - 2, avatarPipY - 2, pipWidth + 4, pipHeight + 4);

            const avatarAspect = avatarImage.width / avatarImage.height;
            let avatarDrawWidth = pipWidth;
            let avatarDrawHeight = pipHeight;
            let avatarDrawX = avatarPipX;
            let avatarDrawY = avatarPipY;

            if (avatarAspect > pipAspect) {
              avatarDrawHeight = pipWidth / avatarAspect;
              avatarDrawY = avatarPipY + (pipHeight - avatarDrawHeight) / 2;
            } else {
              avatarDrawWidth = pipHeight * avatarAspect;
              avatarDrawX = avatarPipX + (pipWidth - avatarDrawWidth) / 2;
            }

            ctx.drawImage(avatarImage, avatarDrawX, avatarDrawY, avatarDrawWidth, avatarDrawHeight);
          }
        }
      } else if (isCameraReady && cameraVideo.readyState >= 2) {
        // 画面共有がない場合、カメラ映像を全画面描画（aspect-fitで中央配置）
        const videoAspect = cameraVideo.videoWidth / cameraVideo.videoHeight;
        const canvasAspect = canvas.width / canvas.height;

        let drawWidth = canvas.width;
        let drawHeight = canvas.height;
        let drawX = 0;
        let drawY = 0;

        if (videoAspect > canvasAspect) {
          // ビデオが横長 → 幅を合わせる
          drawHeight = canvas.width / videoAspect;
          drawY = (canvas.height - drawHeight) / 2;
        } else {
          // ビデオが縦長 → 高さを合わせる
          drawWidth = canvas.height * videoAspect;
          drawX = (canvas.width - drawWidth) / 2;
        }

        // 背景を黒で塗りつぶし
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // カメラ映像を描画
        ctx.drawImage(cameraVideo, drawX, drawY, drawWidth, drawHeight);

        // アバターを左上PinP描画（画面の1/6サイズ）
        if (avatarImage && avatarImage.complete) {
          const pipWidth = Math.floor(canvas.width / 6);
          const pipHeight = Math.floor(canvas.height / 6);
          const pipX = 20; // 左から20px
          const pipY = 20; // 上から20px

          // PinP背景（黒枠）
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(pipX - 2, pipY - 2, pipWidth + 4, pipHeight + 4);

          // アバター画像（aspect-fitで描画）
          const avatarAspect = avatarImage.width / avatarImage.height;
          const pipAspect = pipWidth / pipHeight;

          let avatarDrawWidth = pipWidth;
          let avatarDrawHeight = pipHeight;
          let avatarDrawX = pipX;
          let avatarDrawY = pipY;

          if (avatarAspect > pipAspect) {
            // 画像が横長 → 幅を合わせる
            avatarDrawHeight = pipWidth / avatarAspect;
            avatarDrawY = pipY + (pipHeight - avatarDrawHeight) / 2;
          } else {
            // 画像が縦長 → 高さを合わせる
            avatarDrawWidth = pipHeight * avatarAspect;
            avatarDrawX = pipX + (pipWidth - avatarDrawWidth) / 2;
          }

          ctx.drawImage(avatarImage, avatarDrawX, avatarDrawY, avatarDrawWidth, avatarDrawHeight);
        }
      } else {
        // video要素がまだ準備できていない場合は黒背景を描画
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // デバッグ情報を描画
        ctx.fillStyle = 'white';
        ctx.font = '20px Arial';
        ctx.fillText('準備中...', canvas.width / 2 - 50, canvas.height / 2);
        ctx.font = '14px Arial';
        ctx.fillText(`カメラ: ${isCameraReady} (${cameraVideo.readyState})`, 20, 40);
      }

      animationFrameRef.current = requestAnimationFrame(drawFrame);
    };

    // 描画開始
    drawFrame();

    // Canvasからストリームを取得（30fps）
    const compositeStream = canvas.captureStream(30);

    // ========================================
    // 音声トラックの手動ミキシング（AI音声録音問題の根本対策）
    // ========================================
    // 問題: ChromeのMediaRecorderは、Web Audio APIで生成した音声トラックを
    //       正しくエンコードできない可能性がある
    // 解決策: 2つの音声（カメラマイク + AI音声）をWeb Audio APIで
    //        1つの音声トラックにミックスしてからMediaRecorderに渡す
    // ========================================

    console.log('🎵 音声トラックの手動ミキシング開始...');

    // AudioContextを作成（音声ミキシング用）
    const mixerContext = new AudioContext();

    // ミキサーGainNodeを作成
    const mixerGain = mixerContext.createGain();
    mixerGain.gain.value = 1.0;

    // MediaStreamDestinationを作成（ミックス後の音声出力先）
    const mixedDestination = mixerContext.createMediaStreamDestination();
    mixerGain.connect(mixedDestination);

    let cameraSourceConnected = false;
    let aiSourceConnected = false;

    // カメラの音声をミキサーに接続
    const cameraAudioTracks = cameraStream.getAudioTracks();
    if (cameraAudioTracks.length > 0) {
      try {
        // カメラ音声用のMediaStreamを作成（クローンしたトラックを使用）
        const cameraAudioStream = new MediaStream(cameraAudioTracks.map(t => t.clone()));
        const cameraSource = mixerContext.createMediaStreamSource(cameraAudioStream);
        cameraSource.connect(mixerGain);
        cameraSourceConnected = true;
        console.log('  ✅ カメラ音声をミキサーに接続');
      } catch (err) {
        console.warn('  ⚠️ カメラ音声のミキサー接続失敗:', err);
      }
    }

    // AI音声をミキサーに接続
    const aiStream = audioDestinationRef?.current?.stream || aiAudioStream;
    if (aiStream) {
      const aiAudioTracks = aiStream.getAudioTracks();
      if (aiAudioTracks.length > 0) {
        try {
          const aiSource = mixerContext.createMediaStreamSource(aiStream);
          aiSource.connect(mixerGain);
          aiSourceConnected = true;
          console.log('  ✅ AI音声をミキサーに接続');
        } catch (err) {
          console.warn('  ⚠️ AI音声のミキサー接続失敗:', err);
        }
      } else {
        console.warn('  ⚠️ AI音声: トラックなし');
      }
    } else {
      console.warn('  ⚠️ AI音声: aiStreamがnull');
    }

    console.log(`🎵 音声ミキシング完了:`);
    console.log(`   - カメラ音声: ${cameraSourceConnected ? '✅' : '❌'}`);
    console.log(`   - AI音声: ${aiSourceConnected ? '✅' : '❌'}`);
    console.log(`   - ミックス後の音声トラック数: ${mixedDestination.stream.getAudioTracks().length}`);

    // ミックス後の音声トラックを合成ストリームに追加
    const mixedAudioTracks = mixedDestination.stream.getAudioTracks();
    mixedAudioTracks.forEach(track => {
      track.enabled = true;
      compositeStream.addTrack(track);
      console.log(`  🎵 ミックス済み音声トラック追加: enabled=${track.enabled}, readyState=${track.readyState}`);
    });

    compositeStreamRef.current = compositeStream;

    console.log('✅ カメラのみCanvas合成ストリーム作成完了');
    console.log(`  解像度: ${canvas.width}×${canvas.height}`);
    console.log(`  アバター: ${avatarImage ? 'あり（左上PinP）' : 'なし'}`);
    console.log(`  音声トラック数: ${mixedAudioTracks.length} (ミックス済み音声トラック)`);

    return compositeStream;
  }, [cameraStream, avatarImageSrc, avatarImageSrcRef, aiAudioStream, audioDestinationRef]);

  /**
   * Canvas合成ストリームを作成
   *
   * Phase 2 Day 6: 画面共有+カメラの合成録画
   * - 画面共有: 実際の解像度を使用（メイン）
   * - カメラ: 1/6サイズ（右下PinP）
   * - アバター: 1/6サイズ（左下PinP） - 追加
   * - 30fpsで描画ループ
   * - 音声トラックも含める（カメラ + AI音声ミキシング）
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

    console.log(`📐 初期Canvas解像度: ${canvas.width}x${canvas.height}`);

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

    // アバター画像を読み込み（存在する場合）
    let avatarImage: HTMLImageElement | null = null;
    let lastAvatarImageSrc: string | undefined = undefined;

    const initialAvatarSrc = avatarImageSrcRef?.current || avatarImageSrc;
    if (initialAvatarSrc) {
      avatarImage = new Image();
      avatarImage.src = initialAvatarSrc;
      lastAvatarImageSrc = initialAvatarSrc;
      console.log(`  アバター画像読み込み: ${initialAvatarSrc}`);
    }

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

      screenVideo.play().then(() => {
        isScreenReady = true;
        console.log('▶️ 画面共有video再生開始（isScreenReady=true）');
      }).catch(err => console.warn('画面共有video再生エラー:', err));
    };

    cameraVideo.onloadedmetadata = () => {
      console.log('✅ カメラvideo準備完了', {
        readyState: cameraVideo.readyState,
        videoWidth: cameraVideo.videoWidth,
        videoHeight: cameraVideo.videoHeight,
      });

      cameraVideo.play().then(() => {
        isCameraReady = true;
        console.log('▶️ カメラvideo再生開始（isCameraReady=true）');
      }).catch(err => console.warn('カメラvideo再生エラー:', err));
    };

    // 描画ループ（30fps）
    let frameCount = 0;
    const drawFrame = () => {
      if (!canvasRef.current) return;

      frameCount++;
      // 最初の10フレームと100フレームごとにデバッグログ
      if (frameCount <= 10 || frameCount % 100 === 0) {
        console.log(`[フレーム${frameCount}] 画面:${isScreenReady}(${screenVideo.readyState}) カメラ:${isCameraReady}(${cameraVideo.readyState})`);
      }

      // アバター画像の変更をチェック（録画中の表情変化に対応）
      const currentAvatarSrc = avatarImageSrcRef?.current;
      if (currentAvatarSrc && currentAvatarSrc !== lastAvatarImageSrc) {
        console.log(`🔄 アバター画像更新: ${lastAvatarImageSrc} → ${currentAvatarSrc}`);
        avatarImage = new Image();
        avatarImage.src = currentAvatarSrc;
        lastAvatarImageSrc = currentAvatarSrc;
      }

      // video要素が準備できているかチェック（readyState >= 2 = HAVE_CURRENT_DATA）
      // readyState >= 2であれば現在のフレームが利用可能
      if (isScreenReady && isCameraReady &&
          screenVideo.readyState >= 2 && cameraVideo.readyState >= 2) {
        // 画面共有を全画面描画
        try {
          ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
        } catch (err) {
          console.error('❌ 画面共有描画エラー:', err);
        }

        // カメラを右下PinP描画（画面の1/6サイズ）
        const pipWidth = Math.floor(canvas.width / 6);
        const pipHeight = Math.floor(canvas.height / 6);
        const cameraPipX = canvas.width - pipWidth - 20; // 右から20px
        const cameraPipY = canvas.height - pipHeight - 20; // 下から20px

        // カメラPinP背景（黒枠）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(cameraPipX - 2, cameraPipY - 2, pipWidth + 4, pipHeight + 4);

        // カメラ映像（aspect-fitで描画）
        const cameraAspect = cameraVideo.videoWidth / cameraVideo.videoHeight;
        const pipAspect = pipWidth / pipHeight;

        let cameraDrawWidth = pipWidth;
        let cameraDrawHeight = pipHeight;
        let cameraDrawX = cameraPipX;
        let cameraDrawY = cameraPipY;

        if (cameraAspect > pipAspect) {
          // カメラが横長 → 幅を合わせる
          cameraDrawHeight = pipWidth / cameraAspect;
          cameraDrawY = cameraPipY + (pipHeight - cameraDrawHeight) / 2;
        } else {
          // カメラが縦長 → 高さを合わせる
          cameraDrawWidth = pipHeight * cameraAspect;
          cameraDrawX = cameraPipX + (pipWidth - cameraDrawWidth) / 2;
        }

        ctx.drawImage(cameraVideo, cameraDrawX, cameraDrawY, cameraDrawWidth, cameraDrawHeight);

        // アバターを左下PinP描画（画面の1/6サイズ）
        if (avatarImage && avatarImage.complete) {
          const avatarPipX = 20; // 左から20px
          const avatarPipY = canvas.height - pipHeight - 20; // 下から20px

          // アバターPinP背景（黒枠）
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(avatarPipX - 2, avatarPipY - 2, pipWidth + 4, pipHeight + 4);

          // アバター画像（aspect-fitで描画）
          const avatarAspect = avatarImage.width / avatarImage.height;

          let avatarDrawWidth = pipWidth;
          let avatarDrawHeight = pipHeight;
          let avatarDrawX = avatarPipX;
          let avatarDrawY = avatarPipY;

          if (avatarAspect > pipAspect) {
            // 画像が横長 → 幅を合わせる
            avatarDrawHeight = pipWidth / avatarAspect;
            avatarDrawY = avatarPipY + (pipHeight - avatarDrawHeight) / 2;
          } else {
            // 画像が縦長 → 高さを合わせる
            avatarDrawWidth = pipHeight * avatarAspect;
            avatarDrawX = avatarPipX + (pipWidth - avatarDrawWidth) / 2;
          }

          ctx.drawImage(avatarImage, avatarDrawX, avatarDrawY, avatarDrawWidth, avatarDrawHeight);
        }
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

    // ========================================
    // 音声トラックの手動ミキシング（AI音声録音問題の根本対策）
    // ========================================
    console.log('🎵 音声トラックの手動ミキシング開始...');

    // AudioContextを作成（音声ミキシング用）
    const mixerContext = new AudioContext();

    // ミキサーGainNodeを作成
    const mixerGain = mixerContext.createGain();
    mixerGain.gain.value = 1.0;

    // MediaStreamDestinationを作成（ミックス後の音声出力先）
    const mixedDestination = mixerContext.createMediaStreamDestination();
    mixerGain.connect(mixedDestination);

    let screenSourceConnected = false;
    let cameraSourceConnected = false;
    let aiSourceConnected = false;

    // 画面共有の音声をミキサーに接続
    const screenAudioTracks = screenStream.getAudioTracks();
    if (screenAudioTracks.length > 0) {
      try {
        const screenAudioStream = new MediaStream(screenAudioTracks.map(t => t.clone()));
        const screenSource = mixerContext.createMediaStreamSource(screenAudioStream);
        screenSource.connect(mixerGain);
        screenSourceConnected = true;
        console.log('  ✅ 画面共有音声をミキサーに接続');
      } catch (err) {
        console.warn('  ⚠️ 画面共有音声のミキサー接続失敗:', err);
      }
    }

    // カメラの音声をミキサーに接続
    const cameraAudioTracks = cameraStream.getAudioTracks();
    if (cameraAudioTracks.length > 0) {
      try {
        const cameraAudioStream = new MediaStream(cameraAudioTracks.map(t => t.clone()));
        const cameraSource = mixerContext.createMediaStreamSource(cameraAudioStream);
        cameraSource.connect(mixerGain);
        cameraSourceConnected = true;
        console.log('  ✅ カメラ音声をミキサーに接続');
      } catch (err) {
        console.warn('  ⚠️ カメラ音声のミキサー接続失敗:', err);
      }
    }

    // AI音声をミキサーに接続
    const aiStream = audioDestinationRef?.current?.stream || aiAudioStream;
    if (aiStream) {
      const aiAudioTracks = aiStream.getAudioTracks();
      if (aiAudioTracks.length > 0) {
        try {
          const aiSource = mixerContext.createMediaStreamSource(aiStream);
          aiSource.connect(mixerGain);
          aiSourceConnected = true;
          console.log('  ✅ AI音声をミキサーに接続');
        } catch (err) {
          console.warn('  ⚠️ AI音声のミキサー接続失敗:', err);
        }
      } else {
        console.warn('  ⚠️ AI音声: トラックなし');
      }
    } else {
      console.warn('  ⚠️ AI音声: aiStreamがnull');
    }

    console.log(`🎵 音声ミキシング完了:`);
    console.log(`   - 画面共有音声: ${screenSourceConnected ? '✅' : '❌'}`);
    console.log(`   - カメラ音声: ${cameraSourceConnected ? '✅' : '❌'}`);
    console.log(`   - AI音声: ${aiSourceConnected ? '✅' : '❌'}`);
    console.log(`   - ミックス後の音声トラック数: ${mixedDestination.stream.getAudioTracks().length}`);

    // ミックス後の音声トラックを合成ストリームに追加
    const mixedAudioTracks = mixedDestination.stream.getAudioTracks();
    mixedAudioTracks.forEach(track => {
      track.enabled = true;
      compositeStream.addTrack(track);
      console.log(`  🎵 ミックス済み音声トラック追加: enabled=${track.enabled}, readyState=${track.readyState}`);
    });

    compositeStreamRef.current = compositeStream;

    console.log('✅ Canvas合成ストリーム作成完了');
    console.log(`  解像度: ${canvas.width}×${canvas.height}`);
    console.log(`  カメラPinPサイズ: ${Math.floor(canvas.width / 6)}×${Math.floor(canvas.height / 6)} (右下)`);
    console.log(`  アバターPinPサイズ: ${Math.floor(canvas.width / 6)}×${Math.floor(canvas.height / 6)} (左下)`);
    console.log(`  音声トラック数: ${mixedAudioTracks.length} (画面共有 + カメラ + AI音声をミキシング)`);

    return compositeStream;
  }, [screenStream, cameraStream, avatarImageSrc, avatarImageSrcRef, aiAudioStream, audioDestinationRef]);

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
    // ストリーム状態を詳細にログ出力
    console.log('🎬 録画開始リクエスト...');
    console.log('  screenStream:', screenStream ? '✅ あり' : '❌ なし');
    console.log('  cameraStream:', cameraStream ? '✅ あり' : '❌ なし');
    if (screenStream) {
      const screenTracks = screenStream.getVideoTracks();
      console.log('  画面共有videoトラック数:', screenTracks.length);
      if (screenTracks.length > 0) {
        const settings = screenTracks[0].getSettings();
        console.log('  画面共有解像度:', `${settings.width}x${settings.height}`);
      }
    }
    if (cameraStream) {
      const cameraTracks = cameraStream.getVideoTracks();
      console.log('  カメラvideoトラック数:', cameraTracks.length);
      if (cameraTracks.length > 0) {
        const settings = cameraTracks[0].getSettings();
        console.log('  カメラ解像度:', `${settings.width}x${settings.height}`);
      }
    }

    // ストリームの優先順位:
    // 1. 画面共有+カメラ → Canvas合成（画面共有+カメラPinP+アバターPinP）
    // 2. カメラのみ → Canvas合成（カメラ+アバターPinP）
    // 3. 画面共有のみ → 画面共有ストリームをそのまま録画（アプリ全体録画）
    // 4. ストリームなし → エラー
    let recordingStream: MediaStream | null = null;

    if (screenStream && cameraStream) {
      // Canvas合成（画面共有+カメラ+アバター）
      console.log('📹 録画モード: Canvas合成（画面共有+カメラPinP+アバターPinP）');
      recordingStream = createCompositeStream();
      if (!recordingStream) {
        console.error('❌ Canvas合成ストリーム作成失敗');
        setRecordingError('UnknownError');
        return;
      }
    } else if (cameraStream) {
      // カメラのみ（Canvas合成 - カメラ+アバター）
      console.log('📹 録画モード: カメラのみ（Canvas合成 - カメラ+アバター）');
      recordingStream = createCameraOnlyCompositeStream();
      if (!recordingStream) {
        console.error('❌ カメラのみCanvas合成ストリーム作成失敗');
        setRecordingError('UnknownError');
        return;
      }
    } else if (screenStream) {
      // 画面共有のみ（カメラなし - 画面共有をそのまま録画）
      console.log('📹 録画モード: 画面共有のみ（カメラなし）');
      recordingStream = screenStream;
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

      // RecordRTCを使用する場合（AI音声録音問題の対策）
      if (useRecordRTC.current) {
        console.log('🎬 [RecordRTC] 録画開始...');

        const recorder = new RecordRTC(recordingStream, {
          type: 'video',
          mimeType: 'video/webm;codecs=vp9' as any, // RecordRTC型定義の制限を回避
          recorderType: RecordRTC.MediaStreamRecorder,
          audioBitsPerSecond: 128000,
          videoBitsPerSecond: 2500000,
          // RecordRTC特有のオプション
          timeSlice: 1000, // 1秒ごとにondataavailableを発火
          ondataavailable: (blob: Blob) => {
            chunksRef.current.push(blob);
            console.log(`📦 [RecordRTC] ondataavailable:`);
            console.log(`   - データサイズ: ${blob.size} bytes (${(blob.size / 1024).toFixed(2)} KB)`);
            console.log(`   - 累積チャンク数: ${chunksRef.current.length}`);
          },
        });

        recordRTCRef.current = recorder;

        recorder.startRecording();
        setIsRecording(true);

        console.log('✅ [RecordRTC] 録画開始成功');
        console.log(`  MIMEタイプ: video/webm;codecs=vp9,opus`);

        // 映像トラック情報
        const videoTrack = recordingStream.getVideoTracks()[0];
        if (videoTrack) {
          const settings = videoTrack.getSettings();
          console.log(`  映像解像度: ${settings.width}x${settings.height}`);
        }

        // 音声トラック情報
        const audioTracksInStream = recordingStream.getAudioTracks();
        console.log(`  音声トラック数: ${audioTracksInStream.length}`);
        audioTracksInStream.forEach((track, i) => {
          console.log(`    音声トラック[${i}]: label="${track.label}", enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
        });

        return;
      }

      // 以下は従来のMediaRecorderを使用する場合
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
      let dataEventCount = 0;
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        dataEventCount++;
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
          console.log(`📦 [MediaRecorder] ondataavailable #${dataEventCount}:`);
          console.log(`   - データサイズ: ${event.data.size} bytes (${(event.data.size / 1024).toFixed(2)} KB)`);
          console.log(`   - データタイプ: ${event.data.type}`);
          console.log(`   - 累積チャンク数: ${chunksRef.current.length}`);
          console.log(`   - 累積データサイズ: ${chunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0)} bytes`);
        } else {
          console.warn(`⚠️ [MediaRecorder] ondataavailable #${dataEventCount}: データなし (size=${event.data?.size || 0})`);
        }
      };

      // 録画停止時の処理
      mediaRecorder.onstop = () => {
        console.log('🛑 [MediaRecorder] onstop - 録画停止');

        // チャンクごとのサイズを表示
        console.log(`📊 [MediaRecorder] チャンク詳細:`);
        console.log(`   - チャンク数: ${chunksRef.current.length}`);
        chunksRef.current.forEach((chunk, index) => {
          console.log(`   - チャンク[${index}]: ${chunk.size} bytes (${chunk.type})`);
        });

        const totalSize = chunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0);
        console.log(`   - 総データサイズ: ${totalSize} bytes (${(totalSize / 1024).toFixed(2)} KB)`);

        // Blobを作成
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const duration = recordingTimeRef.current; // Refを使用してクロージャー問題を回避
        const timestamp = new Date();

        setRecordingData({
          blob,
          duration,
          timestamp,
        });

        console.log('✅ [MediaRecorder] 録画データ保存完了');
        console.log(`   - 録画時間: ${duration}秒`);
        console.log(`   - Blobサイズ: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   - Blobタイプ: ${blob.type}`);

        isStoppingRef.current = false; // 停止処理完了
      };

      // 録画エラー時の処理
      mediaRecorder.onerror = (event: Event) => {
        console.error('❌ [MediaRecorder] onerror:', event);
        setRecordingError('UnknownError');
        setIsRecording(false);
      };

      // 状態変化のログ
      mediaRecorder.onstart = () => {
        console.log('▶️ [MediaRecorder] onstart - 録画開始イベント');
        console.log(`   - state: ${mediaRecorder.state}`);
      };

      mediaRecorder.onpause = () => {
        console.log('⏸️ [MediaRecorder] onpause - 録画一時停止');
      };

      mediaRecorder.onresume = () => {
        console.log('▶️ [MediaRecorder] onresume - 録画再開');
      };

      // 録画開始（1秒ごとにデータを取得）
      console.log('🎬 [MediaRecorder] start()を呼び出し（timeslice=1000ms）');
      mediaRecorder.start(1000);
      setIsRecording(true);

      console.log('✅ 録画開始成功');
      console.log(`  MIMEタイプ: ${mediaRecorder.mimeType}`);

      // 映像トラック情報
      const videoTrack = recordingStream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        console.log(`  映像解像度: ${settings.width}x${settings.height}`);
      }

      // 音声トラック情報
      const audioTracksInStream = recordingStream.getAudioTracks();
      console.log(`  音声トラック数: ${audioTracksInStream.length}`);
      audioTracksInStream.forEach((track, i) => {
        console.log(`    音声トラック[${i}]: label="${track.label}", enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      });

    } catch (error: any) {
      console.error('❌ 録画開始エラー:', error);
      setRecordingError('UnknownError');
    }
  }, [cameraStream, screenStream, createCompositeStream, createCameraOnlyCompositeStream]); // 依存配列を更新

  /**
   * 録画を停止
   *
   * Phase 2 Day 6: Canvas合成のクリーンアップも実施
   */
  const stopRecording = useCallback(() => {
    // 既に停止処理中の場合はスキップ
    if (isStoppingRef.current) {
      console.log('⏭️ [RecordRTC] 停止処理中のためスキップ');
      return;
    }

    // RecordRTCを使用している場合
    if (recordRTCRef.current && isRecording) {
      console.log('🛑 [RecordRTC] 録画停止中...');
      isStoppingRef.current = true; // 停止処理開始

      // recordRTCRefをローカル変数にコピー（コールバック内でnullになるのを防ぐ）
      const recorder = recordRTCRef.current;

      recorder.stopRecording(() => {
        // recordRTCRefがnullになっていないか確認
        if (!recorder) {
          console.error('❌ [RecordRTC] recordRTCRefがnullです');
          return;
        }

        try {
          const blob = recorder.getBlob();
          const duration = recordingTimeRef.current;
          const timestamp = new Date();

          console.log('✅ [RecordRTC] 録画停止完了');
          console.log(`   - 録画時間: ${duration}秒`);
          console.log(`   - Blobサイズ: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
          console.log(`   - Blobタイプ: ${blob.type}`);

          setRecordingData({
            blob,
            duration,
            timestamp,
          });
        } catch (err) {
          console.error('❌ [RecordRTC] getBlob()エラー:', err);
        } finally {
          // RecordRTCインスタンスを破棄
          try {
            recorder.destroy();
          } catch (err) {
            console.warn('⚠️ [RecordRTC] destroy()エラー:', err);
          }
          recordRTCRef.current = null;
          isStoppingRef.current = false; // 停止処理完了
        }
      });

      setIsRecording(false);

      // Canvas描画ループ停止
      if (animationFrameRef.current) {
        console.log('  Canvas描画ループ停止');
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      // Canvas合成ストリーム停止
      if (compositeStreamRef.current) {
        console.log('  Canvas合成ストリーム停止');
        compositeStreamRef.current.getTracks().forEach(track => track.stop());
        compositeStreamRef.current = null;
      }

      return;
    }

    // 従来のMediaRecorderの場合
    if (mediaRecorderRef.current && isRecording) {
      console.log('🛑 [MediaRecorder] 録画停止中...');
      isStoppingRef.current = true; // 停止処理開始
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

  /**
   * 録画中に画面共有状態が変わった場合の処理
   *
   * カメラのみCanvas合成の描画ロジックを動的に更新し、
   * 画面共有が開始されたら画面共有を描画するように切り替える
   */
  useEffect(() => {
    // 録画中でない場合はスキップ
    if (!isRecording) {
      return;
    }

    console.log(`[録画中] ストリーム状態: 画面共有=${!!screenStream}, カメラ=${!!cameraStream}`);
  }, [isRecording, screenStream, cameraStream]);

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
