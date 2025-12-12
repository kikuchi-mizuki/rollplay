import { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { ChatPanel } from './components/ChatPanel';
import { MediaPanel } from './components/MediaPanel';
import { Composer } from './components/Composer';
import { EvaluationSheet } from './components/EvaluationSheet';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast } from './components/Toast';
import { Message, Evaluation, RecordingState } from './types';
import { getEvaluation, getScenarios, saveConversation, saveEvaluation } from './lib/api';
import { AudioRecorder, diagnoseMicrophone, MicrophoneDiagnostics } from './lib/audio';
import { useAuth } from './contexts/AuthContext';
import { getDefaultExpression, getExpressionForResponse, getExpressionImageUrl } from './lib/expressionSelector';
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
  const currentAudioRef = useRef<HTMLAudioElement | null>(null); // 現在再生中の音声（後方互換性のため残す）
  const audioContextRef = useRef<AudioContext | null>(null); // Web Audio API用のAudioContext
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null); // 現在再生中のAudioBufferSource

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

  // シナリオ選択時に、会話をリセット（ユーザーが最初に話しかける形式）
  useEffect(() => {
    if (selectedScenarioId) {
      // シナリオが切り替わったら会話をリセット
      setMessages([]);
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
  const handleSendStream = async (text: string, vadMode: boolean, t0?: number) => {
    if (!text.trim() || isSending) return;

    setIsSending(true);
    isSendingRef.current = true;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);

    // ⏱️ レイテンシー計測用（t0から引き継ぎ）
    let firstTokenReceived = false;
    let firstAudioPlayed = false;

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

        // イベント駆動型キューの待機をキャンセル
        if (resolveWaiter) {
          (resolveWaiter as () => void)();
          resolveWaiter = null;
        }

        console.log('✅ 音声停止完了（キュークリア、再生停止）');
      };

      // botメッセージを先に作成（考え中表示）
      const botMessageId = `bot-${Date.now()}`;
      const botMessage: Message = {
        id: botMessageId,
        role: 'bot',
        text: '...',  // ChatGPT風の考え中表示
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);

      // 🎭 t1: ユーザー発話終了 → thinking表情に先行変化（心理トリック）
      setImageSrc(getExpressionImageUrl(currentAvatarId, 'thinking'));
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

            try {
              // 各チャンクのテキストを字幕として表示（2行以内で切り替わる）
              setMediaSubtitle(chunkText);

              // ⏱️ 最初のTTS再生開始
              if (!firstAudioPlayed && t0) {
                const t3 = performance.now();
                console.log(`[latency] t3: TTS再生開始 (${t3.toFixed(0)}ms)`);
                console.log(`[latency] total (speech_end→tts_play): ${(t3 - (performance.timeOrigin + t0)).toFixed(0)}ms`);
                console.log(`[latency] gpt_first_token→tts_play: ${(t3 - (performance.timeOrigin + t0)).toFixed(0)}ms`);
                firstAudioPlayed = true;
              }

              // Web Audio APIで音声を再生（モバイル対応）
              // 再生中にサーバー側では次のTTSが生成されている（オーバーラップ）
              await playAudioWithWebAudio(audioData);
            } catch (error) {
              console.error('音声再生失敗:', error);
            } finally {
              // 必ず再生フラグをfalseに戻す（例外時も保証）
              isPlaying = false;
            }
          }
        }

        // ループ終了時の処理
        console.log('🛑 再生ループ終了');
        setMediaSubtitle('');
        if (isVADMode) {
          audioRecorderRef.resumeVAD();
        }
      };

      // 再生ループを起動（常駐・バックグラウンド実行）
      playbackLoop();

      // SSEでストリーミング受信
      const response = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          history: messages.map(m => ({ speaker: m.role === 'user' ? '営業' : '顧客', text: m.text })),
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
                if (!firstTokenReceived && t0) {
                  const t2 = performance.now();
                  console.log(`[latency] t2: GPT最初のトークン受信 (${t2.toFixed(0)}ms)`);
                  console.log(`[latency] whisper→gpt_first_token: ${(t2 - (performance.timeOrigin + t0)).toFixed(0)}ms`);
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

      // SSEストリーム完了後、再生ループを停止
      playbackLoopRunning = false;

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

      // AIの返答から適切な表情画像を選択（文脈ベース・自然な切り替え）
      // 直近の会話履歴を変換（expressionSelector用の形式に）※より長い文脈を見る
      const recentMessagesForExpression = messages.slice(-10).map(msg => ({
        role: (msg.role === 'bot' ? 'assistant' : 'user') as 'user' | 'assistant',
        text: msg.text
      }));

      const expressionImageUrl = getExpressionForResponse(
        fullText,
        currentAvatarId,
        recentMessagesForExpression,
        text // 営業の質問内容
      );

      // 前回と同じ表情の場合は切り替えない（自然な会話を維持）
      if (expressionImageUrl !== lastExpressionRef.current) {
        console.log(`[アバター] 表情を切り替え: ${lastExpressionRef.current} → ${expressionImageUrl}`);
        setImageSrc(expressionImageUrl);
        setVideoSrc(undefined);
        lastExpressionRef.current = expressionImageUrl;
      } else {
        console.log(`[アバター] 表情は同じなので切り替えなし: ${expressionImageUrl}`);
      }

    } catch (error) {
      console.error('ストリーミング送信エラー:', error);
      setToast({
        message: 'メッセージの送信に失敗しました。もう一度お試しください。',
        type: 'error',
      });

      // エラー時は割り込みモードを無効化してVADを再開
      if (isVADMode) {
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

        // 再生終了時のコールバック
        source.onended = () => {
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

  const handleSend = async (text: string, t0?: number) => {
    // 音声を初期化（初回のみ・モバイル対応）
    if (!audioInitialized) {
      await initializeAudio();
    }

    // ストリーミング対応版を使用（現在のVADモード状態を渡す - Refから取得）
    await handleSendStream(text, isVADModeRef.current, t0);
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

              if (!response.ok) {
                throw new Error(`サーバーエラー (${response.status}): ${rawText || '応答なし'}`);
              }

              const result = JSON.parse(rawText);

              if (result.success && result.text) {
                // handleSendがisSendingをfalseにするまで待つ（t0を渡す）
                await handleSend(result.text, t0);
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
          <MediaPanel
            isRecording={isRecording}
            recordingState={recordingState}
            subtitle={mediaSubtitle}
            videoSrc={videoSrc}
            imageSrc={imageSrc}
          />
        </section>

        {/* モバイル: チャットを下部に表示（スクロール可能） */}
        <section
          id="chat-anchor"
          className="card flex flex-col justify-center items-center w-full flex-1 lg:min-h-[calc(100dvh-180px)] overflow-hidden relative animate-floatIn lg:order-1"
        >
          <ChatPanel messages={messages} />
        </section>
      </main>

      {/* フッター: 入力エリア */}
      <footer className="fixed bottom-4 inset-x-0 mx-auto w-[92%] max-w-3xl z-[50] safe-area-bottom">
        <div className="bg-white/10 backdrop-blur-2xl border border-white/10 shadow-xl rounded-2xl px-5 py-3 transition-all duration-300 animate-floatIn">
          <Composer
            onSend={handleSend}
            isRecording={isRecording}
            recordingState={recordingState}
            isSending={isSending}
            onClear={handleClear}
            onShowEvaluation={handleShowEvaluation}
            isLoadingEvaluation={isLoadingEvaluation}
            onToggleVAD={handleToggleVAD}
            isVADMode={isVADMode}
          />
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

