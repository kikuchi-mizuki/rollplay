import { RecordingState } from '../types';

/**
 * 実録音機能付きAudioRecorder
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

  /**
   * 録音開始
   */
  async start(): Promise<void> {
    try {
      // マイクアクセス
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // 録音レベル計測用のAudioContextを設定
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      this.microphone.connect(this.analyser);
      
      // MediaRecorderの設定
      const pickedMime = this.pickSupportedMime();
      if (pickedMime) {
        this.mimeType = pickedMime;
      }
      
      const options: MediaRecorderOptions = {};
      if (pickedMime) {
        options.mimeType = pickedMime;
      }
      
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.audioChunks = [];
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
      
      this.mediaRecorder.start();
      this.state.isRecording = true;
      this.state.duration = 0;
      
      this.startTimer();
      this.startLevelMeasurement();
      
    } catch (error) {
      console.error('録音開始エラー:', error);
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
   * ブラウザ対応MIMEを優先順で選択
   */
  private pickSupportedMime(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/wav'
    ];
    
    for (const m of candidates) {
      if (MediaRecorder.isTypeSupported(m)) {
        return m;
      }
    }
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
      this.analyser!.getByteFrequencyData(dataArray);
      
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
   * クリーンアップ
   */
  cleanup(): void {
    this.stopTimer();
    this.stopLevelMeasurement();
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

