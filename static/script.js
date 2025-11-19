class SalesRoleplayApp {
    constructor() {
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isProcessingAudio = false;
        this.conversationHistory = [];
        // STEP3: 映像UI
        this.storyboard = null;
        this.currentFlow = 'greeting';
        this.initializeElements();
        this.setupEventListeners();
        this.updateStatus('準備完了');
        // ストーリーボードの読み込み（非同期）
        this.loadStoryboard();
    }

    // ブラウザ対応MIMEを優先順で選択
    pickSupportedMime() {
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/ogg;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/wav'
        ];
        for (const m of candidates) {
            if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
        }
        return '';
    }

    initializeElements() {
        this.recordButton = document.getElementById('recordButton');
        this.recordingIndicator = document.getElementById('recordingIndicator');
        this.textInput = document.getElementById('textInput');
        this.sendButton = document.getElementById('sendButton');
        this.conversationLog = document.getElementById('conversationLog');
        this.statusBar = document.getElementById('statusBar');
        this.clearButton = document.getElementById('clearButton');
        this.evaluateButton = document.getElementById('evaluateButton');
        this.reloadScenariosButton = document.getElementById('reload-scenarios');
        this.evaluationModal = document.getElementById('evaluationModal');
        this.closeModal = document.getElementById('closeModal');
        this.evaluationContent = document.getElementById('evaluationContent');
        // TTS制御（ロールバック: 追加UIなし）
        this.voiceStyleSelect = null;
        this.voiceSelect = null;
        // プレイヤー要素
        this.playerImage = document.getElementById('playerImage');
        this.playerVideo = document.getElementById('playerVideo');
        this.subtitleEl = document.getElementById('subtitle');
    }

    setupEventListeners() {
        this.recordButton.addEventListener('click', () => this.toggleRecording());
        this.sendButton.addEventListener('click', () => this.sendTextMessage());
        this.textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendTextMessage();
            }
        });
        this.clearButton.addEventListener('click', () => this.clearConversation());
        this.evaluateButton.addEventListener('click', () => this.evaluateConversation());
        this.reloadScenariosButton.addEventListener('click', () => this.reloadScenarios());
        this.closeModal.addEventListener('click', () => this.closeEvaluationModal());
        
        // モーダル外クリックで閉じる
        this.evaluationModal.addEventListener('click', (e) => {
            if (e.target === this.evaluationModal) {
                this.closeEvaluationModal();
            }
        });

        // ロールバック: 追加のTTS UI処理なし
    }
    // populateVoices は不要

    async loadStoryboard() {
        try {
            const res = await fetch('/static/storyboard/default.story.json', { cache: 'no-cache' });
            if (!res.ok) throw new Error('storyboard not found');
            this.storyboard = await res.json();
            // 初期表示
            this.updatePlayer('greeting', 'よろしくお願いします');
        } catch (e) {
            console.warn('ストーリーボード読み込み失敗:', e);
            this.storyboard = null;
            this.updatePlayer(null, '');
        }
    }

    computeFlowForMessage(text) {
        if (!text) return this.currentFlow || 'greeting';
        const t = String(text);
        if (/(こんにちは|はじめまして|お世話|本日は)/.test(t)) return 'greeting';
        if (/(困って|課題|問題|悩み|どのような|現状|お困り)/.test(t)) return 'needs_analysis';
        if (/(提案|おすすめ|解決|サービス|プラン|方法|ソリューション|導入)/.test(t)) return 'proposal';
        if (/(でも|しかし|心配|不安|懸念|高い|難しい)/.test(t)) return 'objection_handling';
        if (/(いかがでしょうか|ご検討|次回|後日|ご連絡|お返事|お聞かせ)/.test(t)) return 'closing';
        return this.currentFlow || 'greeting';
    }

    updatePlayer(sceneKey, subtitleText) {
        const hasElements = this.playerImage && this.playerVideo && this.subtitleEl;
        if (!hasElements) return;

        // 既存を一旦非表示
        this.playerImage.style.display = 'none';
        this.playerVideo.style.display = 'none';
        try { this.playerVideo.pause(); } catch (_) {}

        let conf = null;
        if (this.storyboard) {
            conf = (sceneKey && this.storyboard[sceneKey]) || this.storyboard.default || null;
        }

        if (!conf) {
            // フォールバック: 何もなければ字幕のみ
            this.subtitleEl.textContent = subtitleText || '';
            this.subtitleEl.style.display = subtitleText ? 'block' : 'none';
            return;
        }

        const type = conf.type || 'image';
        const src = conf.src || '';
        const sub = conf.subtitle === '$AUTO' ? (subtitleText || '') : (conf.subtitle || '');

        if (type === 'video' && src) {
            this.playerVideo.src = src;
            this.playerVideo.style.display = 'block';
            this.playerImage.style.display = 'none';
            // 自動再生（ミュート）
            try { this.playerVideo.play(); } catch (_) {}
        } else if (src) { // image
            this.playerImage.src = src;
            this.playerImage.style.display = 'block';
            this.playerVideo.style.display = 'none';
            // ロード失敗時は非表示
            this.playerImage.onerror = () => { this.playerImage.style.display = 'none'; };
        }

        this.subtitleEl.textContent = sub;
        this.subtitleEl.style.display = sub ? 'block' : 'none';
    }

    async toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // 可能な限り安定したmimeTypeを選択（webm;opus → ogg;opus 優先）
            let options = {};
            const picked = this.pickSupportedMime();
            if (picked) options.mimeType = picked;
            this.mediaRecorder = new MediaRecorder(stream, options);
            this.recordingMimeType = this.mediaRecorder.mimeType || options.mimeType || 'audio/webm';
            this.audioChunks = [];

            // データチャンクを蓄積（処理はonstopで一回だけ）
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            // 停止時に最終データを明示要求し、その後に1回だけ送信
            this.mediaRecorder.onstop = () => {
                try { this.mediaRecorder.requestData(); } catch (_) {}
                if (!this.isProcessingAudio) {
                    this.isProcessingAudio = true;
                    setTimeout(() => {
                        this.processAudio().finally(() => {
                            this.isProcessingAudio = false;
                            stream.getTracks().forEach(track => track.stop());
                        });
                    }, 0);
                }
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.updateRecordingUI(true);
            this.updateStatus('録音中...');

        } catch (error) {
            console.error('音声録音エラー:', error);
            this.updateStatus('音声録音に失敗しました');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.updateRecordingUI(false);
            this.updateStatus('音声を処理中...');
        }
    }

    updateRecordingUI(recording) {
        if (recording) {
            this.recordButton.classList.add('recording');
            this.recordButton.innerHTML = '<span class="mic-icon">⏹️</span><span class="button-text">録音停止</span>';
            this.recordingIndicator.style.display = 'flex';
        } else {
            this.recordButton.classList.remove('recording');
            this.recordButton.innerHTML = '<span class="mic-icon">🎤</span><span class="button-text">音声録音</span>';
            this.recordingIndicator.style.display = 'none';
        }
    }

    async processAudio() {
        try {
            const mimeType = this.recordingMimeType || 'audio/webm';
            const audioBlob = new Blob(this.audioChunks, { type: mimeType });
            if (!audioBlob || audioBlob.size === 0) {
                this.updateStatus('録音データが空でした');
                return;
            }
            
            this.updateStatus('音声を認識中...');
            
            // FormDataを使用してファイルを送信
            const formData = new FormData();
            // 拡張子をblobの実体タイプから決定（iOS/Safariはmp4）
            const realType = audioBlob.type || mimeType;
            let ext = realType.includes('webm') ? 'webm'
                    : realType.includes('mp4')  ? 'mp4'
                    : realType.includes('ogg')  ? 'ogg'
                    : realType.includes('wav')  ? 'wav'
                    : 'bin';
            formData.append('audio', audioBlob, `recording.${ext}`);
            
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
                // Content-Typeヘッダーは付けない（FormDataが自動設定）
            });

            const result = await response.json();
            
            if (result.success) {
                this.addMessage('user', result.text);
                await this.sendToAI(result.text);
                this.updateStatus(`音声認識完了 (${result.method})`);
            } else {
                this.updateStatus('音声認識に失敗しました: ' + result.error);
                // フォールバック: テキスト入力を促す
                const userInput = prompt('音声認識に失敗しました。\n録音した内容をテキストで入力してください:');
                if (userInput && userInput.trim()) {
                    this.addMessage('user', userInput.trim());
                    await this.sendToAI(userInput.trim());
                }
            }

        } catch (error) {
            console.error('音声処理エラー:', error);
            this.updateStatus('音声処理に失敗しました');
            // フォールバック: テキスト入力を促す
            const userInput = prompt('音声処理に失敗しました。\n録音した内容をテキストで入力してください:');
            if (userInput && userInput.trim()) {
                this.addMessage('user', userInput.trim());
                await this.sendToAI(userInput.trim());
            }
        }
    }

    async sendTextMessage() {
        const message = this.textInput.value.trim();
        if (!message) return;

        this.textInput.value = '';
        this.addMessage('user', message);
        await this.sendToAI(message);
    }

    async sendToAI(message) {
        try {
            this.updateStatus('AIが考え中...');
            
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    history: this.conversationHistory
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.addMessage('ai', result.response);
                this.speakText(result.response);
                // STEP3: 映像更新
                const flow = this.computeFlowForMessage(result.response);
                this.currentFlow = flow;
                this.updatePlayer(flow, result.response);
            } else {
                this.updateStatus('AI応答エラー: ' + result.error);
            }

        } catch (error) {
            console.error('AI通信エラー:', error);
            this.updateStatus('AIとの通信に失敗しました');
        }
    }

    addMessage(speaker, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${speaker}-message`;
        
        const avatar = speaker === 'user' ? '👤' : '🤖';
        const speakerName = speaker === 'user' ? '営業' : 'お客様';
        
        messageDiv.innerHTML = `
            <div class="avatar">${avatar}</div>
            <div class="message-content">
                <p>${text}</p>
            </div>
        `;

        this.conversationLog.appendChild(messageDiv);
        this.conversationLog.scrollTop = this.conversationLog.scrollHeight;

        // 会話履歴に追加
        this.conversationHistory.push({
            speaker: speakerName,
            text: text,
            timestamp: new Date().toISOString()
        });

        this.updateStatus('準備完了');
    }

    speakText(text) {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            // ロールバック: 言語/声質固定
            utterance.lang = 'ja-JP';
            utterance.rate = 0.95;
            utterance.pitch = 1.0;

            speechSynthesis.speak(utterance);
        }
    }

    // 会話保存機能はMVP対象外のため削除

    clearConversation() {
        if (confirm('会話をクリアしますか？')) {
            this.conversationHistory = [];
            this.conversationLog.innerHTML = `
                <div class="message ai-message">
                    <div class="avatar">🤖</div>
                    <div class="message-content">
                        <p>こんにちは！お忙しい中お時間をいただき、ありがとうございます。どのようなご相談でしょうか？</p>
                    </div>
                </div>
            `;
            this.updateStatus('会話をクリアしました');
            // プレイヤー初期化
            this.currentFlow = 'greeting';
            this.updatePlayer('greeting', 'よろしくお願いします');
        }
    }

    updateStatus(message) {
        this.statusBar.textContent = message;
    }

    async evaluateConversation() {
        if (this.conversationHistory.length === 0) {
            alert('評価する会話がありません。まず会話を開始してください。');
            return;
        }

        try {
            this.updateStatus('講評を生成中...');
            
            const response = await fetch('/api/evaluate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    conversation: this.conversationHistory
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.displayEvaluation(result.evaluation);
                this.updateStatus('講評を生成しました');
            } else {
                this.updateStatus('講評生成エラー: ' + result.error);
            }

        } catch (error) {
            console.error('講評生成エラー:', error);
            this.updateStatus('講評生成に失敗しました');
        }
    }

    displayEvaluation(evaluation) {
        const content = `
            <div class="score-section">
                <h3>📊 スコア評価</h3>
                <div class="score-grid">
                    <div class="score-item">
                        <div class="score-label">質問力</div>
                        <div class="score-value">${evaluation.scores.questioning}</div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">傾聴力</div>
                        <div class="score-value">${evaluation.scores.listening}</div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">提案力</div>
                        <div class="score-value">${evaluation.scores.proposing}</div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">クロージング力</div>
                        <div class="score-value">${evaluation.scores.closing}</div>
                    </div>
                    <div class="score-item total-score">
                        <div class="score-label">総合スコア</div>
                        <div class="score-value">${evaluation.scores.total}</div>
                    </div>
                </div>
            </div>

            <div class="comments-section">
                <h3>💬 フィードバック</h3>
                ${evaluation.comments.map(comment => `
                    <div class="comment-item">${comment}</div>
                `).join('')}
            </div>

            <div class="overall-comment">
                ${evaluation.overall_comment}
            </div>

            ${evaluation.improvement_suggestions ? `
                <div class="improvement-section">
                    <h3>🚀 改善提案</h3>
                    ${evaluation.improvement_suggestions.map(suggestion => `
                        <div class="suggestion-item">${suggestion}</div>
                    `).join('')}
                </div>
            ` : ''}

            <div class="analysis-section">
                <h3>📈 詳細分析</h3>
                <div class="analysis-grid">
                    <div class="analysis-item">
                        <div class="analysis-label">総発言数</div>
                        <div class="analysis-value">${evaluation.total_utterances}</div>
                    </div>
                    <div class="analysis-item">
                        <div class="analysis-label">質問数</div>
                        <div class="analysis-value">${evaluation.analysis.questions_count}</div>
                    </div>
                    <div class="analysis-item">
                        <div class="analysis-label">オープン質問数</div>
                        <div class="analysis-value">${evaluation.analysis.open_questions_count || 0}</div>
                    </div>
                    <div class="analysis-item">
                        <div class="analysis-label">共感表現数</div>
                        <div class="analysis-value">${evaluation.analysis.listening_responses_count}</div>
                    </div>
                    <div class="analysis-item">
                        <div class="analysis-label">提案数</div>
                        <div class="analysis-value">${evaluation.analysis.proposals_count}</div>
                    </div>
                    <div class="analysis-item">
                        <div class="analysis-label">クロージング数</div>
                        <div class="analysis-value">${evaluation.analysis.closings_count}</div>
                    </div>
                    <div class="analysis-item">
                        <div class="analysis-label">ポジティブ表現</div>
                        <div class="analysis-value">${evaluation.analysis.positive_expressions || 0}</div>
                    </div>
                    <div class="analysis-item">
                        <div class="analysis-label">ネガティブ表現</div>
                        <div class="analysis-value">${evaluation.analysis.negative_expressions || 0}</div>
                    </div>
                    <div class="analysis-item">
                        <div class="analysis-label">会話段階</div>
                        <div class="analysis-value">${getFlowLabel(evaluation.analysis.conversation_flow)}</div>
                    </div>
                </div>
            </div>
        `;

        this.evaluationContent.innerHTML = content;
        this.evaluationModal.style.display = 'flex';
    }

    closeEvaluationModal() {
        this.evaluationModal.style.display = 'none';
    }

    async reloadScenarios() {
        try {
            this.updateStatus('シナリオ再読み込み中...');
            this.reloadScenariosButton.disabled = true;
            
            const response = await fetch('/ingest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                const scenariosCount = data.scenarios_created || 0;
                const ragCount = data.rag_items || 0;
                alert(`シナリオ再読み込み完了！\n作成シナリオ数: ${scenariosCount}\nRAGアイテム数: ${ragCount}`);
                this.updateStatus('再読み込み完了、ページを更新します...');
                setTimeout(() => {
                    location.reload();
                }, 1000);
            } else {
                throw new Error(data.error || 'シナリオ再読み込みに失敗しました');
            }
        } catch (error) {
            console.error('シナリオ再読み込みエラー:', error);
            alert(`エラー: ${error.message}`);
            this.updateStatus('再読み込みエラー');
        } finally {
            this.reloadScenariosButton.disabled = false;
        }
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
}

function getFlowLabel(flow) {
    const flowLabels = {
        'greeting': '挨拶',
        'needs_analysis': 'ニーズ分析',
        'proposal': '提案',
        'objection_handling': '反対意見対応',
        'closing': 'クロージング',
        '短い会話': '短い会話'
    };
    return flowLabels[flow] || flow;
}

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
    new SalesRoleplayApp();
});
