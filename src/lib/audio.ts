import { RecordingState } from '../types';

/**
 * 実録音機能付きAudioRecorder（音声自動検出VAD対応）
 */
export class AudioRecorder {
  private state: RecordingState = {
    isRecording: false,
    duration: 0,
    level: 0,
  };

  private timer: number | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private mimeType: string = 'audio/webm';
  private levelInterval: number | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;

  // VAD（音声自動検出）用
  private vadEnabled: boolean = false;
  private vadPaused: boolean = false; // VAD一時停止フラグ（AI音声再生中など）
  private vadThreshold: number = 75; // 音声検出閾値（0-100）※環境音誤検出対策で75に引き上げ
  private vadInterruptThreshold: number = 85; // 割り込み検出閾値（AI話し中の割り込みを検出）
  private isInterruptMode: boolean = false; // 割り込みモード（AI話し中）
  private onInterruptCallback?: () => void; // 割り込み検出時のコールバック
  private silenceTimeout: number | null = null;
  private silenceDuration: number = 400; // 無音0.4秒で録音停止（ChatGPTレベルの高速応答）
  private isVadRecording: boolean = false;
  private onVadStartCallback?: () => void;
  private onVadStopCallback?: (blob: Blob) => void;
  private minRecordingDuration: number = 1000; // 最低録音時間（ミリ秒）※誤検出防止のため1秒に延長
  private recordingStartTime: number = 0;
  private _lastLogTime: number = 0; // ログ出力の間隔制御用
  private voiceStartTime: number = 0; // 音声検出開始時刻
  private voiceContinueDuration: number = 400; // 音声が継続する必要がある時間（ミリ秒）※環境音対策で400msに延長

