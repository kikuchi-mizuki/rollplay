import { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { ChatPanel } from './components/ChatPanel';
import { MediaPanel } from './components/MediaPanel';
import { Composer } from './components/Composer';
import { EvaluationSheet } from './components/EvaluationSheet';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast } from './components/Toast';
import { Message, Evaluation, RecordingState } from './types';
import { sendMessage, getEvaluation, getScenarios, saveConversation, saveEvaluation } from './lib/api';
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
  const [showMedia, setShowMedia] = useState(false); // モバイル時のメディア表示状態（デフォルト: チャット表示）
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

  // Web Speech APIで即座に音声出力（モバイル対応強化）
  const speakTextWithWebSpeech = (text: string) => {
    if (!('speechSynthesis' in window)) {
      console.error('❌ Web Speech APIがサポートされていません');
      setToast({
        message: 'お使いのブラウザは音声再生に対応していません',
        type: 'error',
      });
      return;
    }

    // 既存の音声をキャンセル
    speechSynthesis.cancel();

    const speak = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ja-JP';

      // 利用可能な音声を取得
      let voices = speechSynthesis.getVoices();
      console.log('🔊 利用可能な音声数:', voices.length);

      // モバイルの場合、音声リストが空の可能性がある（非同期読み込み）
      if (voices.length === 0) {
        console.warn('⚠️ 音声リストが空です。voiceschangedイベントを待機...');
        // 音声リストの読み込みを待つ
        const loadVoices = () => {
          voices = speechSynthesis.getVoices();
          console.log('🔊 音声リスト読み込み完了:', voices.length, '個');
          if (voices.length > 0) {
            speechSynthesis.removeEventListener('voiceschanged', loadVoices);
            selectVoiceAndSpeak(utterance, voices, text);
          }
        };
        speechSynthesis.addEventListener('voiceschanged', loadVoices);
        // 既に読み込まれている可能性もあるので、すぐに確認
        setTimeout(() => {
          voices = speechSynthesis.getVoices();
          if (voices.length > 0) {
            selectVoiceAndSpeak(utterance, voices, text);
          }
        }, 100);
        return;
      }

      selectVoiceAndSpeak(utterance, voices, text);
    };

    const selectVoiceAndSpeak = (utterance: SpeechSynthesisUtterance, voices: SpeechSynthesisVoice[], text: string) => {
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
        console.log('✅ 使用する音声:', preferredVoice.name, '(', preferredVoice.lang, ')');
      } else {
        console.warn('⚠️ 日本語音声が見つかりませんでした。デフォルト音声を使用します');
        // デバッグ用に全音声を表示
        console.log('📋 利用可能な音声一覧:');
        voices.forEach((v, i) => console.log(`  ${i + 1}. ${v.name} (${v.lang})`));
      }

      // avatar_03（30代女性）の音声設定 - より自然な話し方
      utterance.pitch = 1.0;   // 標準的な女性の声
      utterance.rate = 0.9;    // 自然な会話ペース
      utterance.volume = 1.0;  // 最大音量

      // エラーハンドリング
      utterance.onerror = (event) => {
        console.error('❌ 音声再生エラー:', event.error);
        if (event.error === 'not-allowed') {
          console.error('⚠️ 音声再生が許可されていません。ユーザーインタラクションが必要です');
        }
      };

      utterance.onstart = () => {
        console.log('🔊 音声再生開始:', text.substring(0, 30) + '...');
      };

      utterance.onend = () => {
        console.log('✅ 音声再生完了');
      };

      // iOS対策: resume()を呼ぶ
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
      }

      try {
        speechSynthesis.speak(utterance);
        console.log('🎤 speechSynthesis.speak() 実行完了');
      } catch (error) {
        console.error('❌ speechSynthesis.speak() エラー:', error);
        setToast({
          message: '音声再生に失敗しました',
          type: 'error',
        });
      }
    };

    speak();
  };

  // スクロール位置の保持（モバイル切替時）
  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  }, []);

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
      const response = await sendMessage(text, messages, selectedScenarioId);
      const botMessage: Message = {
        id: `bot-${Date.now()}`,
        role: 'bot',
        text: response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
      setMediaSubtitle(response);

      // AIの返答から適切な表情画像を選択（avatar_03固定で表情のみ変化）
      const expressionImageUrl = getExpressionForResponse(response, currentAvatarId);
      setImageSrc(expressionImageUrl);
      setVideoSrc(undefined); // 静止画を使用するため動画はクリア
      console.log('🎭 アバター表情画像:', expressionImageUrl);

      // 音声出力（Web Speech API - 即座に再生）
      speakTextWithWebSpeech(response);

    } catch (error) {
      console.error('送信エラー:', error);
      setToast({
        message: 'メッセージの送信に失敗しました。もう一度お試しください。',
        type: 'error',
      });
    } finally {
      setIsSending(false);
    }
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

      {/* モバイル: 切替トグル（ヘッダー下固定） */}
      <div className="md:hidden sticky top-[64px] z-[40] flex justify-center bg-gradient-to-b from-[#0D0E20]/95 to-transparent py-2">
        <button
          onClick={() => {
            const newShowMedia = !showMedia;
            setShowMedia(newShowMedia);
            // 切り替え時に表示されるパネル位置へスクロール
            setTimeout(() => {
              const targetId = newShowMedia ? 'media-anchor' : 'chat-anchor';
              const el = document.getElementById(targetId);
              if (el) {
                const headerHeight = 64;
                const toggleHeight = 40;
                const offset = headerHeight + toggleHeight + 8;
                const elementPosition = el.getBoundingClientRect().top + window.pageYOffset;
                window.scrollTo({
                  top: elementPosition - offset,
                  behavior: 'smooth',
                });
              }
            }, 100);
          }}
          className="text-sm text-slate-300 hover:text-white underline decoration-dotted transition"
          aria-label={showMedia ? 'チャットを表示' : 'メディアを表示'}
        >
          {showMedia ? '💬 チャットを表示' : '🎥 メディアを表示'}
        </button>
      </div>

      {/* メインコンテンツ */}
      <main className="flex-1 grid gap-8 lg:grid-cols-[minmax(520px,1fr)_minmax(420px,0.9fr)] md:grid-cols-1 items-stretch min-h-[calc(100dvh-var(--header-h))] pb-[calc(var(--footer-h)+env(safe-area-inset-bottom,0px))] px-6 lg:px-10 xl:px-14 max-w-[1200px] mx-auto w-full relative transition-all">
        {/* チャットパネル */}
        <section
          id="chat-anchor"
          className={`card flex flex-col justify-center items-center w-full h-full min-h-[480px] md:min-h-[calc(100dvh-180px)] overflow-hidden relative animate-floatIn ${
            showMedia
              ? 'md:block hidden'
              : 'block'
          }`}
        >
          <ChatPanel messages={messages} />
        </section>

        {/* メディアパネル */}
        <section
          id="media-anchor"
          className={`card flex flex-col justify-center items-center w-full aspect-[16/9] max-h-[calc(100dvh-var(--header-h)-var(--footer-safe)-16px)] md:min-h-[calc(100dvh-180px)] md:max-h-none md:aspect-auto overflow-hidden relative animate-floatIn ${
            showMedia
              ? 'block'
              : 'md:block hidden'
          }`}
        >
          <MediaPanel
            isRecording={isRecording}
            recordingState={recordingState}
            subtitle={mediaSubtitle}
            videoSrc={videoSrc}
            imageSrc={imageSrc}
          />
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

