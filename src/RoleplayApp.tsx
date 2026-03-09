import { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { ChatPanel } from './components/ChatPanel';
import { MediaPanel } from './components/MediaPanel';
import { EvaluationSheet } from './components/EvaluationSheet';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast } from './components/Toast';
import { PersonaSelector } from './components/PersonaSelector';
import { PersonaInfo } from './components/PersonaInfo';
import { CameraPip } from './components/CameraPip';
import { DebugInfo } from './components/DebugInfo';
// import { BudgetNotice } from './components/BudgetNotice'; // 利用額超過時のみ表示するため一時的に非表示
import { Message, Evaluation, RecordingState, Persona } from './types';
import { getEvaluation, getScenarios, saveConversation, saveEvaluation, uploadRecording } from './lib/api';
import { AudioRecorder, diagnoseMicrophone, MicrophoneDiagnostics } from './lib/audio';
import { useAuth } from './contexts/AuthContext';
import { getDefaultExpression, getExpressionForResponse, getExpressionImageUrl } from './lib/expressionSelector';
import { useCamera } from './hooks/useCamera'; // Phase 2: カメラアクセス
import { useScreenShare } from './hooks/useScreenShare'; // Phase 2 Day 3: 画面共有
import { useRecording, RecordingData } from './hooks/useRecording'; // Phase 2 Day 4: 録画機能

// 本番環境ではconsole.logを無効化するユーティリティ
// 使用例: debug('メッセージ') は開発環境でのみ出力
// @ts-ignore - 将来使用するためのユーティリティ関数
const isDevelopment = import.meta.env.DEV;
// @ts-ignore - 将来使用するためのユーティリティ関数
const debug = isDevelopment ? console.log : () => {};
// @ts-ignore - 将来使用するためのユーティリティ関数
const debugWarn = isDevelopment ? console.warn : () => {};
// @ts-ignore - 将来使用するためのユーティリティ関数
const debugError = console.error; // エラーは常に表示

/**
 * デバッグログガイドライン:
 * - 開発時のみのログ: debug() を使用
 * - 警告: debugWarn() を使用
 * - エラー: debugError() または console.error() を使用（本番でも表示）
 *
 * 今後の改善: 既存のconsole.logをdebug()に段階的に置換
 */

/**
 * ロープレメインアプリケーションコンポーネント
 */
