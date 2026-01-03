import { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { ChatPanel } from './components/ChatPanel';
import { MediaPanel } from './components/MediaPanel';
import { EvaluationSheet } from './components/EvaluationSheet';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast } from './components/Toast';
import { Message, Evaluation, RecordingState } from './types';
import { getEvaluation, getScenarios, saveConversation, saveEvaluation } from './lib/api';
import { AudioRecorder, diagnoseMicrophone, MicrophoneDiagnostics } from './lib/audio';
import { useAuth } from './contexts/AuthContext';
import { getDefaultExpression, getExpressionForResponse, getExpressionImageUrl } from './lib/expressionSelector';
import { useCamera } from './hooks/useCamera'; // Phase 2: カメラアクセス
import { useScreenShare } from './hooks/useScreenShare'; // Phase 2 Day 3: 画面共有
import { useRecording } from './hooks/useRecording'; // Phase 2 Day 4: 録画機能
import { useBackgroundBlur } from './hooks/useBackgroundBlur'; // Phase 2: 背景ぼかし
// import { useDIDAvatar } from './components/DIDAvatar';
// import { AvatarManager } from './components/AvatarManager';
// import { Avatar } from './lib/avatarManager';

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
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toast, setToast] = useState<{ message: string; type?: 'success' | 'error' | 'info' } | null>(null);
  const [isConnected] = useState(true);
  const [mediaSubtitle, setMediaSubtitle] = useState<string>('');
  const [videoSrc, setVideoSrc] = useState<string | undefined>(); // 動画のURL
  const [imageSrc, setImageSrc] = useState<string | undefined>(getDefaultExpression('avatar_03')); // アバター画像（デフォルト表情）
  const [scenarios, setScenarios] = useState<{ id: string; title: string; enabled: boolean }[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [_conversationId, setConversationId] = useState<string | null>(null);
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
  const isSendingRef = useRef(false); // isSendingのRef（VAD重複防止のため）
  const messagesRef = useRef<Message[]>([]); // messagesの最新値を保持（ステート更新タイミング問題を回避）
  const currentAudioRef = useRef<HTMLAudioElement | null>(null); // 現在再生中の音声（後方互換性のため残す）
  const audioContextRef = useRef<AudioContext | null>(null); // Web Audio API用のAudioContext
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null); // 現在再生中のAudioBufferSource

  // Phase 2: カメラアクセス
  const {
    cameraStream: _cameraStream, // Day 4（録画機能）で使用予定
    isCameraActive,
    cameraError,
    isLoading: isCameraLoading,
    cameraVideoRef,
    startCamera,
    stopCamera,
    getErrorMessage,
  } = useCamera();

  // Phase 2: 背景ぼかし
  const {
    isBlurEnabled,
    toggleBlur,
    processedStream: blurredStream,
    isProcessing: isBlurProcessing,
  } = useBackgroundBlur(_cameraStream);

  // 背景ぼかしが有効な場合は処理済みストリームを使用、それ以外は元のストリームを使用
  const cameraStream = blurredStream || _cameraStream;

  // Phase 2 Day 3: 画面共有
  const {
    screenStream: _screenStream, // Day 6（合成録画）で使用予定
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
    startRecording: startVideoRecording,
    stopRecording: stopVideoRecording,
    clearRecording: clearVideoRecording,
    downloadRecording: downloadVideoRecording,
    getErrorMessage: getVideoRecordingErrorMessage,
    formatRecordingTime,
  } = useRecording({
    cameraStream: _cameraStream,
    screenStream: _screenStream,
  }); // 画面共有+カメラの場合はCanvas合成録画、カメラのみの場合はカメラ録画

  // アバター管理（将来実装予定）
  // const [showAvatarManager, setShowAvatarManager] = useState(false);
  // const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null);

  // D-IDアバター統合（無効化 - タイムラグ対策）
  // const { loading: didLoading, generateAndPlayVideo } = useDIDAvatar();

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
      conversationStartTime.current = new Date(); // 会話開始時刻を記録

      // デフォルト表情（listening）の静止画を表示（avatar_03固定）
      const defaultExpression = getDefaultExpression(currentAvatarId);
      setImageSrc(defaultExpression);
      setVideoSrc(undefined); // 静止画を使用するため動画はクリア
      lastExpressionRef.current = defaultExpression; // 前回の表情を記憶

      // 字幕をクリア（ユーザーが最初に話しかけるまで何も表示しない）
      setMediaSubtitle('');
    }
  }, [selectedScenarioId]);

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

        // SSEストリームを中断
        if (streamReader) {
          streamReader.cancel();
          streamReader = null;
          console.log('📡 SSEストリーム中断');
        }

        // Web Audio APIのソースを停止
        if (currentAudioSourceRef.current) {
          try {
            currentAudioSourceRef.current.stop();
            currentAudioSourceRef.current.onended = null;
            currentAudioSourceRef.current = null;
            console.log('🔇 Web Audio API音声停止');
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
        console.log('🔄 再生ループ開始（イベント駆動型・オーバーラップ対応）');

        while (playbackLoopRunning) {
          // キューに何か来るまで待つ（イベント駆動型、50ms遅延なし）
          await waitForQueue();
          if (!playbackLoopRunning) break;

          // キューにチャンクがあり、再生中でなければ即座に再生
          if (audioQueue.length > 0 && !isPlaying) {
            const item = audioQueue.shift()!;
            const { audio: audioData, text: chunkText } = item;
            isPlaying = true;

            // デバッグ: 音声データのサイズを確認
            console.log(`📦 [デバッグ] チャンク取り出し: "${chunkText}" (データサイズ: ${audioData.byteLength} bytes)`);

            try {
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
              console.log(`▶️ [デバッグ] 音声再生開始: "${chunkText}"`);
              await playAudioWithWebAudio(audioData);
              console.log(`✅ [デバッグ] 音声再生完了: "${chunkText}"`);

              // チャンク間に自然な間隔を追加（100ms）
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
              console.error(`❌ 音声再生失敗: "${chunkText}"`, error);
            } finally {
              // 必ず再生フラグをfalseに戻す（例外時も保証）
              isPlaying = false;
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
      };

      // 再生ループを起動（常駐・バックグラウンド実行）
      playbackLoop();

      // 🔍 デバッグ: 送信する会話履歴を確認（プレースホルダーを含めないhistoryBeforeBotを使用）
      const historyToSend = historyBeforeBot.map(m => ({ speaker: m.role === 'user' ? '営業' : '顧客', text: m.text }));
      console.log(`[会話履歴送信] 件数: ${historyToSend.length}`);
      historyToSend.slice(-5).forEach((h, i) => {
        console.log(`  [${i}] ${h.speaker}: ${h.text.substring(0, 50)}...`);
      });

      // SSEでストリーミング受信
      const response = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          history: historyToSend,
          scenario_id: selectedScenarioId
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
                setToast({ message: 'エラーが発生しました', type: 'error' });
                continue;
              }

              if (data.audio) {
                // ⏱️ GPT最初のトークン受信
                if (!firstTokenReceived && t1) {
                  t2 = performance.now();
                  console.log(`[latency] t2: GPT最初のトークン受信 (${t2.toFixed(0)}ms)`);
                  console.log(`[latency] whisper→gpt_first_token: ${(t2 - t1).toFixed(0)}ms`);
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

                // 音声キューに追加（音声とテキストをペアで管理）
                // 再生ループが自動的に取り出して再生する（オーバーラップ）
                audioQueue.push({ audio: bytes.buffer, text: data.text || '' });
                fullText += data.text || '';

                // イベント駆動型キュー：待機中のループを即座に起こす
                if (resolveWaiter) {
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
      console.log(`⏳ [デバッグ] ストリーム完了。残りチャンク数: ${audioQueue.length}`);
      while (audioQueue.length > 0 || isPlaying) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.log(`✅ [デバッグ] 全チャンク再生完了。再生ループを停止します。`);

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
      setToast({
        message: 'メッセージの送信に失敗しました。もう一度お試しください。',
        type: 'error',
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

  // Web Audio API初期化（モバイル自動再生ポリシー対応）
  const initializeAudio = async () => {
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

      // ダミーの無音バッファを再生して許可を得る
      const buffer = audioContext.createBuffer(1, 1, 22050);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(0);

      setAudioInitialized(true);
      console.log('✅ Web Audio API初期化成功');
      return audioContext;
    } catch (error) {
      console.warn('⚠️ Web Audio API初期化失敗:', error);
      return null;
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

        // AudioBufferSourceを作成
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        currentAudioSourceRef.current = source; // 停止用に保存

        // 再生終了時のコールバック（メモリクリーンアップ）
        source.onended = () => {
          // メモリリーク防止：明示的にdisconnectして参照をクリア
          try {
            source.disconnect();
            source.buffer = null;
          } catch (e) {
            // 既にdisconnect済みの場合はエラーを無視
          }
          currentAudioSourceRef.current = null;
          resolve();
        };

        // 再生開始
        source.start(0);
        console.log('🔊 Web Audio APIで音声再生開始');
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
        await audioRecorderRef.startVAD(
          // 音声検出時のコールバック
          () => {
            console.log('🎤 話し始めました');
            setIsRecording(true);
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

            // Whisper APIで音声認識
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

              // 💬 字幕は空のままAI回答を待つ（最速で回答を表示）
              // 不要な「考えている表現」は削除し、AI回答の最初のチャンクをできるだけ早く表示する

              if (!response.ok) {
                throw new Error(`サーバーエラー (${response.status}): ${rawText || '応答なし'}`);
              }

              const result = JSON.parse(rawText);

              if (result.success && result.text) {
                // VAD録音経由なので、vadMode=trueを明示的に渡す
                // handleSendではなくhandleSendStreamを直接呼ぶ
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
              setToast({
                message: '音声認識に失敗しました。',
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

    setIsLoadingEvaluation(true);
    try {
      // 講評を取得（Week 5: シナリオIDを渡す）
      const evalData = await getEvaluation(messages, selectedScenarioId);
      setEvaluation(evalData);
      setShowEvaluation(true);

      // 会話履歴を保存（Supabase統合）
      if (user && profile?.store_id) {
        try {
          // 会話時間を計算
          const durationSeconds = conversationStartTime.current
            ? Math.floor((new Date().getTime() - conversationStartTime.current.getTime()) / 1000)
            : undefined;

          // シナリオタイトルを取得
          const scenarioTitle = scenarios.find(s => s.id === selectedScenarioId)?.title || selectedScenarioId;

          // 会話を保存
          const { conversationId: newConversationId } = await saveConversation({
            userId: user.id,
            storeId: profile.store_id,
            scenarioId: selectedScenarioId,
            scenarioTitle,
            messages,
            durationSeconds,
          });

          setConversationId(newConversationId);
          console.log('✅ 会話履歴を保存しました:', newConversationId);

          // 評価を保存
          if (newConversationId) {
            await saveEvaluation({
              conversationId: newConversationId,
              userId: user.id,
              storeId: profile.store_id,
              scenarioId: selectedScenarioId,
              evaluation: evalData,
            });
            console.log('✅ 評価結果を保存しました');

            setToast({
              message: '会話と評価を保存しました',
              type: 'success',
            });
          }
        } catch (saveError) {
          console.error('保存エラー:', saveError);
          // 保存エラーは致命的ではないので、警告のみ表示
          setToast({
            message: '評価は表示されましたが、保存に失敗しました',
            type: 'error',
          });
        }
      }
    } catch (error) {
      console.error('講評取得エラー:', error);
      setToast({
        message: '講評の取得に失敗しました。',
        type: 'error',
      });
    } finally {
      setIsLoadingEvaluation(false);
    }
  };

  return (
    <div className="min-h-[100dvh] min-h-[100svh] flex flex-col">
      <Header 
        isConnected={isConnected} 
        scenarios={scenarios}
        selectedScenarioId={selectedScenarioId}
        onScenarioChange={setSelectedScenarioId}
      />

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
              {/* メイン: カメラ映像 */}
              <div className="h-full w-full relative bg-black/80 rounded-2xl flex items-center justify-center overflow-hidden">
                {cameraVideoRef && (
                  <video
                    ref={cameraVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    aria-label="カメラプレビュー"
                  />
                )}

                {/* 録画インジケーター */}
                {isVideoRecording && (
                  <div className="absolute top-4 right-4 bg-red-500/90 text-white text-xs px-3 py-1 rounded-full flex items-center gap-2 animate-pulse">
                    <div className="w-2 h-2 bg-white rounded-full"></div>
                    REC {Math.floor(videoRecordingTime / 60)}:{String(videoRecordingTime % 60).padStart(2, '0')}
                  </div>
                )}

                {/* 字幕 */}
                {mediaSubtitle && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white px-4 py-3 text-sm text-center backdrop-blur-sm">
                    <div className="line-clamp-2 transition-all duration-300">
                      {mediaSubtitle}
                    </div>
                  </div>
                )}

                {/* PinP: アバター（左上） */}
                {imageSrc && (
                  <div className="absolute top-4 left-4 w-32 h-32 bg-black rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-10">
                    <img
                      src={imageSrc}
                      alt="AI相談者のアバター"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>
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
            />
          )}
        </section>

        {/* モバイル: チャットを下部に表示（スクロール可能） */}
        <section
          id="chat-anchor"
          className="card flex flex-col justify-center items-center w-full flex-1 lg:min-h-[calc(100dvh-180px)] overflow-hidden relative animate-floatIn lg:order-1"
        >
          <ChatPanel messages={messages} />
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

      {/* VADモード中の音声検出表示 */}
      {isVADMode && isRecording && recordingState && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[60] bg-primary/20 backdrop-blur-xl border border-primary/30 rounded-2xl px-6 py-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className="wave-bar w-1 bg-primary rounded-full"
                  style={{
                    height: `${Math.max(20, recordingState.level * 0.5)}%`,
                    minHeight: '8px',
                    animationDelay: `${i * 0.05}s`,
                  }}
                />
              ))}
            </div>
            <span className="text-sm font-medium text-primary">
              {Math.floor(recordingState.duration / 60)}:{String(recordingState.duration % 60).padStart(2, '0')}
            </span>
          </div>
        </div>
      )}

      {/* 統合コントロールバー（音声中心UI） */}
      <footer className="fixed bottom-4 inset-x-0 mx-auto z-[50] safe-area-bottom">
        <div className="bg-white/10 backdrop-blur-2xl border border-white/20 shadow-2xl rounded-full px-5 py-3 mx-auto w-fit transition-all duration-300 animate-floatIn">
          <div className="flex items-center justify-center gap-3">
            {/* 左側: Phase 2コントロール（録画系） */}
            <div className="flex items-center gap-2">
              {/* カメラボタン */}
              <button
                onClick={isCameraActive ? stopCamera : startCamera}
                disabled={isCameraLoading}
                className={`
                  relative w-14 h-14 rounded-full flex items-center justify-center text-2xl
                  transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed
                  ${isCameraActive
                    ? 'bg-white/20 text-white hover:bg-white/30'
                    : 'bg-red-500/90 text-white hover:bg-red-600'
                  }
                `}
                title={isCameraActive ? 'カメラをOFF' : 'カメラをON'}
              >
                {isCameraLoading ? '⏳' : '📷'}
                {!isCameraActive && !isCameraLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-0.5 h-14 bg-red-600 rotate-45"></div>
                  </div>
                )}
              </button>

              {/* 背景ぼかしボタン（カメラON時のみ表示） */}
              {isCameraActive && (
                <button
                  onClick={toggleBlur}
                  disabled={isBlurProcessing}
                  className={`
                    w-12 h-12 rounded-full flex items-center justify-center text-xl
                    transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed
                    ${isBlurEnabled
                      ? 'bg-purple-500/90 text-white hover:bg-purple-600'
                      : 'bg-white/20 text-white hover:bg-white/30'
                    }
                  `}
                  title={isBlurEnabled ? '背景ぼかしをOFF' : '背景ぼかしをON'}
                >
                  {isBlurProcessing ? '⏳' : '🎨'}
                </button>
              )}

              {/* 画面共有ボタン */}
              <button
                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                disabled={isScreenShareLoading}
                className={`
                  w-14 h-14 rounded-full flex items-center justify-center text-2xl
                  transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed
                  ${isScreenSharing
                    ? 'bg-blue-500/90 text-white hover:bg-blue-600'
                    : 'bg-white/20 text-white hover:bg-white/30'
                  }
                `}
                title={isScreenSharing ? '画面共有を停止' : '画面共有を開始'}
              >
                {isScreenShareLoading ? '⏳' : '🖥️'}
              </button>

              {/* 録画ボタン */}
              <button
                onClick={isVideoRecording ? stopVideoRecording : startVideoRecording}
                disabled={!isCameraActive && !isScreenSharing}
                className={`
                  w-14 h-14 rounded-full flex items-center justify-center text-2xl
                  transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed
                  ${isVideoRecording
                    ? 'bg-red-500/90 text-white hover:bg-red-600 animate-pulse'
                    : 'bg-white/20 text-white hover:bg-white/30'
                  }
                `}
                title={
                  !isCameraActive && !isScreenSharing
                    ? "カメラまたは画面共有をONにしてください"
                    : isVideoRecording
                    ? "録画を停止"
                    : "録画を開始"
                }
              >
                {isVideoRecording ? '⏺️' : '🎬'}
              </button>

              {/* 録画完了時: ダウンロード/クリアボタン */}
              {videoRecordingData && !isVideoRecording && (
                <>
                  <button
                    onClick={downloadVideoRecording}
                    className="w-12 h-12 rounded-full bg-green-500/90 text-white hover:bg-green-600 flex items-center justify-center text-xl transition-all duration-200 hover:scale-110"
                    title="録画をダウンロード"
                  >
                    💾
                  </button>
                  <button
                    onClick={clearVideoRecording}
                    className="w-12 h-12 rounded-full bg-gray-500/90 text-white hover:bg-gray-600 flex items-center justify-center text-lg transition-all duration-200 hover:scale-110"
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
                  w-14 h-14 rounded-full flex items-center justify-center text-2xl
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
                className="w-14 h-14 rounded-full flex items-center justify-center text-2xl transition-all duration-200 hover:scale-110 bg-white/20 hover:bg-white/30 text-white"
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
                w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0
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
                className="w-8 h-8 text-white"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
          </div>
        </div>
      </footer>

      {/* 状態バー */}
      <div className="fixed bottom-0 left-0 right-0 bg-bg/80 backdrop-blur-sm border-t border-white/10 text-white text-xs px-4 py-2 text-center z-20 safe-area-bottom md:hidden">
        {isRecording
          ? `録音中... ${recordingState ? `${Math.floor(recordingState.duration / 60)}:${String(recordingState.duration % 60).padStart(2, '0')}` : ''}`
          : isConnected
          ? '準備完了'
          : '接続中...'}
      </div>

      {/* 講評シート */}
      <EvaluationSheet
        isOpen={showEvaluation}
        evaluation={evaluation}
        messages={messages}
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
    </div>
  );
}

export default RoleplayApp;