  /**
   * 録音開始（モバイル対応強化）
   */
  async start(): Promise<void> {
    try {
      console.log('🎙️ 録音開始リクエスト...');

      // MediaRecorderのサポート確認
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('お使いのブラウザは音声録音に対応していません。最新のブラウザをご利用ください。');
      }

      if (typeof MediaRecorder === 'undefined') {
        throw new Error('MediaRecorderがサポートされていません。最新のブラウザをご利用ください。');
      }

      // マイクアクセス（詳細なエラーハンドリング）
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        });
        console.log('✅ マイクアクセス許可取得');
      } catch (err: any) {
        console.error('❌ マイクアクセスエラー:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          throw new Error('マイクへのアクセスが拒否されました。ブラウザの設定からマイクの使用を許可してください。');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          throw new Error('マイクが見つかりません。デバイスにマイクが接続されているか確認してください。');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          throw new Error('マイクが使用中です。他のアプリを閉じてから再度お試しください。');
        } else if (err.name === 'NotSupportedError') {
          throw new Error('HTTPSでアクセスしてください。HTTPでは音声録音ができません。');
        }
        throw new Error(`マイクアクセスエラー: ${err.message || err.name}`);
      }

      // 録音レベル計測用のAudioContextを設定（モバイル対応）
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass();

        // iOSの場合、AudioContextを再開する必要がある
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.microphone = this.audioContext.createMediaStreamSource(this.stream);
        this.microphone.connect(this.analyser);
        console.log('✅ AudioContext初期化完了');
      } catch (err) {
        console.warn('⚠️ AudioContext初期化失敗（レベル表示なしで続行）:', err);
        // AudioContextの失敗は致命的ではないため続行
      }

      // MediaRecorderの設定（モバイル対応）
      const pickedMime = this.pickSupportedMime();
      if (pickedMime) {
        this.mimeType = pickedMime;
      } else {
        console.warn('⚠️ サポートされたMIMEタイプなし、デフォルトを使用');
        this.mimeType = 'audio/webm'; // フォールバック
      }

      const options: MediaRecorderOptions = {};
      if (pickedMime) {
        options.mimeType = pickedMime;
      }

      try {
        this.mediaRecorder = new MediaRecorder(this.stream, options);
      } catch (err) {
        console.error('❌ MediaRecorder作成エラー、オプションなしで再試行:', err);
        // オプションなしで再試行
        this.mediaRecorder = new MediaRecorder(this.stream);
      }

      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          console.log('📦 録音データチャンク:', event.data.size, 'bytes');
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onerror = (event: any) => {
        console.error('❌ MediaRecorder エラー:', event.error);
      };

      // モバイルの場合は timeslice を指定して定期的にデータを取得
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const timeslice = isIOS ? 1000 : undefined; // iOSの場合1秒ごと

      this.mediaRecorder.start(timeslice);
      console.log('✅ MediaRecorder開始 (timeslice:', timeslice, ')');

      this.state.isRecording = true;
      this.state.duration = 0;

      this.startTimer();
      if (this.analyser) {
        this.startLevelMeasurement();
      }

    } catch (error: any) {
      console.error('❌ 録音開始エラー:', error);
      this.cleanupMedia();
      throw error;
    }
  }

  /**
   * 録音停止
   */
  async stop(): Promise<Blob | null> {
    if (!this.mediaRecorder || !this.state.isRecording) {
      return null;
    }
    
    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = () => {
        this.state.isRecording = false;
        this.stopTimer();
        this.stopLevelMeasurement();
        this.cleanupMedia();
        
        // 音声データを結合
        const audioBlob = new Blob(this.audioChunks, { type: this.mimeType });
        this.audioChunks = [];
        
        resolve(audioBlob);
      };
      
      // 停止前に最後のデータを確保
      if (this.mediaRecorder) {
        try {
          this.mediaRecorder.requestData();
        } catch (e) {
          // 一部のブラウザでは不要
        }
        
        this.mediaRecorder.stop();
      }
    });
  }
  
  /**
   * MediaRecorderとStreamのクリーンアップ
   */
  private cleanupMedia(): void {
    if (this.mediaRecorder) {
      this.mediaRecorder = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }
    
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
  
  /**
   * ブラウザ対応MIMEを優先順で選択（モバイル対応強化）
   */
  private pickSupportedMime(): string {
    // iOSやモバイル環境を検出
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    // iOSの場合は audio/mp4 を優先
    const candidates = isIOS || isSafari ? [
      'audio/mp4',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/aac',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/wav'
    ] : isAndroid ? [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/wav'
    ] : [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/wav'
    ];

    console.log('🎙️ デバイス検出:', { isIOS, isSafari, isAndroid });

    for (const m of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) {
        console.log('✅ サポートされたMIME:', m);
        return m;
      }
    }

    console.warn('⚠️ サポートされたMIMEタイプが見つかりませんでした');
    return '';
  }
  
  /**
   * 録音レベルの実測
   */
  private startLevelMeasurement(): void {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    this.levelInterval = window.setInterval(() => {
      // analyserがnullでないことを再確認（クリーンアップ後の実行を防ぐ）
      if (!this.analyser) {
        this.stopLevelMeasurement();
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);

      // 最大値を計算
      let max = 0;
      for (let i = 0; i < bufferLength; i++) {
        if (dataArray[i] > max) {
          max = dataArray[i];
        }
      }

      // 0-100の範囲に正規化
      this.state.level = (max / 255) * 100;
      window.dispatchEvent(new CustomEvent('recording-update', { detail: this.state }));
    }, 100);
  }
  
  private stopLevelMeasurement(): void {
    if (this.levelInterval !== null) {
      clearInterval(this.levelInterval);
      this.levelInterval = null;
      this.state.level = 0;
    }
  }

  /**
   * 録音状態を取得
   */
  getState(): RecordingState {
    return { ...this.state };
  }

  /**
   * タイマー開始
   */
  private startTimer(): void {
    this.timer = window.setInterval(() => {
      this.state.duration += 1;
      // 状態変更を通知するため、カスタムイベントを発火（オプション）
      window.dispatchEvent(new CustomEvent('recording-update', { detail: this.state }));
    }, 1000);
  }

  /**
   * タイマー停止
   */
  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 録音レベルのシミュレーション開始（未使用）
   */
  // @ts-ignore
  private _startLevelSimulation(): void {
    this.levelInterval = window.setInterval(() => {
      // ランダムなレベル（20-90の範囲）を生成
      this.state.level = 20 + Math.random() * 70;
      window.dispatchEvent(new CustomEvent('recording-update', { detail: this.state }));
    }, 100);
  }

  // @ts-ignore
  private _stopLevelSimulation(): void {
    if (this.levelInterval !== null) {
      clearInterval(this.levelInterval);
      this.levelInterval = null;
      this.state.level = 0;
    }
  }

  /**
   * VAD（音声自動検出）モード開始
   */
  async startVAD(onStart: () => void, onStop: (blob: Blob) => void): Promise<void> {
    this.vadEnabled = true;
    this.onVadStartCallback = onStart;
    this.onVadStopCallback = onStop;

    // マイク監視を開始（録音はまだ開始しない）
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      // AudioContext設定
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass();

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      this.microphone.connect(this.analyser);

      // VAD音量監視を開始
      this.startVADMonitoring();

      console.log('✅ VADモード開始（話すと自動的に録音開始）');
    } catch (error) {
      console.error('❌ VADモード開始エラー:', error);
      throw error;
    }
  }

  /**
   * VAD（音声自動検出）モード停止
   */
  stopVAD(): void {
    this.vadEnabled = false;
    this.vadPaused = false;
    this.voiceStartTime = 0; // 継続時間タイマーをリセット

    // 録音中なら停止
    if (this.isVadRecording) {
      this.stop();
    }

    this.stopVADMonitoring();
    this.cleanupMedia();

    console.log('✅ VADモード停止');
  }

  /**
   * VAD一時停止（AI音声再生中など）
   */
  pauseVAD(): void {
    this.vadPaused = true;
    this.voiceStartTime = 0; // 継続時間タイマーをリセット
    console.log('⏸️ VAD一時停止（AI音声再生中）');

    // 無音タイマーをクリア（録音が自動停止しないようにする）
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
      console.log('⏹️ 無音タイマークリア');
    }

    // 既に録音中の場合は即座に停止
    if (this.isVadRecording) {
      console.log('🛑 録音中のため強制停止（AI音声開始）');
      this.stopVADRecording();
    }
  }

  /**
   * VAD再開
   */
  resumeVAD(): void {
    this.vadPaused = false;
    this.isInterruptMode = false;
    console.log('▶️ VAD再開');
  }

  /**
   * 割り込みモードに切り替え（AI話し中に割り込みを検出可能にする）
   */
  enableInterruptMode(onInterrupt: () => void): void {
    this.isInterruptMode = true;
    this.onInterruptCallback = onInterrupt;
    this.vadPaused = false; // 割り込み検出のためVADは動かす
    console.log(`🎯 割り込みモード有効化（閾値: ${this.vadInterruptThreshold}）`);
  }

  /**
   * 割り込みモード解除
   */
  disableInterruptMode(): void {
    this.isInterruptMode = false;
    this.onInterruptCallback = undefined;
    console.log('🔕 割り込みモード無効化');
  }

  /**
   * VAD音量監視
   */
  private startVADMonitoring(): void {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    this.levelInterval = window.setInterval(() => {
      if (!this.analyser || !this.vadEnabled) {
        this.stopVADMonitoring();
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);

      // 音量計算
      let max = 0;
      for (let i = 0; i < bufferLength; i++) {
        if (dataArray[i] > max) {
          max = dataArray[i];
        }
      }

      const level = (max / 255) * 100;
      this.state.level = level;

      // 音声レベルを定期的にログ出力（5秒ごと）
      if (!this._lastLogTime || Date.now() - this._lastLogTime > 5000) {
        console.log(`📊 現在の音声レベル: ${level.toFixed(1)} (閾値: ${this.vadThreshold}, 録音中: ${this.isVadRecording})`);
        this._lastLogTime = Date.now();
      }

      // 音声検出ロジック
      // 1. VAD一時停止中は何もしない
      if (this.vadPaused && !this.isInterruptMode) {
        return;
      }

      // 2. 割り込みモード：高い閾値で割り込みを検出
      if (this.isInterruptMode && level > this.vadInterruptThreshold) {
        console.log(`🚨 割り込み検出！ (レベル: ${level.toFixed(1)}) → AI音声停止`);
        if (this.onInterruptCallback) {
          this.onInterruptCallback();
        }
        // 割り込みモード解除→通常の録音開始
        this.isInterruptMode = false;
        this.isVadRecording = true;
        this.recordingStartTime = Date.now();
        this.startVADRecording();
        if (this.onVadStartCallback) {
          this.onVadStartCallback();
        }
        return;
      }

      // 3. 通常モード：通常の閾値で録音開始
      if (!this.isInterruptMode && level > this.vadThreshold) {
        // 音声検出 → 継続時間チェック後に録音開始
        if (!this.isVadRecording) {
          // 音声検出開始時刻を記録
          if (this.voiceStartTime === 0) {
            this.voiceStartTime = Date.now();
            console.log(`👂 音声検出開始 (レベル: ${level.toFixed(1)}) → ${this.voiceContinueDuration}ms継続を確認中...`);
          }

          // 音声が一定時間継続したら録音開始
          const voiceDuration = Date.now() - this.voiceStartTime;
          if (voiceDuration >= this.voiceContinueDuration) {
            console.log(`🎤 音声継続確認 (${voiceDuration}ms) → 録音開始`);
            this.isVadRecording = true;
            this.recordingStartTime = Date.now();
            this.voiceStartTime = 0; // リセット
            this.startVADRecording();
            if (this.onVadStartCallback) {
              this.onVadStartCallback();
            }
          }
        } else {
          // 録音中は継続時間タイマーをリセット
          this.voiceStartTime = 0;
        }

        // 無音タイマーをクリア
        if (this.silenceTimeout) {
          console.log(`🔄 無音タイマーをクリア (レベル: ${level.toFixed(1)})`);
          clearTimeout(this.silenceTimeout);
          this.silenceTimeout = null;
        }
      } else {
        // 音声レベルが閾値以下に戻った → 継続時間タイマーをリセット
        if (this.voiceStartTime !== 0) {
          console.log(`⏹️ 音声検出キャンセル (レベル低下: ${level.toFixed(1)})`);
          this.voiceStartTime = 0;
        }

        // 無音検出 → タイマー開始
        if (this.isVadRecording && !this.silenceTimeout) {
          console.log(`⏱️ 無音検出開始 (レベル: ${level.toFixed(1)}, ${this.silenceDuration}ms後に停止)`);
          this.silenceTimeout = window.setTimeout(() => {
            // 最低録音時間チェック
            const recordingDuration = Date.now() - this.recordingStartTime;
            if (recordingDuration < this.minRecordingDuration) {
              console.log(`⏭️ 録音時間が短すぎるためスキップ (${recordingDuration}ms)`);
              // 録音をキャンセル
              if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
                this.mediaRecorder = null;
                this.audioChunks = [];
              }
              this.isVadRecording = false;
              this.state.isRecording = false;
              this.stopTimer();
            } else {
              console.log('🔇 無音検出 → 録音停止');
              this.stopVADRecording();
            }
          }, this.silenceDuration);
        }
      }

      window.dispatchEvent(new CustomEvent('recording-update', { detail: this.state }));
    }, 100);
  }

  /**
   * VAD録音開始
   */
  private async startVADRecording(): Promise<void> {
    console.log('📝 startVADRecording 開始');

    if (!this.stream) {
      console.error('❌ streamがありません');
      return;
    }

    const pickedMime = this.pickSupportedMime();
    if (pickedMime) {
      this.mimeType = pickedMime;
    }
    console.log('📝 MIME type:', this.mimeType);

    const options: MediaRecorderOptions = pickedMime ? { mimeType: pickedMime } : {};

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      console.log('✅ MediaRecorder作成成功');
    } catch (err) {
      console.warn('⚠️ MediaRecorder作成失敗、オプションなしで再試行');
      this.mediaRecorder = new MediaRecorder(this.stream);
    }

    this.audioChunks = [];

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        console.log(`📦 データチャンク受信: ${event.data.size} bytes`);
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onerror = (event: any) => {
      console.error('❌ MediaRecorder エラー:', event.error);
    };

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const timeslice = isIOS ? 1000 : undefined;

    this.mediaRecorder.start(timeslice);
    this.state.isRecording = true;
    this.state.duration = 0;
    this.startTimer();

    console.log('✅ VAD録音開始完了 (timeslice:', timeslice, ')');
  }

  /**
   * VAD録音停止
   */
  private async stopVADRecording(): Promise<void> {
    if (!this.mediaRecorder || !this.isVadRecording) return;

    this.isVadRecording = false;

    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = () => {
        this.state.isRecording = false;
        this.stopTimer();

        const audioBlob = new Blob(this.audioChunks, { type: this.mimeType });
        this.audioChunks = [];

        // コールバック実行
        if (this.onVadStopCallback && audioBlob.size > 0) {
          this.onVadStopCallback(audioBlob);
        }

        resolve();
      };

      try {
        this.mediaRecorder!.requestData();
      } catch (e) {
        // ignore
      }

      this.mediaRecorder!.stop();
      this.mediaRecorder = null;
    });
  }

  /**
   * VAD監視停止
   */
  private stopVADMonitoring(): void {
    if (this.levelInterval !== null) {
      clearInterval(this.levelInterval);
      this.levelInterval = null;
    }

    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

    this.state.level = 0;
  }

  /**
   * クリーンアップ
   */
  cleanup(): void {
    this.stopTimer();
    this.stopLevelMeasurement();
    this.stopVAD();
    this.cleanupMedia();
  }
}

/**
 * 時間をフォーマット（mm:ss形式）
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