function RoleplayApp() {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [isLoadingEvaluation, setIsLoadingEvaluation] = useState(false);
  const [savingProgress, setSavingProgress] = useState<'idle' | 'evaluating' | 'saving-conversation' | 'saving-evaluation' | 'uploading-recording' | 'completed'>('idle');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toast, setToast] = useState<{ message: string; type?: 'success' | 'error' | 'info' } | null>(null);
  const [isConnected] = useState(true);
  const [mediaSubtitle, setMediaSubtitle] = useState<string>('');
  const [videoSrc, setVideoSrc] = useState<string | undefined>(); // 動画のURL
  const [imageSrc, setImageSrc] = useState<string | undefined>(getDefaultExpression('avatar_03')); // アバター画像（デフォルト表情）
  const [scenarios, setScenarios] = useState<{ id: string; title: string; enabled: boolean; category?: string }[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [conversationId, setConversationId] = useState<string | null>(null); // 会話ID（ペルソナ固定用）
  const [currentPersona, setCurrentPersona] = useState<Persona | null>(null); // 現在のペルソナ情報（会話内固定）
  const currentPersonaRef = useRef<Persona | null>(null); // currentPersonaのRef（クロージャー問題を回避）
  const [showPersonaSelector, setShowPersonaSelector] = useState(false); // ペルソナ選択モーダルの表示状態
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null); // 選択されたペルソナID
  const selectedPersonaIdRef = useRef<string | null>(null); // selectedPersonaIdのRef（クロージャー問題を回避）
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate'); // 難易度レベル
  const currentAvatarId = 'avatar_03'; // 固定アバター（20代女性）
  const conversationStartTime = useRef<Date | null>(null);
  const lastExpressionRef = useRef<string>(getDefaultExpression('avatar_03')); // 前回の表情を記憶（不要な切り替え防止）

  const audioRecorderRef = useState(() => new AudioRecorder())[0];
  const [_speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const [_voiceCount, setVoiceCount] = useState(0);
  const [speechInitialized, setSpeechInitialized] = useState(false);
  const [audioInitialized, setAudioInitialized] = useState(false); // HTMLAudioElement初期化フラグ
  const [isVADMode, setIsVADMode] = useState(false); // VAD（会話モード）のON/OFF
  const isVADModeRef = useRef(false); // VADモードのRef（クロージャー問題を回避）
  const webSpeechFinalTextRef = useRef<string | null>(null); // Web Speech APIの最終結果を保存
  const lastProcessedFinalTextRef = useRef<string | null>(null); // 最後に処理した最終結果（重複防止用）
  const isSendingRef = useRef(false); // isSendingのRef（VAD重複防止のため）
  const messagesRef = useRef<Message[]>([]); // messagesの最新値を保持（ステート更新タイミング問題を回避）
  const currentAudioRef = useRef<HTMLAudioElement | null>(null); // 現在再生中の音声（後方互換性のため残す）
  const audioContextRef = useRef<AudioContext | null>(null); // Web Audio API用のAudioContext
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null); // 現在再生中のAudioBufferSource
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null); // AI音声出力のキャプチャ用（録画用）
  const aiMixerGainNodeRef = useRef<GainNode | null>(null); // AI音声ミキサー用GainNode（常時接続）
  const analyserNodeRef = useRef<AnalyserNode | null>(null); // AnalyserNode（音声波形確認用）
  const keepAliveOscillatorRef = useRef<OscillatorNode | null>(null); // MediaStreamDestinationをアクティブに保つためのOscillator
  const [aiAudioStream, setAiAudioStream] = useState<MediaStream | null>(null); // AI音声出力のMediaStream（録画用）
  const avatarImageSrcRef = useRef<string | undefined>(imageSrc); // アバター画像のRef（録画中の表情変化に対応）
  const screenStreamRef = useRef<MediaStream | null>(null); // 画面共有のRef（録画中の画面共有開始に対応）
  const videoRecordingDataRef = useRef<RecordingData | null>(null); // 録画データのRef（講評時の確実な参照用）

  // 録画開始時のWeb Audio API初期化フラグ
  const recordingAudioInitializedRef = useRef(false);

  // Phase 2: 背景ぼかしのグローバル状態（画面共有時も設定を維持）
  const [backgroundMode, setBackgroundMode] = useState<'none' | 'blur'>('none');
  const [blurIntensity, setBlurIntensity] = useState(15); // 5-30px
  const [blurredCameraStream, setBlurredCameraStream] = useState<MediaStream | null>(null); // 背景ぼかし済みストリーム（録画用）

  // Phase 2: カメラアクセス
  const {
    cameraStream, // Day 4（録画機能）で使用
    isCameraActive,
    cameraError,
    isLoading: isCameraLoading,
    cameraVideoRef,
    startCamera,
    stopCamera,
    getErrorMessage,
  } = useCamera();

  // Phase 2 Day 3: 画面共有
  const {
    screenStream, // Day 6（合成録画）で使用
    isScreenSharing,
    screenShareError,
    isLoading: isScreenShareLoading,
    screenVideoRef,
    startScreenShare,
    stopScreenShare,
    getErrorMessage: getScreenShareErrorMessage,
  } = useScreenShare();

  // Phase 2 Day 4: 録画機能（カメラストリームを録画）
  // Phase 2 Day 6: Canvas合成録画（画面共有+カメラ）
  // Phase 2 Day 7: ダウンロード機能
  const {
    isRecording: isVideoRecording,
    recordingError: videoRecordingError,
    recordingTime: videoRecordingTime,
    recordingData: videoRecordingData,
    startRecording: startVideoRecordingInternal,
    stopRecording: stopVideoRecording,
    clearRecording: clearVideoRecording,
    downloadRecording: downloadVideoRecording,
    getErrorMessage: getVideoRecordingErrorMessage,
    formatRecordingTime,
  } = useRecording({
    cameraStream,
    screenStream,
    blurredCameraStream, // 背景ぼかし済みカメラストリーム（録画用）
    avatarImageSrc: imageSrc, // カメラのみモードでCanvas合成に使用（初期値）
    avatarImageSrcRef, // 録画中の表情変化に対応（Ref経由で最新値を参照）
    aiAudioStream, // AI音声出力のストリーム（Web Audio API）
    audioDestinationRef, // AI音声Destinationのref（ステート更新タイミング問題を回避）
    screenStreamRef, // 画面共有のRef（録画中の画面共有開始に対応）
  }); // 画面共有+カメラの場合はCanvas合成録画、カメラのみの場合もCanvas合成（カメラ+アバター+AI音声）

  // Web Audio API初期化（モバイル自動再生ポリシー対応）
  const initializeAudio = useCallback(async () => {
    if (audioInitialized && audioContextRef.current) {
      console.log('✅ 音声は既に初期化済み');
      return audioContextRef.current;
    }

    try {
      console.log('🔊 Web Audio API初期化開始...');

      // AudioContextを作成（Safari対応）
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      // AudioContextをresumeして有効化（モバイル対応）
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // AI音声ミキサー用のGainNodeを作成（常時接続）
      const mixerGain = audioContext.createGain();
      mixerGain.gain.value = 1.0; // 直接代入
      aiMixerGainNodeRef.current = mixerGain;

      // GainNodeをスピーカーに接続
      mixerGain.connect(audioContext.destination);

      // 録画用のMediaStreamDestinationを作成してGainNodeに接続
      const recordingDestination = audioContext.createMediaStreamDestination();
      mixerGain.connect(recordingDestination); // 録画用にGainNodeを接続
      audioDestinationRef.current = recordingDestination;

      // AnalyserNodeを作成してMediaStreamDestinationの前に挿入（音声波形確認用）
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyserNodeRef.current = analyser;

      // ミキサー → AnalyserNode → MediaStreamDestination の順に接続
      mixerGain.connect(analyser);
      analyser.connect(recordingDestination);

      setAiAudioStream(recordingDestination.stream);
      console.log('✅ AI音声出力ストリーム作成完了（GainNodeミキサー方式 - 録画用接続 + AnalyserNode）');
      console.log(`   - ミキサーGain値: ${mixerGain.gain.value}`);
      console.log(`   - MediaStreamDestination作成: active=${recordingDestination.stream.active}`);
      console.log(`   - 音声トラック数: ${recordingDestination.stream.getAudioTracks().length}`);
      console.log(`   - AnalyserNode追加: fftSize=${analyser.fftSize}`);

      // 極めて低い音量の連続信号でMediaStreamDestinationを常時アクティブ化
      // (OscillatorNodeは停止するまで永続的に動作する)
      // 重要: スピーカーには出力せず、録画用Destinationのみに接続
      const oscillator = audioContext.createOscillator();
      oscillator.frequency.value = 20; // 20Hz（人間の可聴域下限、ほぼ聞こえない）
      const silenceGain = audioContext.createGain();
      silenceGain.gain.value = 0.00001; // 極小音量（スピーカー出力しないのでさらに小さく）
      oscillator.connect(silenceGain);
      silenceGain.connect(recordingDestination); // 録画用のみに接続（スピーカーには出力しない）
      oscillator.start();
      keepAliveOscillatorRef.current = oscillator; // クリーンアップ用に参照を保存
      console.log('🔇 MediaStreamDestinationをアクティブ化（20Hz/0.00001音量・録画専用）');

      setAudioInitialized(true);
      console.log('✅ Web Audio API初期化成功');
      return audioContext;
    } catch (error) {
      console.warn('⚠️ Web Audio API初期化失敗:', error);
      return null;
    }
  }, [audioInitialized, setAiAudioStream]);

  // 録画開始のラッパー（Web Audio API初期化を確実に実行）
  const startVideoRecording = useCallback(async () => {
    // 録画開始前にWeb Audio APIを初期化（ユーザージェスチャーが必要なため）
    if (!recordingAudioInitializedRef.current) {
      console.log('🎵 録画開始: Web Audio APIを初期化します（ユーザージェスチャー）');
      await initializeAudio();
      recordingAudioInitializedRef.current = true;

      // MediaStreamDestinationをアクティブにするため、無音を再生
      if (audioContextRef.current && audioDestinationRef.current) {
        console.log('🔇 AI音声ストリームをアクティブ化（無音再生）');
        const silentBuffer = audioContextRef.current.createBuffer(1, 1, 22050);
        const silentSource = audioContextRef.current.createBufferSource();
        silentSource.buffer = silentBuffer;
        silentSource.connect(audioDestinationRef.current);
        silentSource.start(0);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    // 録画開始
    startVideoRecordingInternal();
  }, [startVideoRecordingInternal, initializeAudio]);

  // アバター管理（将来実装予定）
  // Web Speech API サポートチェック
  useEffect(() => {
    if ('speechSynthesis' in window) {
      setSpeechSupported(true);

      // 音声リストを読み込み
      const loadVoices = () => {
        const voices = speechSynthesis.getVoices();
        setVoiceCount(voices.length);
        console.log('🔊 Web Speech API サポート確認:');
        console.log('  利用可能な音声数:', voices.length);
        console.log('  日本語音声:', voices.filter(v => v.lang.startsWith('ja')).length, '個');

        if (voices.length === 0) {
          console.warn('⚠️ 音声リストが空です。音声が再生されない可能性があります。');
        }
      };

      // 即座に確認
      loadVoices();

      // voiceschanged イベントでも確認（モバイル対応）
      speechSynthesis.addEventListener('voiceschanged', loadVoices);

      return () => {
        speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      };
    } else {
      setSpeechSupported(false);
      console.error('❌ Web Speech API がサポートされていません');
      setToast({
        message: 'お使いのブラウザは音声再生に対応していません',
        type: 'error',
      });
    }
  }, []);

  // Web Audio API 初期化（録画用にAI音声をキャプチャするため）
  // 注意: ブラウザのAutoplayポリシーにより、ユーザージェスチャー後に初期化する必要がある
  // そのため、録画開始時またはVADモード開始時に初期化する

  // シナリオ一覧を取得
  useEffect(() => {
    getScenarios()
      .then((scenarios) => {
        setScenarios(scenarios);
        // デフォルトシナリオを設定
        const defaultScenario = scenarios.find(s => s.enabled) || scenarios[0];
        if (defaultScenario) {
          setSelectedScenarioId(defaultScenario.id);
        }
      })
      .catch((error) => {
        console.error('シナリオ取得エラー:', error);
      });
  }, []);

  // messagesステートの変更をRefに同期（ステート更新タイミング問題を回避）
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // imageSrc（アバター表情）の変更をRefに同期（録画中の表情変化に対応）
  useEffect(() => {
    avatarImageSrcRef.current = imageSrc;
  }, [imageSrc]);

  // screenStream（画面共有）の変更をRefに同期（録画中の画面共有開始に対応）
  useEffect(() => {
    screenStreamRef.current = screenStream;
    console.log(`[録画中] ストリーム状態: 画面共有=${!!screenStream}, カメラ=${!!cameraStream}`);
  }, [screenStream, cameraStream]);

  // videoRecordingData（録画データ）の変更をRefに同期（講評時の確実な参照用）
  useEffect(() => {
    videoRecordingDataRef.current = videoRecordingData;
    if (videoRecordingData) {
      console.log('[録画データ] Refに同期:', {
        blobSize: videoRecordingData.blob.size,
        duration: videoRecordingData.duration,
      });
    }
  }, [videoRecordingData]);

  // currentPersona（ペルソナ情報）の変更を監視してRefに同期（デバッグ用）
  useEffect(() => {
    currentPersonaRef.current = currentPersona;
    console.log('[ペルソナ監視] currentPersonaが更新されました:', currentPersona ? {
      name: currentPersona.name,
      voice_name: currentPersona.voice_name,
      speaking_rate: currentPersona.speaking_rate
    } : null);
  }, [currentPersona]);

  // selectedPersonaIdの変更を監視してRefに同期
  useEffect(() => {
    selectedPersonaIdRef.current = selectedPersonaId;
    console.log('[ペルソナID監視] selectedPersonaIdが更新されました:', selectedPersonaId);
  }, [selectedPersonaId]);

  // Phase 2: カメラエラーハンドリング
  useEffect(() => {
    if (cameraError) {
      const errorMessage = getErrorMessage();
      if (errorMessage) {
        setToast({
          message: errorMessage,
          type: 'error',
        });
      }
    }
  }, [cameraError, getErrorMessage]);

  // Phase 2: コンポーネントアンマウント時にカメラを停止
  useEffect(() => {
    return () => {
      if (isCameraActive) {
        console.log('🧹 コンポーネントアンマウント: カメラを停止します');
        stopCamera();
      }
    };
  }, [isCameraActive, stopCamera]);

  // Phase 2 Day 3: 画面共有エラーハンドリング
  useEffect(() => {
    if (screenShareError) {
      const errorMessage = getScreenShareErrorMessage();
      if (errorMessage) {
        setToast({
          message: errorMessage,
          type: 'error',
        });
      }
    }
  }, [screenShareError, getScreenShareErrorMessage]);

  // Phase 2 Day 3: コンポーネントアンマウント時に画面共有を停止
  useEffect(() => {
    return () => {
      if (isScreenSharing) {
        console.log('🧹 コンポーネントアンマウント: 画面共有を停止します');
        stopScreenShare();
      }
    };
  }, [isScreenSharing, stopScreenShare]);

  // Phase 2 Day 4: 録画エラーハンドリング
  useEffect(() => {
    if (videoRecordingError) {
      const errorMessage = getVideoRecordingErrorMessage();
      if (errorMessage) {
        setToast({
          message: errorMessage,
          type: 'error',
        });
      }
    }
  }, [videoRecordingError, getVideoRecordingErrorMessage]);

  // Phase 2 Day 4: コンポーネントアンマウント時に録画を停止
  useEffect(() => {
    return () => {
      if (isVideoRecording) {
        console.log('🧹 コンポーネントアンマウント: 録画を停止します');
        stopVideoRecording();
      }
    };
  }, [isVideoRecording, stopVideoRecording]);

  // Phase 2 Day 4: 録画完了時の通知
  useEffect(() => {
    if (videoRecordingData) {
      const sizeInMB = (videoRecordingData.blob.size / 1024 / 1024).toFixed(2);
      setToast({
        message: `録画完了！ (${sizeInMB} MB, ${videoRecordingData.duration}秒)`,
        type: 'success',
      });
    }
  }, [videoRecordingData]);

  // シナリオ選択時に、会話をリセット（ユーザーが最初に話しかける形式）
  useEffect(() => {
    if (selectedScenarioId) {
      // シナリオが切り替わったら会話をリセット
      setMessages([]);
      messagesRef.current = []; // Refも同期
      setEvaluation(null);
      setShowEvaluation(false);
      setConversationId(null);
      setCurrentPersona(null); // ペルソナ情報もリセット
      setSelectedPersonaId(null); // ペルソナ選択もリセット
      conversationStartTime.current = new Date(); // 会話開始時刻を記録

      // デフォルト表情（listening）の静止画を表示（avatar_03固定）
      const defaultExpression = getDefaultExpression(currentAvatarId);
      setImageSrc(defaultExpression);
      setVideoSrc(undefined); // 静止画を使用するため動画はクリア
      lastExpressionRef.current = defaultExpression; // 前回の表情を記憶

      // 字幕をクリア（ユーザーが最初に話しかけるまで何も表示しない）
      setMediaSubtitle('');

      // ペルソナ選択モーダルを表示
      setShowPersonaSelector(true);
    }
  }, [selectedScenarioId]);

  // AudioContextのクリーンアップ（メモリリーク防止）
  useEffect(() => {
    return () => {
      // Keep-alive Oscillatorを停止
      if (keepAliveOscillatorRef.current) {
        try {
          keepAliveOscillatorRef.current.stop();
          keepAliveOscillatorRef.current.disconnect();
          console.log('🧹 Keep-alive Oscillatorを停止しました');
        } catch (err) {
          // 既に停止済みの場合はエラーを無視
        }
        keepAliveOscillatorRef.current = null;
      }

      // GainNodeとAnalyserNodeをdisconnect（メモリリーク防止）
      if (aiMixerGainNodeRef.current) {
        try {
          aiMixerGainNodeRef.current.disconnect();
          console.log('🧹 AI Mixer GainNodeをdisconnect');
        } catch (err) {
          // 既にdisconnect済みの場合はエラーを無視
        }
        aiMixerGainNodeRef.current = null;
      }

      if (analyserNodeRef.current) {
        try {
          analyserNodeRef.current.disconnect();
          console.log('🧹 AnalyserNodeをdisconnect');
        } catch (err) {
          // 既にdisconnect済みの場合はエラーを無視
        }
        analyserNodeRef.current = null;
      }

      if (audioDestinationRef.current) {
        // MediaStreamDestinationNodeは自動的にクリーンアップされるが、参照をクリア
        audioDestinationRef.current = null;
      }

      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        console.log('🧹 AudioContextをクローズします');
        audioContextRef.current.close().catch((err) => {
          console.warn('AudioContextクローズエラー（無視可能）:', err);
        });
        audioContextRef.current = null;
      }
      // AudioBufferSourceNodeも停止
      if (currentAudioSourceRef.current) {
        try {
          currentAudioSourceRef.current.stop();
        } catch (err) {
          // 既に停止済みの場合はエラーを無視
        }
        currentAudioSourceRef.current = null;
      }
    };
  }, []);

  // 自動保存機能：5分ごとに会話を保存（データ損失防止）
  useEffect(() => {
    // conversationIdが既にある場合はスキップ（既に保存済み）
    if (conversationId) {
      return;
    }

    // メッセージが少なすぎる場合はスキップ
    if (messages.length < 3) {
      return;
    }

    const AUTO_SAVE_INTERVAL = 5 * 60 * 1000; // 5分
    console.log('⏰ 自動保存タイマーを設定（5分間隔）');

    const timerId = setInterval(() => {
      // 再チェック：conversationIdがある場合はスキップ
      if (conversationId) {
        console.log('⏭️ 既に保存済みのため、自動保存をスキップ');
        return;
      }

      if (messagesRef.current.length >= 3 && user && profile?.store_id) {
        console.log('💾 自動保存を実行中...', {
          messageCount: messagesRef.current.length,
        });
        saveConversationHistory().catch((err) => {
          console.error('❌ 自動保存エラー:', err);
        });
      }
    }, AUTO_SAVE_INTERVAL);

    return () => {
      clearInterval(timerId);
      console.log('🧹 自動保存タイマーをクリア');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages.length, user, profile?.store_id]);

  /**
   * ストリーミング対応の音声再生
   * SSEで音声チャンクを受信して即座に再生
   */
  const handleSendStream = async (text: string, vadMode: boolean, t0?: number, t1?: number) => {
    if (!text.trim() || isSending) return;

    setIsSending(true);
    isSendingRef.current = true;

    // 🔍 会話履歴を先にキャプチャ（messagesRefから最新値を取得 - ステート更新タイミング問題を回避）
    const historyBeforeBot = messagesRef.current;

    // VADモードの場合、ユーザーメッセージは既に暫定→最終に変換済みなので追加しない
    if (!vadMode) {
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: text.trim(),
        timestamp: new Date(),
      };

      // 長時間会話での安定性向上：メッセージ数を制限（最大50件）
      setMessages((prev) => {
        const newMessages = [...prev, userMessage];
        const MAX_MESSAGES = 50;

        if (newMessages.length > MAX_MESSAGES) {
          // 古いメッセージを削除（最新50件のみ保持）
          const trimmed = newMessages.slice(-MAX_MESSAGES);
          console.log(`[メモリ最適化] メッセージ履歴をトリミング: ${newMessages.length} → ${trimmed.length}件`);
          return trimmed;
        }

        return newMessages;
      });
    }

    // ⏱️ レイテンシー計測用（t0, t1から引き継ぎ）
    let firstTokenReceived = false;
    let firstAudioPlayed = false;
    let t2: number | undefined; // GPT最初のトークン受信時刻

    try {
      // 音声チャンクキュー
      const audioQueue: { audio: ArrayBuffer; text: string }[] = [];
      let isPlaying = false;
      let fullText = '';
      let currentAudio: HTMLAudioElement | null = null; // 現在再生中の音声
      let interruptModeEnabled = false; // 割り込みモード有効化フラグ
      let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null; // SSEストリームのreader
      let playbackLoopRunning = false; // 再生ループ実行中フラグ
      let resolveWaiter: (() => void) | null = null; // イベント駆動型キュー用の通知関数

      // キューに何か来るまで待つ（イベント駆動型）
      const waitForQueue = () =>
        new Promise<void>((resolve) => {
          if (audioQueue.length > 0 || !playbackLoopRunning) {
            resolve();
          } else {
            resolveWaiter = resolve;
          }
        });

      // 割り込み時に全ての音声を停止
      const stopAllAudio = () => {
        console.log('🛑 全音声停止（割り込み）');

        // メモリリーク防止：音声キューをクリア
        if (audioQueue.length > 0) {
          console.log(`🗑️ 音声キューをクリア: ${audioQueue.length}個のチャンク`);
          audioQueue.length = 0; // 配列を空にしてメモリ解放
        }

        // SSEストリームを中断
        if (streamReader) {
          streamReader.cancel();
          streamReader = null;
          console.log('📡 SSEストリーム中断');
        }

        // Web Audio APIのソースを停止
        if (currentAudioSourceRef.current) {
          try {
            const source = currentAudioSourceRef.current;

            // メモリリーク防止：停止前に明示的にクリーンアップ
            // onendedコールバックが実行される前にnullに設定されるのを防ぐ
            source.stop();

            // 明示的にdisconnectとバッファクリア（onendedと同じ処理）
            try {
              source.disconnect();
              source.buffer = null;
            } catch (disconnectError) {
              // 既にdisconnect済みの場合はエラーを無視
            }

            source.onended = null;
            currentAudioSourceRef.current = null;
            console.log('🔇 Web Audio API音声停止（クリーンアップ完了）');
          } catch (e) {
            // 既に停止している場合はエラーを無視
            console.log('⚠️ 音声は既に停止済み');
          }
        }

        // 後方互換性のため、HTMLAudioElementも停止
        if (currentAudio) {
          console.log(`🔇 HTMLAudioElement停止`);
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudio.onended = null;
          currentAudio.onerror = null;
          currentAudio = null;
        }

        audioQueue.length = 0; // キューをクリア
        isPlaying = false;
        interruptModeEnabled = false;
        audioRecorderRef.disableInterruptMode();
        if (vadMode) {
          audioRecorderRef.resumeVAD();
          console.log('🔓 VAD再開（割り込み停止後）');
        }

        // イベント駆動型キューの待機をキャンセル
        if (resolveWaiter) {
          (resolveWaiter as () => void)();
          resolveWaiter = null;
        }

        console.log('✅ 音声停止完了（キュークリア、再生停止）');
      };

      // botメッセージを先に作成（AI回答の最初のチャンクで更新される）
      const botMessageId = `bot-${Date.now()}`;
      const botMessage: Message = {
        id: botMessageId,
        role: 'bot',
        text: '...',  // プレースホルダー（すぐにAI回答で置き換えられる）
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);

      // 🎭 t1: ユーザー発話終了 → thinking表情に先行変化（心理トリック）
      setImageSrc(getExpressionImageUrl(currentAvatarId, 'thinking'));
      setMediaSubtitle('');  // 字幕は空にして、AI回答を待つ
      console.log('[t1] アバター表情を"thinking"に先行変化');

      // 再生専用ループ（イベント駆動型・オーバーラップ対応）
      const playbackLoop = async () => {
        playbackLoopRunning = true;
        console.log('🔄 [再生ループ] 開始 (イベント駆動型・オーバーラップ対応)');

        // AI音声再生中はリアルタイム文字起こしを一時停止（AIの声を拾わないように）
        audioRecorderRef.pauseRealtimeTranscription();

        while (playbackLoopRunning) {
          // キューに何か来るまで待つ（イベント駆動型、50ms遅延なし）
          await waitForQueue();
          if (!playbackLoopRunning) {
            console.log('🛑 [再生ループ] ループフラグがfalse、終了します');
            break;
          }

          // キューにチャンクがあり、再生中でなければ即座に再生
          if (audioQueue.length > 0 && !isPlaying) {
            const item = audioQueue.shift()!;
            const { audio: audioData, text: chunkText } = item;
            isPlaying = true;

            console.log(`📦 [チャンク取り出し] "${chunkText}" (${audioData.byteLength} bytes), 残りキュー: ${audioQueue.length}`);

            try {
              // 音声データの有効性チェック
              if (!audioData || audioData.byteLength === 0) {
                console.error(`❌ [エラー] 無効な音声データ: "${chunkText}" (サイズ: ${audioData?.byteLength || 0} bytes)`);
                throw new Error('無効な音声データ');
              }

              // 各チャンクのテキストを字幕として表示（2行以内で切り替わる）
              setMediaSubtitle(chunkText);

              // ⏱️ 最初のTTS再生開始
              if (!firstAudioPlayed && t0) {
                const t3 = performance.now();
                console.log(`[latency] t3: TTS再生開始 (${t3.toFixed(0)}ms)`);
                console.log(`[latency] total (speech_end→tts_play): ${(t3 - t0).toFixed(0)}ms`);
                if (t2) {
                  console.log(`[latency] gpt_first_token→tts_play: ${(t3 - t2).toFixed(0)}ms`);
                }
                firstAudioPlayed = true;
              }

              // Web Audio APIで音声を再生（モバイル対応）
              // 再生中にサーバー側では次のTTSが生成されている（オーバーラップ）
              console.log(`▶️ [再生開始] "${chunkText}" (${audioData.byteLength} bytes)`);
              const playStartTime = performance.now();
              await playAudioWithWebAudio(audioData);
              const playDuration = performance.now() - playStartTime;
              console.log(`✅ [再生完了] "${chunkText}" (再生時間: ${playDuration.toFixed(0)}ms)`);

              // チャンク間に自然な間隔を追加（速度最優先：50ms）
              await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
              console.error(`❌ [音声再生エラー] "${chunkText}"`, error);
              console.error(`[エラー詳細] タイプ: ${error instanceof Error ? error.message : String(error)}`);
              // エラーが発生しても次のチャンクに進む
            } finally {
              // 必ず再生フラグをfalseに戻す（例外時も保証）
              isPlaying = false;
              console.log(`🔓 [再生フラグ解放] 次のチャンクへ`);
            }
          }
        }

        // ループ終了時の処理（クリーンアップ）
        console.log('🛑 再生ループ終了');
        setMediaSubtitle('');

        // 表情をlisteningに戻す（会話終了を視覚的に示す）
        const listeningExpression = getExpressionImageUrl(currentAvatarId, 'listening');
        setImageSrc(listeningExpression);
        lastExpressionRef.current = listeningExpression;
        console.log('[アバター] 再生終了、listening表情に復帰');

        // 割り込みモードを無効化してVADを再開
        if (vadMode) {
          audioRecorderRef.disableInterruptMode();
          audioRecorderRef.resumeVAD();
          console.log('🔓 VAD再開（正常終了）');
        }

        // リアルタイム文字起こしを再開
        audioRecorderRef.resumeRealtimeTranscription();
      };

      // 再生ループを起動（常駐・バックグラウンド実行）
      playbackLoop();

      // 🔍 デバッグ: 送信する会話履歴を確認（プレースホルダーを含めないhistoryBeforeBotを使用）
      const historyToSend = historyBeforeBot.map(m => ({ speaker: m.role === 'user' ? '営業' : '顧客', text: m.text }));
      const personaToSend = currentPersonaRef.current; // Refから最新値を取得（クロージャー問題を回避）
      console.log(`[会話履歴送信] 件数: ${historyToSend.length}`);
      console.log(`[API送信] conversation_id: ${conversationId}, persona: ${personaToSend ? 'あり' : 'なし'}`);
      if (personaToSend) {
        console.log(`[API送信] persona.voice_name: ${personaToSend.voice_name}, persona.speaking_rate: ${personaToSend.speaking_rate}`);
      }
      historyToSend.slice(-5).forEach((h, i) => {
        console.log(`  [${i}] ${h.speaker}: ${h.text.substring(0, 50)}...`);
      });

      // SSEでストリーミング受信
      const personaIdToSend = selectedPersonaIdRef.current; // Refから最新値を取得
      console.log(`[API送信] persona_id: ${personaIdToSend ? personaIdToSend : 'なし'}`);

      const response = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          history: historyToSend,
          scenario_id: selectedScenarioId,
          conversation_id: conversationId, // 会話IDを送信（ペルソナ固定用）
          persona: personaToSend, // 現在のペルソナを送信（conversation_idがない場合のフォールバック）
          persona_id: personaIdToSend, // 選択されたペルソナID（新規会話時）
          difficulty: difficulty // 難易度レベル（beginner/intermediate/advanced）
        }),
      });

      if (!response.ok) {
        throw new Error('ストリーミング接続失敗');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('ReadableStream not supported');
      }

      streamReader = reader; // readerを保存（割り込み時に中断するため）

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const data = JSON.parse(jsonStr);

              if (data.error) {
                console.error('ストリーミングエラー:', data.error);
                // デバッグ用：詳細なエラー情報を表示
                console.error('エラー詳細:', JSON.stringify(data, null, 2));
                setToast({ message: `エラー: ${data.error}`, type: 'error' });

                // チャット欄にもエラーメッセージを表示（ユーザーが気づきやすいように）
                setMessages((prev) =>
                  prev.map(msg =>
                    msg.id === botMessageId
                      ? { ...msg, text: `エラーが発生しました: ${data.error}` }
                      : msg
                  )
                );

                // ストリームを中断して終了
                playbackLoopRunning = false;
                if (resolveWaiter) {
                  (resolveWaiter as () => void)();
                  resolveWaiter = null;
                }
                break;
              }

              // 最終チャンクでペルソナ情報を受信（新規会話時のみ）
              if (data.final && data.persona) {
                console.log('[ペルソナ受信] 新規会話のペルソナ情報を取得:', data.persona);
                console.log('[ペルソナ受信] voice_name:', data.persona.voice_name, 'speaking_rate:', data.persona.speaking_rate);
                setCurrentPersona(data.persona);
                console.log('[ペルソナ更新] setCurrentPersonaを呼び出しました');
              }

              if (data.audio) {
                const audioChunkReceiveTime = performance.now();

                // ⏱️ GPT最初のトークン受信
                if (!firstTokenReceived && t1) {
                  t2 = performance.now();
                  console.log(`[latency] t2: GPT最初のトークン受信 (${t2.toFixed(0)}ms)`);
                  console.log(`[latency] whisper→gpt_first_token: ${(t2 - t1).toFixed(0)}ms`);
                  console.log(`⏱️ [フロントエンド計測] 音声チャンク受信: ${audioChunkReceiveTime.toFixed(0)}ms`);
                  firstTokenReceived = true;

                  // 🎭 t2: GPT最初のトークン受信 → 表情を先行変化（心理トリック）
                  // 最初のチャンクのテキストから適切な表情を選択
                  if (data.text) {
                    const expressionUrl = getExpressionForResponse(
                      data.text,
                      currentAvatarId,
                      messages.slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })),
                      text
                    );
                    setImageSrc(expressionUrl);
                    console.log(`[t2] アバター表情を先行変化: ${expressionUrl}`);

                    // 💬 字幕の先出し表示（心理トリック：音声より0.2-0.3秒早く表示）
                    setMediaSubtitle(data.text);
                    console.log(`[t2] 字幕を先出し表示: "${data.text}"`);
                  }
                }

                // Base64デコード
                const binaryString = atob(data.audio);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }

                // 音声データサイズをチェック
                console.log(`📥 [キュー追加] "${data.text}" (${bytes.buffer.byteLength} bytes)`);

                // 音声キューに追加（音声とテキストをペアで管理）
                // 再生ループが自動的に取り出して再生する（オーバーラップ）
                audioQueue.push({ audio: bytes.buffer, text: data.text || '' });
                fullText += data.text || '';

                // メモリリーク防止：キューサイズ上限チェック（異常な蓄積を防ぐ）
                const MAX_QUEUE_SIZE = 50; // 通常は10個以下のはずだが、安全のため50に設定
                if (audioQueue.length > MAX_QUEUE_SIZE) {
                  console.warn(`⚠️ 音声キューが上限を超えました（${audioQueue.length}個）。古いチャンクを削除します。`);
                  audioQueue.shift(); // 最も古いチャンクを削除
                }

                console.log(`📊 [キュー状態] 現在のキューサイズ: ${audioQueue.length}`);

                // イベント駆動型キュー：待機中のループを即座に起こす
                if (resolveWaiter) {
                  console.log('🔔 [キュー通知] 再生ループを起動');
                  (resolveWaiter as () => void)();
                  resolveWaiter = null;
                }

                // 最初の音声チャンク受信時に割り込みモードを有効化（一度だけ）
                if (vadMode && !interruptModeEnabled) {
                  interruptModeEnabled = true;
                  audioRecorderRef.enableInterruptMode(stopAllAudio);
                  console.log('🎯 割り込みモード有効化');
                }

                // チャットもリアルタイム更新（ストリーミング表示）
                setMessages((prev) =>
                  prev.map(msg =>
                    msg.id === botMessageId
                      ? { ...msg, text: fullText }
                      : msg
                  )
                );

                console.log(`[チャンク${data.chunk}] 受信・キューに追加: ${data.text}（再生ループが自動処理）`);
              }
            } catch (e) {
              console.error('JSON parse error:', e);
            }
          }
        }
      }

      // SSEストリーム完了後、キューが空になるまで待つ
      console.log(`⏳ [ストリーム完了] 残りチャンク数: ${audioQueue.length}, 再生中: ${isPlaying}`);
      let waitCount = 0;
      while (audioQueue.length > 0 || isPlaying) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
        if (waitCount % 10 === 0) {
          console.log(`⏳ [待機中] ${waitCount * 100}ms経過, キュー: ${audioQueue.length}, 再生中: ${isPlaying}`);
        }
      }
      console.log(`✅ [全チャンク再生完了] 再生ループを停止します (待機時間: ${waitCount * 100}ms)`);

      // 全てのチャンク再生完了後、再生ループを停止
      playbackLoopRunning = false;

      // 待機中のwaitForQueueを解除
      if (resolveWaiter) {
        (resolveWaiter as () => void)();
        resolveWaiter = null;
      }

      // もしテキストが空の場合はエラーメッセージを表示
      if (!fullText) {
        setMessages((prev) =>
          prev.map(msg =>
            msg.id === botMessageId
              ? { ...msg, text: '応答を受信できませんでした' }
              : msg
          )
        );
      }

      // 📝 ストリーム完了後の表情更新は不要（t2で先行表示済み）
      // t2（GPT最初のトークン受信時）に表情を先行変化させているため、
      // ストリーム完了時に再度変更すると表情がチラついて不自然になる
      // 必要に応じて、以下のコードを有効化してください

      // AIの返答から適切な表情画像を選択（文脈ベース・自然な切り替え）
      // 直近の会話履歴を変換（expressionSelector用の形式に）※より長い文脈を見る
      // const recentMessagesForExpression = messages.slice(-10).map(msg => ({
      //   role: (msg.role === 'bot' ? 'assistant' : 'user') as 'user' | 'assistant',
      //   text: msg.text
      // }));

      // const expressionImageUrl = getExpressionForResponse(
      //   fullText,
      //   currentAvatarId,
      //   recentMessagesForExpression,
      //   text // 営業の質問内容
      // );

      // // 前回と同じ表情の場合は切り替えない（自然な会話を維持）
      // if (expressionImageUrl !== lastExpressionRef.current) {
      //   console.log(`[アバター] 表情を切り替え: ${lastExpressionRef.current} → ${expressionImageUrl}`);
      //   setImageSrc(expressionImageUrl);
      //   setVideoSrc(undefined);
      //   lastExpressionRef.current = expressionImageUrl;
      // } else {
      //   console.log(`[アバター] 表情は同じなので切り替えなし: ${expressionImageUrl}`);
      // }

    } catch (error) {
      console.error('ストリーミング送信エラー:', error);
      const errorMessage = error instanceof Error ? error.message : 'メッセージの送信に失敗しました';
      setToast({
        message: `エラー: ${errorMessage}`,
        type: 'error',
      });

      // チャット欄にもエラーメッセージを表示（botメッセージを更新）
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        // 最後のメッセージがbotメッセージ（プレースホルダー）の場合は更新
        if (lastMsg && lastMsg.role === 'bot' && lastMsg.text === '...') {
          return prev.map((msg, idx) =>
            idx === prev.length - 1
              ? { ...msg, text: `応答生成に失敗しました: ${errorMessage}` }
              : msg
          );
        }
        return prev;
      });

      // エラー時は割り込みモードを無効化してVADを再開
      if (vadMode) {
        audioRecorderRef.disableInterruptMode();
        audioRecorderRef.resumeVAD();
        console.log('🔓 VAD再開（エラー時）');
      }
    } finally {
      setIsSending(false);
      isSendingRef.current = false;
    }
  };

  // Web Audio APIで音声を再生
  const playAudioWithWebAudio = async (audioData: ArrayBuffer): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        // AudioContextを取得または初期化
        let audioContext = audioContextRef.current;
        if (!audioContext) {
          audioContext = await initializeAudio();
          if (!audioContext) {
            throw new Error('AudioContext初期化失敗');
          }
        }

        // AudioContextをresumeして有効化
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        // ArrayBufferをAudioBufferにデコード
        const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));

        // AudioBufferSourceを作成（毎回新規作成が必要）
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;

        // AI音声専用のGainNodeを作成して音量を増幅（録音用に最適化）
        const aiVolumeGain = audioContext.createGain();

        // 🔧 gain値を直接代入（即座に適用）
        aiVolumeGain.gain.value = 4.0; // AI音声を4倍に増幅

        console.log(`🔊 [DEBUG] AI音声GainNode作成: gain=${aiVolumeGain.gain.value}`);

        // AI音声ミキサーGainNodeに接続（常時接続されているので、ここに流すだけで録音される）
        if (aiMixerGainNodeRef.current) {
          source.connect(aiVolumeGain);
          aiVolumeGain.connect(aiMixerGainNodeRef.current);

          // デバッグ: ミキサーとDestinationの状態確認
          console.log('🎙️ AI音声をミキサーGainNodeに接続しました（音量4.0倍増幅・録音対応）');
          console.log(`   - ミキサーGain値: ${aiMixerGainNodeRef.current.gain.value}`);
          console.log(`   - Destination接続数: ${aiMixerGainNodeRef.current.numberOfOutputs}`);
          if (audioDestinationRef.current) {
            console.log(`   - MediaStreamDestination状態: ${audioDestinationRef.current.stream.active ? 'active' : 'inactive'}`);
            console.log(`   - 音声トラック数: ${audioDestinationRef.current.stream.getAudioTracks().length}`);
          }
        } else {
          // フォールバック：ミキサーがない場合は直接スピーカーに接続
          source.connect(aiVolumeGain);
          aiVolumeGain.connect(audioContext.destination);
          console.warn('⚠️ ミキサーGainNodeが未初期化、直接スピーカーに接続');
        }

        currentAudioSourceRef.current = source; // 停止用に保存

        // 再生終了時のコールバック（メモリクリーンアップ）
        source.onended = () => {
          // メモリリーク防止：明示的にdisconnectして参照をクリア
          try {
            source.disconnect();
            aiVolumeGain.disconnect(); // GainNodeもdisconnect
            source.buffer = null;
          } catch (e) {
            // 既にdisconnect済みの場合はエラーを無視
          }
          currentAudioSourceRef.current = null;
          resolve();
        };

        // 再生開始
        source.start(0);
        console.log('🔊 Web Audio APIで音声再生開始（録音対応）');

        // AnalyserNodeで音声波形を確認（デバッグ用）
        if (analyserNodeRef.current) {
          const analyser = analyserNodeRef.current;
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          // 音声再生開始から100ms後に波形データを取得
          setTimeout(() => {
            analyser.getByteTimeDomainData(dataArray);

            // 波形データの統計情報を計算
            let min = 255, max = 0, sum = 0;
            for (let i = 0; i < bufferLength; i++) {
              const value = dataArray[i];
              if (value < min) min = value;
              if (value > max) max = value;
              sum += value;
            }
            const avg = sum / bufferLength;
            const amplitude = max - min;

            console.log('📊 [AnalyserNode] AI音声波形データ (100ms後):');
            console.log(`   - 振幅: ${amplitude} (最小=${min}, 最大=${max})`);
            console.log(`   - 平均値: ${avg.toFixed(2)}`);
            console.log(`   - データ判定: ${amplitude > 10 ? '✅ 音声データあり' : '❌ 音声データなし（無音）'}`);

            // 周波数データも確認
            const freqData = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(freqData);
            let freqMax = 0;
            for (let i = 0; i < bufferLength; i++) {
              if (freqData[i] > freqMax) freqMax = freqData[i];
            }
            console.log(`   - 周波数最大値: ${freqMax}`);
          }, 100);

          // 500ms後にも確認（音声が継続しているか）
          setTimeout(() => {
            analyser.getByteTimeDomainData(dataArray);
            let min = 255, max = 0;
            for (let i = 0; i < bufferLength; i++) {
              const value = dataArray[i];
              if (value < min) min = value;
              if (value > max) max = value;
            }
            const amplitude = max - min;
            console.log(`📊 [AnalyserNode] AI音声波形データ (500ms後): 振幅=${amplitude} ${amplitude > 10 ? '✅ 継続中' : '❌ 停止または無音'}`);
          }, 500);
        }
      } catch (error) {
        console.error('❌ Web Audio API音声再生失敗:', error);
        currentAudioSourceRef.current = null;
        reject(error);
      }
    });
  };

  // 音声を有効化（モバイル対応）
  const initializeSpeech = () => {
    if (!('speechSynthesis' in window)) {
      setToast({
        message: 'お使いのブラウザは音声再生に対応していません',
        type: 'error',
      });
      return;
    }

    // 既存の音声をキャンセル
    speechSynthesis.cancel();

    // 短いテストメッセージで音声を初期化（無音）
    const utterance = new SpeechSynthesisUtterance('');
    utterance.lang = 'ja-JP';

    // 利用可能な音声を取得
    let voices = speechSynthesis.getVoices();

    const speakTest = () => {
      // 優先度順に音声を検索
      const preferredVoice = voices.find(voice =>
        voice.lang === 'ja-JP' && (
          voice.name.includes('Google') ||
          voice.name.includes('Microsoft') ||
          voice.name.includes('Kyoko') ||
          voice.name.includes('Otoya')
        )
      ) || voices.find(voice => voice.lang === 'ja-JP' || voice.lang.startsWith('ja'));

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.pitch = 1.0;
      utterance.rate = 0.9;
      utterance.volume = 1.0;

      utterance.onend = () => {
        setSpeechInitialized(true);
        setToast({
          message: '音声が有効化されました',
          type: 'success',
        });
      };

      utterance.onerror = (event) => {
        console.error('音声初期化エラー:', event.error);
        setToast({
          message: '音声の有効化に失敗しました',
          type: 'error',
        });
      };

      try {
        speechSynthesis.speak(utterance);
      } catch (error) {
        console.error('speechSynthesis.speak() エラー:', error);
        setToast({
          message: '音声再生に失敗しました',
          type: 'error',
        });
      }
    };

    // モバイルの場合、音声リストが空の可能性がある
    if (voices.length === 0) {
      const loadVoices = () => {
        voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
          speechSynthesis.removeEventListener('voiceschanged', loadVoices);
          speakTest();
        }
      };
      speechSynthesis.addEventListener('voiceschanged', loadVoices);
      setTimeout(() => {
        voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
          speakTest();
        }
      }, 100);
    } else {
      speakTest();
    }
  };

  // 録音状態の更新リスナー
  useEffect(() => {
    const handleRecordingUpdate = ((e: CustomEvent<RecordingState>) => {
      setRecordingState(e.detail);
    }) as EventListener;

    window.addEventListener('recording-update', handleRecordingUpdate);

    return () => {
      window.removeEventListener('recording-update', handleRecordingUpdate);
    };
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      audioRecorderRef.cleanup();
    };
  }, [audioRecorderRef]);

  /**
   * 会話履歴を保存するヘルパー関数
   * - 講評取得時とVADモード停止時の両方で使用
   * - 既に保存済みの場合はスキップ
   */
  const saveConversationHistory = async () => {
    if (!user || !profile?.store_id || messages.length === 0) {
      return null;
    }

    // 既に保存済みの場合はスキップ
    if (conversationId) {
      console.log('⏭️ 会話は既に保存済み:', conversationId);
      return conversationId;
    }

    try {
      const durationSeconds = conversationStartTime.current
        ? Math.floor((new Date().getTime() - conversationStartTime.current.getTime()) / 1000)
        : undefined;

      const scenarioTitle = scenarios.find(s => s.id === selectedScenarioId)?.title || selectedScenarioId;

      const { conversationId: newConversationId } = await saveConversation({
        userId: user.id,
        storeId: profile.store_id,
        scenarioId: selectedScenarioId,
        scenarioTitle,
        messages,
        durationSeconds,
        persona: currentPersonaRef.current,
      });

      setConversationId(newConversationId);
      console.log('✅ 会話履歴を保存しました:', newConversationId);

      return newConversationId;
    } catch (error) {
      console.error('❌ 会話保存エラー:', error);
      setToast({
        message: '会話の保存に失敗しました',
        type: 'error',
      });
      return null;
    }
  };

  // VAD（会話モード）のトグル
  const handleToggleVAD = async () => {
    if (isVADMode) {
      // VADモード停止
      audioRecorderRef.stopVAD();
      setIsVADMode(false);
      isVADModeRef.current = false;

      // 現在再生中の音声を停止（Web Audio API）
      if (currentAudioSourceRef.current) {
        try {
          currentAudioSourceRef.current.stop();
          currentAudioSourceRef.current.onended = null;
          currentAudioSourceRef.current = null;
          console.log('🔇 Web Audio API音声停止（会話モード停止）');
        } catch (e) {
          console.log('⚠️ 音声は既に停止済み');
        }
      }

      // HTMLAudioElement（後方互換性）
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
        currentAudioRef.current = null;
        console.log('🔇 HTMLAudioElement停止（会話モード停止）');
      }

      // 会話がある場合は自動的に保存（講評なしでも履歴に残す）
      if (messages.length > 0) {
        console.log('💾 会話モード停止: 会話を自動保存します');
        await saveConversationHistory();
      }

      setToast({
        message: '会話モードを停止しました',
        type: 'info',
      });
    } else {
      // VADモード開始
      // 音声を自動的に有効化（まだ有効化されていない場合・モバイル対応）
      if (!speechInitialized) {
        initializeSpeech();
      }
      if (!audioInitialized) {
        await initializeAudio();
      }

      // マイク自動診断を実行
      console.log('🔍 マイク診断を実行します...');
      setToast({
        message: 'マイクをチェック中... 少々お待ちください',
        type: 'info',
      });

      const diagnostics: MicrophoneDiagnostics = await diagnoseMicrophone();

      if (!diagnostics.success) {
        // 診断失敗 - エラーメッセージを表示
        console.error('❌ マイク診断失敗:', diagnostics);
        setToast({
          message: `マイクエラー: ${diagnostics.error}\n\n解決策: ${diagnostics.solution}`,
          type: 'error',
        });
        return; // VAD開始をキャンセル
      }

      // 診断成功
      console.log('✅ マイク診断成功:', diagnostics);
      setToast({
        message: `マイクOK！(最大音声レベル: ${diagnostics.maxAudioLevel.toFixed(0)}) 話しかけてください`,
        type: 'success',
      });

      try {
        // リアルタイム文字起こしコールバックを設定
        audioRecorderRef.setTranscriptCallback((transcript: string, isFinal: boolean) => {
          if (transcript.trim()) {
            if (!isFinal) {
              // 暫定結果を左側に表示（録音中のリアルタイム表示）
              console.log('📝 [リアルタイム暫定] ' + transcript);
              setMessages(prev => {
                // 最後のメッセージが暫定結果なら更新、なければ追加
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'user' && lastMsg.id.startsWith('interim-')) {
                  return [...prev.slice(0, -1), { ...lastMsg, text: transcript }];
                } else {
                  return [...prev, {
                    id: `interim-${Date.now()}`,
                    role: 'user',
                    text: transcript,
                    timestamp: new Date(),
                  }];
                }
              });
            } else {
              // 最終結果：暫定メッセージを確定し、Refに保存
              console.log('✅ [リアルタイム最終] ' + transcript);

              // 重複チェック：同じ最終結果を既に処理済みの場合はスキップ
              if (lastProcessedFinalTextRef.current === transcript) {
                console.log('⚠️ [重複防止] 同じ最終結果を既に処理済み、スキップ');
                return;
              }

              lastProcessedFinalTextRef.current = transcript;
              webSpeechFinalTextRef.current = transcript;

              console.log('[デバッグ] 最終メッセージを追加する前のmessages数:', messagesRef.current.length);

              setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                console.log('[デバッグ] 最終メッセージ追加処理:', {
                  hasLastMsg: !!lastMsg,
                  lastMsgRole: lastMsg?.role,
                  lastMsgId: lastMsg?.id,
                  lastMsgText: lastMsg?.text,
                  isInterim: lastMsg?.id.startsWith('interim-'),
                  newText: transcript
                });

                // 重複チェック：直近のユーザーメッセージを確認（最後の2件）
                const recentUserMessages = prev.filter(m => m.role === 'user').slice(-2);
                if (recentUserMessages.some(m => m.text === transcript)) {
                  console.warn('⚠️ [重複防止] 直近2件に同じテキストのメッセージが存在、スキップ');
                  return prev;
                }

                // 暫定メッセージを最終メッセージに変換
                if (lastMsg && lastMsg.role === 'user' && lastMsg.id.startsWith('interim-')) {
                  console.log('[デバッグ] 暫定メッセージを最終メッセージに置き換え');
                  return [...prev.slice(0, -1), {
                    id: `user-webspeech-${Date.now()}`,
                    role: 'user',
                    text: transcript,
                    timestamp: new Date(),
                  }];
                } else {
                  // 暫定メッセージがない場合は新規追加（通常は発生しない）
                  console.warn('⚠️ [異常] 暫定メッセージなしで最終結果を受信 - 新規追加');
                  return [...prev, {
                    id: `user-webspeech-${Date.now()}`,
                    role: 'user',
                    text: transcript,
                    timestamp: new Date(),
                  }];
                }
              });
            }
          }
        });

        await audioRecorderRef.startVAD(
          // 音声検出時のコールバック
          () => {
            console.log('🎤 話し始めました');
            setIsRecording(true);
            webSpeechFinalTextRef.current = null; // 録音開始時にクリア
            lastProcessedFinalTextRef.current = null; // 重複防止用もクリア
          },
          // 音声停止時のコールバック（音声認識＆送信）
          async (audioBlob: Blob) => {
            console.log('🔇 話し終わりました');
            setIsRecording(false);

            // 既に送信中の場合はスキップ（重複防止）
            if (isSendingRef.current) {
              console.log('⚠️ 既に送信中のため、この音声をスキップします');
              return;
            }

            // ⏱️ レイテンシー計測開始
            const t0 = performance.now();
            console.log(`[latency] t0: 録音停止 (${t0.toFixed(0)}ms)`);

            // 少し待ってWeb Speech APIの最終結果を取得（非同期処理のため）速度最優先
            await new Promise(resolve => setTimeout(resolve, 50));

            // Web Speech APIの最終結果があればそれを使用（速度優先）
            if (webSpeechFinalTextRef.current) {
              const finalText = webSpeechFinalTextRef.current.trim();
              console.log(`✅ [Web Speech最終結果使用] "${finalText}"`);

              // 音声認識中のフラグを立てる
              setIsSending(true);
              isSendingRef.current = true;

              // Whisperをスキップして即座にAIに送信
              const t1 = performance.now();
              console.log(`[latency] speech_end→AI送信: ${(t1 - t0).toFixed(0)}ms (Whisperスキップ)`);

              try {
                await handleSendStream(finalText, true, t0, t1);
              } catch (error) {
                console.error('AI送信エラー:', error);
                setIsSending(false);
                isSendingRef.current = false;
                if (isVADMode) {
                  audioRecorderRef.resumeVAD();
                }
              }
              return;
            }

            // Web Speech APIの最終結果がない場合、暫定結果を確認
            const lastMessage = messagesRef.current[messagesRef.current.length - 1];
            if (lastMessage && lastMessage.role === 'user' && lastMessage.id.startsWith('interim-')) {
              const interimText = lastMessage.text.trim();
              console.log(`⚠️ [Web Speech最終結果なし] 暫定結果を使用: "${interimText}"`);

              // 暫定メッセージを最終メッセージに変換
              setMessages(prev => {
                const lastMsg = prev[prev.length - 1];

                // 重複チェック：既に最終メッセージになっている場合はスキップ
                if (lastMsg && lastMsg.role === 'user' &&
                    !lastMsg.id.startsWith('interim-') &&
                    lastMsg.text === interimText) {
                  console.warn('⚠️ [重複防止] 暫定結果が既に最終メッセージになっている、スキップ');
                  return prev;
                }

                if (lastMsg && lastMsg.id === lastMessage.id) {
                  console.log('[デバッグ] 暫定メッセージを最終メッセージに変換');
                  return [...prev.slice(0, -1), {
                    id: `user-interim-final-${Date.now()}`,
                    role: 'user',
                    text: interimText,
                    timestamp: new Date(),
                  }];
                }
                return prev;
              });

              // 音声認識中のフラグを立てる
              setIsSending(true);
              isSendingRef.current = true;

              const t1 = performance.now();
              console.log(`[latency] speech_end→AI送信: ${(t1 - t0).toFixed(0)}ms (暫定結果使用)`);

              try {
                await handleSendStream(interimText, true, t0, t1);
              } catch (error) {
                console.error('AI送信エラー:', error);
                setIsSending(false);
                isSendingRef.current = false;
                if (isVADMode) {
                  audioRecorderRef.resumeVAD();
                }
              }
              return;
            }

            // Web Speech APIの結果がない場合のみWhisperを使用（フォールバック）
            console.log('⚠️ [Web Speech結果なし] Whisperをフォールバックとして使用');
            const formData = new FormData();
            const mimeType = audioBlob.type || 'audio/webm';
            let ext = mimeType.includes('webm') ? 'webm'
                   : mimeType.includes('mp4') ? 'mp4'
                   : mimeType.includes('ogg') ? 'ogg'
                   : mimeType.includes('wav') ? 'wav'
                   : 'bin';
            formData.append('audio', audioBlob, `recording.${ext}`);

            // 音声認識中のフラグを立てる（VAD重複防止のため、handleSend完了までtrueを維持）
            setIsSending(true);
            isSendingRef.current = true;
            try {
              const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
              });

              const rawText = await response.text();

              // ⏱️ Whisper完了
              const t1 = performance.now();
              console.log(`[latency] t1: Whisper完了 (${t1.toFixed(0)}ms)`);
              console.log(`[latency] speech_end→whisper: ${(t1 - t0).toFixed(0)}ms`);

              let result;
              try {
                result = JSON.parse(rawText);
              } catch (parseError) {
                console.error('JSON解析エラー:', parseError, 'rawText:', rawText);
                throw new Error(`サーバーエラー (${response.status}): ${rawText || '応答なし'}`);
              }

              if (!response.ok) {
                // エラーレスポンスの場合、エラーメッセージを表示
                throw new Error(result.error || `サーバーエラー (${response.status})`);
              }

              if (result.success && result.text) {
                // Whisperの結果を表示（暫定メッセージがない場合のみ）
                setMessages(prev => {
                  const lastMsg = prev[prev.length - 1];

                  // 重複チェック：既に同じテキストのユーザーメッセージがある場合はスキップ
                  if (lastMsg && lastMsg.role === 'user' && lastMsg.text === result.text) {
                    console.warn('⚠️ [重複防止] Whisper結果が既存メッセージと同じ、スキップ');
                    return prev;
                  }

                  if (lastMsg && lastMsg.role === 'user' && lastMsg.id.startsWith('interim-')) {
                    // 暫定メッセージがある場合は更新しない（表示を維持）
                    return prev;
                  } else {
                    // 暫定メッセージがない場合は新規追加
                    console.log('[デバッグ] Whisper結果から新規ユーザーメッセージ追加');
                    return [...prev, {
                      id: `user-${Date.now()}`,
                      role: 'user',
                      text: result.text,
                      timestamp: new Date(),
                    }];
                  }
                });

                // VAD録音経由なので、vadMode=trueを明示的に渡す
                await handleSendStream(result.text, true, t0, t1);
              } else {
                setIsSending(false);
                isSendingRef.current = false;
                setToast({
                  message: result.error || '音声認識に失敗しました。',
                  type: 'error',
                });
              }
            } catch (error) {
              console.error('音声認識エラー:', error);
              setIsSending(false);
              isSendingRef.current = false;
              // エラー時はVADを再開
              if (isVADMode) {
                audioRecorderRef.resumeVAD();
                console.log('🔓 VAD再開（音声認識エラー時）');
              }
              // エラーメッセージを適切に表示
              const errorMessage = error instanceof Error ? error.message : '音声認識に失敗しました。';
              setToast({
                message: errorMessage,
                type: 'error',
              });
            }
          }
        );
        setIsVADMode(true);
        isVADModeRef.current = true;
        setToast({
          message: '会話モード開始（話すと自動的に録音開始）',
          type: 'success',
        });
      } catch (error) {
        console.error('VADモード開始エラー:', error);
        setToast({
          message: 'マイクへのアクセスが許可されていません。',
          type: 'error',
        });
      }
    }
  };

  const handleClear = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClear = () => {
    setMessages([]);
    messagesRef.current = []; // Refも同期
    setShowClearConfirm(false);
    setMediaSubtitle('');
    setConversationId(null); // 会話IDをリセット
    setCurrentPersona(null); // ペルソナ情報もリセット
    // 動画はクリアせず、初期状態に戻す（ループ再生を維持）
    // キャッシュを回避するためにタイムスタンプを追加
    setVideoSrc('/video.mp4?v=' + Date.now());
    setImageSrc(undefined);
    setToast({
      message: '会話をクリアしました',
      type: 'info',
    });
  };

  const handleShowEvaluation = async () => {
    if (messages.length === 0) {
      setToast({
        message: '評価する会話がありません。まず会話を開始してください。',
        type: 'info',
      });
      return;
    }

    // 録画中の場合は自動的に停止
    if (isVideoRecording) {
      console.log('🎬 録画中のため、自動的に停止します');
      stopVideoRecording();

      // 録画データが利用可能になるまで待つ（最大10秒、Refを使用）
      console.log('⏳ 録画データの生成を待っています...');
      let waitCount = 0;
      const maxWaitCount = 20; // 20回 × 500ms = 10秒

      while (!videoRecordingDataRef.current && waitCount < maxWaitCount) {
        await new Promise(resolve => setTimeout(resolve, 500));
        waitCount++;
        if (waitCount % 4 === 0) {
          console.log(`⏳ 録画データ待機中... (${waitCount * 0.5}秒)`);
        }
      }

      if (videoRecordingDataRef.current) {
        console.log('✅ 録画データが利用可能になりました:', {
          blobSize: videoRecordingDataRef.current.blob.size,
          duration: videoRecordingDataRef.current.duration,
        });
      } else {
        console.warn('⚠️ 録画データの生成がタイムアウトしました');
      }
    }

    setIsLoadingEvaluation(true);
    setSavingProgress('idle');
    let evalData: Evaluation | null = null;

    try {
      // 講評を取得（Week 5: シナリオIDを渡す）
      try {
        setSavingProgress('evaluating');
        console.log('📊 講評を取得中...');
        evalData = await getEvaluation(messages, selectedScenarioId);
        setEvaluation(evalData);
        setShowEvaluation(true);
        console.log('✅ 講評を取得しました');
      } catch (error) {
        console.error('講評取得エラー:', error);
        setToast({
          message: '講評の取得に失敗しました。会話は保存します。',
          type: 'error',
        });
      }

      // 会話履歴を保存（講評の有無に関わらず保存）
      if (user && profile?.store_id) {
        try {
        // 会話を保存（共通ヘルパー関数を使用）
        setSavingProgress('saving-conversation');
        console.log('💾 会話を保存中...');
        const newConversationId = await saveConversationHistory();
        console.log('✅ 会話を保存しました');

        if (newConversationId) {
          // 評価を保存（講評取得に成功した場合のみ）
          if (evalData) {
            setSavingProgress('saving-evaluation');
            console.log('💾 評価を保存中...');
            await saveEvaluation({
              conversationId: newConversationId,
              userId: user.id,
              storeId: profile.store_id,
              scenarioId: selectedScenarioId,
              evaluation: evalData,
            });
            console.log('✅ 評価結果を保存しました');
          }

          // 録画データの状態をデバッグログに出力（Refから取得）
          const recordingData = videoRecordingDataRef.current;
          console.log('🔍 録画データの状態チェック:', {
            hasVideoRecordingData: !!recordingData,
            blobSize: recordingData?.blob?.size,
            duration: recordingData?.duration,
            timestamp: recordingData?.timestamp,
          });

          // 録画データがある場合はアップロード
          if (recordingData) {
            try {
              setSavingProgress('uploading-recording');
              console.log('📤 録画データをアップロード中...', {
                blobSize: recordingData.blob.size,
                blobType: recordingData.blob.type,
                duration: recordingData.duration,
              });
              const filename = `recording_${newConversationId}_${Date.now()}.webm`;
              const uploadResult = await uploadRecording(
                newConversationId,
                recordingData.blob,
                filename,
                recordingData.duration
              );

              console.log('📤 アップロード結果:', uploadResult);

              if (uploadResult.success) {
                console.log('✅ 録画データをアップロードしました');
                setSavingProgress('completed');
                const successMessage = evalData
                  ? '会話・評価・録画を保存しました'
                  : '会話と録画を保存しました';
                setToast({
                  message: successMessage,
                  type: 'success',
                });
              } else {
                console.error('録画アップロードエラー:', uploadResult.error);
                const errorMessage = evalData
                  ? '会話と評価を保存しましたが、録画のアップロードに失敗しました'
                  : '会話を保存しましたが、録画のアップロードに失敗しました';
                setToast({
                  message: errorMessage,
                  type: 'error',
                });
              }
            } catch (uploadError) {
              console.error('録画アップロードエラー:', uploadError);
              // 録画アップロードエラーは警告のみ（会話と評価は保存済み）
              const errorMessage = evalData
                ? '会話と評価を保存しましたが、録画のアップロードに失敗しました'
                : '会話を保存しましたが、録画のアップロードに失敗しました';
              setToast({
                message: errorMessage,
                type: 'error',
              });
            }
          } else {
            console.warn('⚠️ 録画データがありません。録画を停止していない可能性があります。');
            setSavingProgress('completed');
            const successMessage = evalData
              ? '会話と評価を保存しました（録画データなし）'
              : '会話を保存しました（録画データなし）';
            setToast({
              message: successMessage,
              type: 'success',
            });
          }
        }
      } catch (saveError) {
          console.error('保存エラー:', saveError);
          // 保存エラーは致命的ではないので、警告のみ表示
          const errorMessage = evalData
            ? '講評は表示されましたが、会話の保存に失敗しました'
            : '会話の保存に失敗しました';
          setToast({
            message: errorMessage,
            type: 'error',
          });
        }
      }
    } finally {
      setIsLoadingEvaluation(false);
      // 保存処理完了後、3秒後に進捗状態をリセット
      setTimeout(() => {
        setSavingProgress('idle');
      }, 3000);
    }
  };

  return (
    <div className="min-h-[100dvh] min-h-[100svh] flex flex-col">
      <Header isConnected={isConnected} />

      {/* 予算制限の告知バナー（利用額超過時のみ表示） */}
      {/* 現在は非表示。将来的にAPI側で予算超過を検知した場合にエラーメッセージで対応 */}

      {/* メインコンテンツ - モバイル: 縦並び、デスクトップ: 横並び */}
      <main className="flex-1 flex flex-col lg:grid lg:gap-8 lg:grid-cols-[minmax(520px,1fr)_minmax(420px,0.9fr)] items-stretch pb-[calc(var(--footer-h)+env(safe-area-inset-bottom,0px)+1rem)] px-4 md:px-6 lg:px-10 xl:px-14 max-w-[1200px] mx-auto w-full relative transition-all">

        {/* モバイル: メディアを上部に固定表示 */}
        <section
          id="media-anchor"
          className="card flex flex-col justify-center items-center w-full max-w-[90vw] aspect-square mx-auto lg:max-w-none lg:max-h-[calc(100dvh-180px)] lg:min-h-[calc(100dvh-180px)] lg:aspect-auto overflow-hidden relative animate-floatIn mb-4 lg:mb-0 lg:order-2 flex-shrink-0 lg:sticky lg:top-4"
        >
          {/* カメラON && 画面共有OFF: カメラをメイン表示、アバターをPinP */}
          {isCameraActive && !isScreenSharing ? (
            <div className="h-full w-full relative">
              {/* メイン: カメラ映像（背景ぼかし機能付き） */}
              <CameraPip
                cameraVideoRef={cameraVideoRef}
                cameraStream={cameraStream}
                isRecording={isVideoRecording}
                recordingTime={videoRecordingTime}
                isFullscreen={true}
                backgroundMode={backgroundMode}
                blurIntensity={blurIntensity}
                onBackgroundModeChange={setBackgroundMode}
                onBlurIntensityChange={setBlurIntensity}
                onBlurredStreamReady={setBlurredCameraStream}
                hasSubtitle={!!mediaSubtitle}
              />

              {/* 字幕 */}
              {mediaSubtitle && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white px-4 py-3 text-sm text-center backdrop-blur-sm z-30">
                  <div className="line-clamp-2 transition-all duration-300">
                    {mediaSubtitle}
                  </div>
                </div>
              )}

              {/* PinP: アバター（左上） */}
              {imageSrc && (
                <div className="absolute top-4 left-4 w-32 h-32 bg-black rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-50">
                  <img
                    src={imageSrc}
                    alt="AI相談者のアバター"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
            </div>
          ) : (
            /* 通常表示（画面共有ON または カメラOFF） */
            <MediaPanel
              isRecording={isRecording}
              recordingState={recordingState}
              subtitle={mediaSubtitle}
              videoSrc={videoSrc}
              imageSrc={imageSrc}
              cameraVideoRef={cameraVideoRef}
              isCameraActive={isCameraActive}
              cameraStream={cameraStream}
              screenVideoRef={screenVideoRef}
              isScreenSharing={isScreenSharing}
              isVideoRecording={isVideoRecording}
              videoRecordingTime={videoRecordingTime}
              backgroundMode={backgroundMode}
              blurIntensity={blurIntensity}
              onBackgroundModeChange={setBackgroundMode}
              onBlurIntensityChange={setBlurIntensity}
              onBlurredStreamReady={setBlurredCameraStream}
            />
          )}
        </section>

        {/* モバイル: チャットを下部に表示（スクロール可能） */}
        <section
          id="chat-anchor"
          className="flex flex-col gap-4 w-full flex-1 lg:min-h-[calc(100dvh-180px)] lg:order-1"
        >
          {/* 顧客情報パネル */}
          <PersonaInfo persona={currentPersona} isVisible={!!currentPersona} />

          {/* チャットパネル */}
          <div className="card flex flex-col justify-center items-center w-full flex-1 overflow-hidden relative animate-floatIn">
            <ChatPanel messages={messages} scenarioId={selectedScenarioId} />
          </div>
        </section>
      </main>

      {/* エラー/状態メッセージ（下部中央上） */}
      {(cameraError || screenShareError || videoRecordingError) && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center max-w-md">
          {cameraError && (
            <div className="bg-red-500/95 text-white text-sm px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm">
              📷 {getErrorMessage()}
            </div>
          )}
          {screenShareError && getScreenShareErrorMessage() && (
            <div className="bg-red-500/95 text-white text-sm px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm">
              🖥️ {getScreenShareErrorMessage()}
            </div>
          )}
          {videoRecordingError && getVideoRecordingErrorMessage() && (
            <div className="bg-red-500/95 text-white text-sm px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm">
              🎬 {getVideoRecordingErrorMessage()}
            </div>
          )}
        </div>
      )}

      {/* VADモード中の音声検出表示を非表示（リアルタイムコメント表示があるため不要） */}

      {/* 統合コントロールバー（音声中心UI） */}
      <footer className="fixed bottom-2 sm:bottom-4 inset-x-0 mx-auto z-[50] safe-area-bottom px-2 sm:px-0">
        <div className="bg-white/10 backdrop-blur-2xl border border-white/20 shadow-2xl rounded-full px-3 sm:px-5 py-2 sm:py-3 mx-auto w-fit max-w-[calc(100vw-1rem)] transition-all duration-300 animate-floatIn overflow-x-auto">
          <div className="flex items-center justify-center gap-2 sm:gap-3 min-w-max">
            {/* 左側: Phase 2コントロール（録画系） */}
            <div className="flex items-center gap-2">
              {/* カメラボタン */}
              <button
                onClick={isCameraActive ? stopCamera : startCamera}
                disabled={isCameraLoading}
                className={`
                  relative w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-lg sm:text-2xl
                  transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed
                  ${isCameraActive
                    ? 'bg-white/20 text-white hover:bg-white/30'
                    : 'bg-red-500/90 text-white hover:bg-red-600'
                  }
                `}
                title={isCameraActive ? 'カメラをOFF' : 'カメラをON'}
                aria-label={isCameraActive ? 'カメラをオフにする' : 'カメラをオンにする'}
                aria-pressed={isCameraActive}
              >
                {isCameraLoading ? '⏳' : '📷'}
                {!isCameraActive && !isCameraLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-0.5 h-11 sm:h-14 bg-red-600 rotate-45"></div>
                  </div>
                )}
              </button>

              {/* 画面共有ボタン */}
              <button
                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                disabled={isScreenShareLoading}
                className={`
                  w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-lg sm:text-2xl
                  transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed
                  ${isScreenSharing
                    ? 'bg-blue-500/90 text-white hover:bg-blue-600'
                    : 'bg-white/20 text-white hover:bg-white/30'
                  }
                `}
                title={isScreenSharing ? '画面共有を停止' : '画面共有を開始'}
                aria-label={isScreenSharing ? '画面共有を停止する' : '画面共有を開始する'}
                aria-pressed={isScreenSharing}
              >
                {isScreenShareLoading ? '⏳' : '🖥️'}
              </button>

              {/* 録画ボタン */}
              <button
                onClick={isVideoRecording ? stopVideoRecording : startVideoRecording}
                disabled={!isCameraActive && !isScreenSharing}
                className={`
                  w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-lg sm:text-2xl
                  transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed
                  ${isVideoRecording
                    ? 'bg-red-500/90 text-white hover:bg-red-600 animate-pulse'
                    : 'bg-white/20 text-white hover:bg-white/30'
                  }
                `}
                aria-label={
                  !isCameraActive && !isScreenSharing
                    ? "カメラまたは画面共有をオンにしてから録画してください"
                    : isVideoRecording
                    ? "録画を停止する"
                    : "録画を開始する"
                }
                aria-pressed={isVideoRecording}
                title={
                  !isCameraActive && !isScreenSharing
                    ? "カメラまたは画面共有をONにしてから録画してください"
                    : isVideoRecording
                    ? "録画を停止"
                    : isScreenSharing
                    ? "画面全体を録画（画面共有+カメラ）"
                    : "カメラのみ録画（アバターと合成）"
                }
              >
                {isVideoRecording ? '⏺️' : '🎬'}
              </button>

              {/* 録画完了時: ダウンロード/クリアボタン */}
              {videoRecordingData && !isVideoRecording && (
                <>
                  <button
                    onClick={downloadVideoRecording}
                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-green-500/90 text-white hover:bg-green-600 flex items-center justify-center text-base sm:text-xl transition-all duration-200 hover:scale-110"
                    title="録画をダウンロード"
                  >
                    💾
                  </button>
                  <button
                    onClick={clearVideoRecording}
                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gray-500/90 text-white hover:bg-gray-600 flex items-center justify-center text-base sm:text-lg transition-all duration-200 hover:scale-110"
                    title="録画データをクリア"
                  >
                    🗑️
                  </button>
                </>
              )}

              {/* 録画時間表示 */}
              {isVideoRecording && (
                <div className="text-white text-sm font-mono bg-red-500/90 px-3 py-2 rounded-full">
                  {formatRecordingTime()}
                </div>
              )}

              {/* 録画完了メッセージ */}
              {videoRecordingData && !isVideoRecording && (
                <div className="text-white text-xs bg-green-500/90 px-3 py-2 rounded-full">
                  ✅ {(videoRecordingData.blob.size / 1024 / 1024).toFixed(1)}MB
                </div>
              )}
            </div>

            {/* アクションボタン */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleShowEvaluation}
                disabled={isLoadingEvaluation}
                className={`
                  w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-lg sm:text-2xl
                  transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed
                  bg-white/20 hover:bg-white/30 text-white
                `}
                title="講評を表示"
              >
                {isLoadingEvaluation ? '⏳' : '💬'}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-lg sm:text-2xl transition-all duration-200 hover:scale-110 bg-white/20 hover:bg-white/30 text-white"
                title="会話をクリア"
              >
                🗑️
              </button>
            </div>

            {/* 右端: マイクボタン（強調） */}
            <button
              type="button"
              onClick={handleToggleVAD}
              className={`
                w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center flex-shrink-0
                transition-all duration-200 hover:scale-110
                ${isVADMode
                  ? 'bg-red-500/90 hover:bg-red-600 animate-pulse shadow-xl shadow-red-500/50'
                  : 'bg-primary/90 hover:bg-primary shadow-xl shadow-primary/50'
                }
              `}
              aria-pressed={isVADMode}
              title={isVADMode ? '会話モード停止' : '会話モード開始'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-7 h-7 sm:w-8 sm:h-8 text-white"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
          </div>
        </div>
      </footer>

      {/* 状態バー（画面共有時は非表示にして画面が見えるようにする） */}
      {!isScreenSharing && !isRecording && (
        <div className="fixed bottom-0 left-0 right-0 bg-bg/80 backdrop-blur-sm border-t border-white/10 text-white text-xs px-4 py-2 text-center z-20 safe-area-bottom md:hidden">
          {isConnected ? '準備完了' : '接続中...'}
        </div>
      )}

      {/* 講評読み込み中のオーバーレイ */}
      {isLoadingEvaluation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]">
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl px-8 py-10 shadow-2xl max-w-md mx-4">
            <div className="flex flex-col items-center gap-6">
              {/* ローディングスピナー */}
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 border-4 border-primary/30 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-transparent border-t-primary rounded-full animate-spin"></div>
              </div>

              {/* メッセージ */}
              <div className="text-center">
                <h3 className="text-xl font-bold text-white mb-2">講評を作成中...</h3>
                <p className="text-white/80 text-sm">
                  AIが会話を分析しています。<br />
                  少々お待ちください。
                </p>
              </div>

              {/* プログレスバー（アニメーション） */}
              <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-purple-400 rounded-full animate-pulse" style={{ width: '70%' }}></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 講評シート */}
      <EvaluationSheet
        isOpen={showEvaluation}
        evaluation={evaluation}
        messages={messages}
        scenarioId={selectedScenarioId}
        isLoading={isLoadingEvaluation}
        savingProgress={savingProgress}
        onClose={() => {
          setShowEvaluation(false);
          setEvaluation(null);
        }}
      />

      {/* 確認ダイアログ */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="会話をクリア"
        message="会話履歴を削除しますか？この操作は取り消せません。"
        confirmLabel="削除"
        cancelLabel="キャンセル"
        onConfirm={handleConfirmClear}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* トースト */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* ペルソナ選択モーダル */}
      <PersonaSelector
        isOpen={showPersonaSelector}
        onSelect={(personaId, scenarioId, selectedDifficulty, personaData) => {
          selectedPersonaIdRef.current = personaId;
          setSelectedPersonaId(personaId);
          setSelectedScenarioId(scenarioId);
          if (selectedDifficulty) {
            setDifficulty(selectedDifficulty);
          }
          // ペルソナ情報を即座にセット（バックエンドからの応答を待たない）
          if (personaData) {
            setCurrentPersona(personaData);
            currentPersonaRef.current = personaData;
            console.log('[ペルソナ選択] 即座にセット:', personaData.persona_name);
          }
          setShowPersonaSelector(false);
        }}
        onClose={() => setShowPersonaSelector(false)}
      />

      {/* デバッグ情報（開発環境のみ） */}
      {import.meta.env.DEV && <DebugInfo />}
    </div>
  );
}

export default RoleplayApp;

