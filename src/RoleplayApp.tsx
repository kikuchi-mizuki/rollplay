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
import { AudioRecorder } from './lib/audio';
import { useAuth } from './contexts/AuthContext';
import { getDefaultExpression, getExpressionForResponse } from './lib/expressionSelector';
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

  const audioRecorderRef = useState(() => new AudioRecorder())[0];
  const [_speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const [_voiceCount, setVoiceCount] = useState(0);
  const [speechInitialized, setSpeechInitialized] = useState(false);
  const [isVADMode, setIsVADMode] = useState(false); // VAD（会話モード）のON/OFF

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
      setImageSrc(getDefaultExpression(currentAvatarId));
      setVideoSrc(undefined); // 静止画を使用するため動画はクリア

      // 字幕をクリア（ユーザーが最初に話しかけるまで何も表示しない）
      setMediaSubtitle('');
    }
  }, [selectedScenarioId]);

  /**
   * ストリーミング対応の音声再生
   * SSEで音声チャンクを受信して即座に再生
   */
  const handleSendStream = async (text: string, vadMode: boolean) => {
    if (!text.trim() || isSending) return;

    setIsSending(true);

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      // 音声チャンクキュー
      const audioQueue: ArrayBuffer[] = [];
      let isPlaying = false;
      let fullText = '';
      let currentAudio: HTMLAudioElement | null = null; // 現在再生中の音声
      let interruptModeEnabled = false; // 割り込みモード有効化フラグ

      // 割り込み時に全ての音声を停止
      const stopAllAudio = () => {
        console.log('🛑 全音声停止（割り込み）');
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudio = null;
        }
        audioQueue.length = 0; // キューをクリア
        isPlaying = false;
        interruptModeEnabled = false;
        audioRecorderRef.disableInterruptMode();
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

      // 音声チャンクを順次再生
      const playNextChunk = async () => {
        if (audioQueue.length > 0 && !isPlaying) {
          isPlaying = true;
          const audioData = audioQueue.shift()!;

          try {
            // Blobから音声を再生
            const blob = new Blob([audioData], { type: 'audio/mpeg' });
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            currentAudio = audio; // 現在の音声を保持

            audio.onended = () => {
              URL.revokeObjectURL(audioUrl);
              isPlaying = false;

              // 次のチャンクがある場合は再生を続ける
              if (audioQueue.length > 0) {
                playNextChunk();
              } else {
                // 全ての音声再生が完了したらVADを再開
                if (isVADMode) {
                  audioRecorderRef.resumeVAD();
                }
              }
            };

            audio.onerror = (e) => {
              console.error('音声再生エラー:', e);
              isPlaying = false;

              // エラーでも次のチャンクを試す
              if (audioQueue.length > 0) {
                playNextChunk();
              } else {
                // 全て終了したらVADを再開
                if (isVADMode) {
                  audioRecorderRef.resumeVAD();
                }
              }
            };

            await audio.play();
          } catch (error) {
            console.error('音声再生失敗:', error);
            isPlaying = false;

            // エラーでも次のチャンクを試す
            if (audioQueue.length > 0) {
              playNextChunk();
            } else {
              // 全て終了したらVADを再開
              if (isVADMode) {
                audioRecorderRef.resumeVAD();
              }
            }
          }
        }
      };

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
                // Base64デコード
                const binaryString = atob(data.audio);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }

                // 音声キューに追加
                audioQueue.push(bytes.buffer);
                fullText += data.text || '';

                // 最初の音声チャンク受信時に割り込みモードを有効化（一度だけ）
                if (vadMode && !interruptModeEnabled) {
                  interruptModeEnabled = true;
                  audioRecorderRef.enableInterruptMode(stopAllAudio);
                  console.log('🎯 割り込みモード有効化');
                }

                // 字幕をリアルタイム更新（ChatGPTのようにストリーミング表示）
                setMediaSubtitle(fullText);

                // チャットもリアルタイム更新（ストリーミング表示）
                setMessages((prev) =>
                  prev.map(msg =>
                    msg.id === botMessageId
                      ? { ...msg, text: fullText }
                      : msg
                  )
                );

                // 再生開始
                if (!isPlaying) {
                  playNextChunk();
                }

                console.log(`[チャンク${data.chunk}] 受信・再生: ${data.text}`);
              }
            } catch (e) {
              console.error('JSON parse error:', e);
            }
          }
        }
      }

      // 最終的な字幕更新（念のため）
      setMediaSubtitle(fullText);

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

      // AIの返答から適切な表情画像を選択
      const expressionImageUrl = getExpressionForResponse(fullText, currentAvatarId);
      setImageSrc(expressionImageUrl);
      setVideoSrc(undefined);

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
    }
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

    // 短いテストメッセージで音声を初期化
    const utterance = new SpeechSynthesisUtterance('音声を有効化しました');
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

  const handleSend = async (text: string) => {
    // ストリーミング対応版を使用（現在のVADモード状態を渡す）
    await handleSendStream(text, isVADMode);
  };

  const handleStartRecording = async () => {
    try {
      await audioRecorderRef.start();
      setIsRecording(true);
      setRecordingState(audioRecorderRef.getState());
    } catch (error) {
      console.error('録音開始エラー:', error);
      setToast({
        message: 'マイクへのアクセスが許可されていません。ブラウザの設定をご確認ください。',
        type: 'error',
      });
    }
  };

  const handleStopRecording = async () => {
    try {
      // 録音時間を確認
      const recordingDuration = audioRecorderRef.getState().duration;
      console.log('録音時間:', recordingDuration, '秒');

      // 最小録音時間チェック（2秒未満はエラー）
      if (recordingDuration < 2) {
        setIsRecording(false);
        setRecordingState(undefined);
        // 録音を停止してクリーンアップ
        await audioRecorderRef.stop();
        setToast({
          message: `録音時間が短すぎます（${recordingDuration}秒）。最低2秒以上録音してください。`,
          type: 'error',
        });
        return;
      }

      const audioBlob = await audioRecorderRef.stop();
      setIsRecording(false);
      setRecordingState(undefined);

      if (!audioBlob || audioBlob.size === 0) {
        console.error('録音データが空:', { audioBlob, size: audioBlob?.size });
        setToast({
          message: '録音データが空でした。もう一度お試しください。',
          type: 'error',
        });
        return;
      }

      // 録音データのサイズチェック
      console.log('録音データ:', {
        size: audioBlob.size,
        type: audioBlob.type,
        sizeKB: (audioBlob.size / 1024).toFixed(2) + ' KB',
        duration: recordingDuration + '秒'
      });

      // 最小サイズチェック（2KB未満はエラー）
      if (audioBlob.size < 2048) {
        console.error('録音データが小さすぎます:', audioBlob.size, 'bytes');
        setToast({
          message: `録音データが小さすぎます（${(audioBlob.size / 1024).toFixed(2)} KB）。2秒以上録音してください。`,
          type: 'error',
        });
        return;
      }

      // Whisper APIで音声認識
      const formData = new FormData();
      const mimeType = audioBlob.type || 'audio/webm';
      let ext = mimeType.includes('webm') ? 'webm'
             : mimeType.includes('mp4') ? 'mp4'
             : mimeType.includes('ogg') ? 'ogg'
             : mimeType.includes('wav') ? 'wav'
             : 'bin';
      formData.append('audio', audioBlob, `recording.${ext}`);
      console.log('FormData作成:', { ext, mimeType });

      setIsSending(true);
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      const rawText = await response.text();
      setIsSending(false);

      if (!response.ok) {
        throw new Error(`サーバーエラー (${response.status}): ${rawText || '応答なし'}`);
      }

      if (!rawText) {
        throw new Error('サーバーからの応答が空でした。');
      }

      let result: { success?: boolean; text?: string; error?: string };
      try {
        result = JSON.parse(rawText);
      } catch (err) {
        throw new Error(`JSON解析に失敗しました: ${rawText.substring(0, 200)}`);
      }

      if (result.success && result.text) {
        await handleSend(result.text);
      } else {
        setToast({
          message: result.error || '音声認識に失敗しました。もう一度お試しください。',
          type: 'error',
        });
      }
    } catch (error) {
      console.error('録音停止エラー:', error);
      setIsSending(false);
      setToast({
        message: '録音の処理に失敗しました。',
        type: 'error',
      });
    }
  };

  // VAD（会話モード）のトグル
  const handleToggleVAD = async () => {
    if (isVADMode) {
      // VADモード停止
      audioRecorderRef.stopVAD();
      setIsVADMode(false);
      setToast({
        message: '会話モードを停止しました',
        type: 'info',
      });
    } else {
      // VADモード開始
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
            try {
              const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
              });

              const rawText = await response.text();

              if (!response.ok) {
                throw new Error(`サーバーエラー (${response.status}): ${rawText || '応答なし'}`);
              }

              const result = JSON.parse(rawText);

              if (result.success && result.text) {
                // handleSendがisSendingをfalseにするまで待つ
                await handleSend(result.text);
              } else {
                setIsSending(false);
                setToast({
                  message: result.error || '音声認識に失敗しました。',
                  type: 'error',
                });
              }
            } catch (error) {
              console.error('音声認識エラー:', error);
              setIsSending(false);
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
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            isRecording={isRecording}
            recordingState={recordingState}
            isSending={isSending}
            onClear={handleClear}
            onShowEvaluation={handleShowEvaluation}
            isLoadingEvaluation={isLoadingEvaluation}
            onInitializeSpeech={initializeSpeech}
            speechInitialized={speechInitialized}
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

