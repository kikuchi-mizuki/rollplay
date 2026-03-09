"""
メディア処理ブループリント
音声認識・TTS・動画生成に関するエンドポイントを提供
"""
import logging
import os
import tempfile
from datetime import datetime
from flask import Blueprint, request, jsonify, Response
from openai import RateLimitError

# ロガー取得
logger = logging.getLogger(__name__)

# Blueprintオブジェクト作成
media_bp = Blueprint('media', __name__, url_prefix='/api')

# グローバル変数（init_blueprintで設定）
openai_client = None
supabase_client = None
PYDUB_AVAILABLE = False
FFMPEG_AVAILABLE = False
AudioSegment = None
sniff_suffix = None
generate_cache_key = None
get_cached_video = None
get_did_client = None
download_video_to_storage = None
save_video_to_cache = None
limiter = None  # レート制限機能
require_auth = None  # 認証デコレータ
require_budget = None  # コスト制限機能


def init_blueprint(app):
    """
    ブループリント初期化
    app.pyから必要な設定やヘルパー関数を受け取る
    """
    global openai_client, supabase_client, PYDUB_AVAILABLE, FFMPEG_AVAILABLE
    global AudioSegment, sniff_suffix
    global generate_cache_key, get_cached_video, get_did_client
    global download_video_to_storage, save_video_to_cache
    global limiter, require_auth, require_budget

    openai_client = app.config.get('openai_client')
    supabase_client = app.config.get('supabase_client')
    PYDUB_AVAILABLE = app.config.get('PYDUB_AVAILABLE', False)
    FFMPEG_AVAILABLE = app.config.get('FFMPEG_AVAILABLE', False)
    AudioSegment = app.config.get('AudioSegment')
    sniff_suffix = app.config.get('sniff_suffix')
    generate_cache_key = app.config.get('generate_cache_key')
    get_cached_video = app.config.get('get_cached_video')
    get_did_client = app.config.get('get_did_client')
    download_video_to_storage = app.config.get('download_video_to_storage')
    save_video_to_cache = app.config.get('save_video_to_cache')
    limiter = app.config.get('limiter')
    require_auth = app.config.get('require_auth')
    require_budget = app.config.get('require_budget')


def apply_rate_limit(limit_string):
    """
    レート制限デコレータを条件付きで適用するヘルパー
    limiterが利用可能な場合のみレート制限を適用
    app.pyで常にlimiterが設定されるため、通常はレート制限が適用されます
    """
    def decorator(func):
        if limiter:
            return limiter.limit(limit_string)(func)
        # limiterがNoneの場合（通常は発生しない）
        logger.warning(f"⚠️ レート制限が無効です: {func.__name__}")
        return func
    return decorator


def apply_auth(func):
    """
    認証デコレータを条件付きで適用するヘルパー
    require_authが利用可能な場合のみ認証を適用
    """
    if require_auth:
        return require_auth(func)
    return func


def normalize_text_for_japanese_tts(text):
    """
    日本語TTS用にテキストを正規化
    英語略語をカタカナに変換して、TTSが英語発音するのを防ぐ

    Args:
        text: 正規化前のテキスト

    Returns:
        正規化後のテキスト
    """
    import re

    # 英語略語 → カタカナ読み変換マップ
    # ビジネス用語はそのままだが、TTSが日本語として発音するようにカタカナ表記に変換
    replacements = {
        'SNS': 'エスエヌエス',
        'CVR': 'シーブイアール',
        'CPA': 'シーピーエー',
        'ROI': 'アールオーアイ',
        'KPI': 'ケーピーアイ',
        'CEO': 'シーイーオー',
        'CTO': 'シーティーオー',
        'SEO': 'エスイーオー',
        'UI': 'ユーアイ',
        'UX': 'ユーエックス',
        'API': 'エーピーアイ',
        'DX': 'ディーエックス',
        'IT': 'アイティー',
        'PR': 'ピーアール',
        'BtoB': 'ビートゥービー',
        'BtoC': 'ビートゥーシー',
        'AI': 'エーアイ',
        'ML': 'エムエル',
        'SaaS': 'サース',
        'PaaS': 'パース',
        'IaaS': 'イアース',
        'LP': 'エルピー',
        'CRM': 'シーアールエム',
        'EC': 'イーシー',
    }

    # 単語境界を考慮して置換（大文字小文字を区別）
    result = text
    for eng, jpn in replacements.items():
        # 単語境界で置換（前後にアルファベット・数字がない場合のみ）
        pattern = r'\b' + re.escape(eng) + r'\b'
        result = re.sub(pattern, jpn, result)

    # 読み間違えやすい日本語単語の読み仮名置換
    # OpenAI TTSが誤読する単語「のみ」をひらがなに置き換える
    # 注: 過度にひらがな化すると英語と誤認識されるため、最小限に留める
    japanese_replacements = {
        # 確実に誤読する単語のみ
        '今日': 'きょう',
        '明日': 'あした',
        '昨日': 'きのう',
    }

    for kanji, hiragana in japanese_replacements.items():
        result = result.replace(kanji, hiragana)

    # 注: 読点後のスペース追加はOpenAI TTSで英語として解釈される問題があるため削除
    # result = re.sub(r'、(?!\s)', '、 ', result)

    return result


def select_voice_for_persona(persona_type='default', scenario_id='', override_voice=None):
    """
    ペルソナ・シナリオに応じた音声と話速を選択

    Google Cloud TTS 日本語Neural2音声の特徴:
    - ja-JP-Neural2-B: 標準的な女性声（30代、バランスが良い）
    - ja-JP-Neural2-C: 若々しく明るい女性声（20-30代、スタートアップ向き）
    - ja-JP-Neural2-D: 男性声（低め、落ち着いた）※女性声ではない

    Args:
        persona_type: ペルソナタイプ（'young', 'mid', 'senior', 'creative', 'tech', 'traditional'等）
        scenario_id: シナリオID（'meeting_1st', 'meeting_2nd'等）
        override_voice: フロントエンドから明示的に指定された音声（優先）

    Returns:
        (voice_id, speed): 音声IDと話速のタプル
    """
    # フロントエンドからの明示的な指定がある場合は優先
    if override_voice:
        valid_voices = ['ja-JP-Neural2-B', 'ja-JP-Neural2-C']
        if override_voice in valid_voices:
            # デフォルトの話速を返す
            return (override_voice, 1.2)

    # シナリオに応じたデフォルト設定（Google Cloud TTS）
    scenario_voice_map = {
        'meeting_1st': {
            'voice': 'ja-JP-Neural2-B',  # 初回は落ち着いた標準的な女性声
            'speed': 1.2,
            'description': '初回面談 - 慎重で落ち着いた女性声'
        },
        'meeting_1_5th': {
            'voice': 'ja-JP-Neural2-B',  # 少し打ち解けた標準的な声
            'speed': 1.2,
            'description': '1.5次面談 - やや打ち解けた女性声'
        },
        'meeting_2nd': {
            'voice': 'ja-JP-Neural2-C',  # 関係構築が進み、明るい印象（若々しい）
            'speed': 1.2,
            'description': '2次面談 - 明るく前向きな女性声'
        },
        'meeting_3rd': {
            'voice': 'ja-JP-Neural2-C',  # 親しみのある明るい声
            'speed': 1.2,
            'description': '3次面談 - 親しみのある女性声'
        },
        'kickoff_meeting': {
            'voice': 'ja-JP-Neural2-C',  # ビジネスパートナーとして明るく
            'speed': 1.2,
            'description': 'キックオフMTG - テキパキとした女性声'
        },
        'upsell': {
            'voice': 'ja-JP-Neural2-C',  # 既存顧客への追加提案は明るく
            'speed': 1.2,
            'description': '追加営業 - フランクな女性声'
        }
    }

    # ペルソナタイプに応じた設定（シナリオ設定を上書き）
    # Google Cloud TTS日本語女性声のみを使用（B, Cの2種類）
    persona_voice_map = {
        'young_entrepreneur': ('ja-JP-Neural2-C', 1.2),  # 若手起業家：明るく快活
        'mid_manager': ('ja-JP-Neural2-B', 1.2),  # 中堅管理職：標準的で丁寧
        'senior_executive': ('ja-JP-Neural2-B', 1.1),  # ベテラン経営者：落ち着いた女性声（話速遅め）
        'creative_director': ('ja-JP-Neural2-C', 1.2),  # クリエイティブ系：明るく表現豊か
        'tech_founder': ('ja-JP-Neural2-C', 1.2),  # テック系創業者：明るくスマート
        'traditional_owner': ('ja-JP-Neural2-B', 1.1),  # 伝統的な事業主：落ち着いて丁寧
        'cautious': ('ja-JP-Neural2-B', 1.1),  # 慎重なタイプ：落ち着いた女性声
        'confident': ('ja-JP-Neural2-C', 1.2),  # 自信家タイプ：明るくテキパキ
        'analytical': ('ja-JP-Neural2-B', 1.2),  # 分析的タイプ：標準的で論理的
    }

    # ペルソナタイプから選択（最優先）
    if persona_type and persona_type in persona_voice_map:
        voice, speed = persona_voice_map[persona_type]
        logger.debug(f"  ペルソナ選択: {persona_type} → voice={voice}, speed={speed}")
        return (voice, speed)

    # デフォルト：標準的な女性声（中堅管理職相当）
    logger.debug(f"  デフォルト選択: ja-JP-Neural2-B, 1.2")
    return ('ja-JP-Neural2-B', 1.2)


@media_bp.route('/tts', methods=['POST'])
@apply_auth
def text_to_speech():
    """
    OpenAI TTSを使用した音声合成
    ペルソナに合わせて声と話し方を変化させる
    """
    try:
        data = request.get_json()
        text = data.get('text', '')
        voice = data.get('voice', None)  # フロントエンドから指定された音声
        persona_type = data.get('persona_type', 'default')  # ペルソナタイプ
        scenario_id = data.get('scenario_id', '')  # シナリオID

        if not text:
            return jsonify(success=False, error='テキストが空です'), 400

        if not openai_client:
            return jsonify(success=False, error='OpenAIクライアント未初期化'), 500

        # ペルソナ・シナリオに応じた音声を自動選択
        selected_voice, selected_speed = select_voice_for_persona(
            persona_type=persona_type,
            scenario_id=scenario_id,
            override_voice=voice
        )

        # テキストを正規化（英語略語をカタカナに変換）
        normalized_text = normalize_text_for_japanese_tts(text)

        logger.info(f"🎤 TTS生成: voice={selected_voice}, speed={selected_speed}, persona={persona_type}, scenario={scenario_id}")
        if normalized_text != text:
            logger.debug(f"📝 テキスト正規化: 「{text}」 → 「{normalized_text}」")

        # OpenAI TTSで音声生成（高品質モデル + 自然な会話スピード）
        response = openai_client.audio.speech.create(
            model="tts-1-hd",  # 高品質モデル（より自然で流暢な発音）
            voice=selected_voice,
            input=normalized_text,  # 正規化後のテキストを使用
            speed=selected_speed  # ペルソナに応じた話速
        )

        # 音声データを返す
        audio_data = response.content
        return Response(audio_data, mimetype='audio/mpeg')

    except ValueError as e:
        # 入力値エラー（不正な音声ID、空のテキストなど）
        logger.error(f"TTS生成 - 入力値が不正: {e}")
        return jsonify(success=False, error='音声生成のパラメータが不正です'), 400
    except TimeoutError as e:
        # OpenAI TTS APIタイムアウト
        logger.error(f"TTS生成 - タイムアウト: {e}")
        return jsonify(success=False, error='音声生成がタイムアウトしました。もう一度お試しください'), 500
    except Exception as e:
        # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
        logger.error(f"TTS生成 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify(success=False, error='音声生成中にエラーが発生しました。もう一度お試しください'), 500


@media_bp.route('/transcribe', methods=['POST'])
@apply_auth
@apply_rate_limit("5 per minute")  # Whisper API使用のためレート制限
def transcribe():
    # コスト制限チェック
    if require_budget:
        from utils.cost_limiter import cost_limiter
        can_use, error_msg = cost_limiter.can_use_service('whisper')
        if not can_use:
            logger.warning(f"🚫 予算制限によりサービス拒否: whisper")
            return jsonify({
                'success': False,
                'error': error_msg,
                'budget_exceeded': True
            }), 429

    temp_path = None
    new_path = None
    try:
        if 'audio' not in request.files:
            return jsonify(success=False, error='音声ファイルが見つかりません'), 400

        up = request.files['audio']

        # ファイル名のチェック
        if not up.filename:
            return jsonify(success=False, error='ファイル名が無効です'), 400

        # 許可されたMIMEタイプ（音声ファイル）
        ALLOWED_MIMETYPES = {
            'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav',
            'audio/ogg', 'audio/flac', 'audio/x-m4a', 'audio/mp3',
            'application/octet-stream'  # ブラウザがMIMEタイプを判定できない場合
        }

        # MIMEタイプの検証（Content-Typeヘッダー）
        if up.mimetype and up.mimetype not in ALLOWED_MIMETYPES:
            logger.warning(f"不正なMIMEタイプ: {up.mimetype}")
            return jsonify(success=False, error=f'サポートされていないファイル形式です: {up.mimetype}'), 400

        # ファイルサイズの制限（25MB - Whisper APIの制限）
        MAX_FILE_SIZE = 25 * 1024 * 1024  # 25MB
        up.seek(0, 2)  # ファイルの終端に移動
        file_size = up.tell()
        up.seek(0)  # ファイルの先頭に戻す

        if file_size > MAX_FILE_SIZE:
            logger.warning(f"ファイルサイズ超過: {file_size} bytes")
            return jsonify(success=False, error=f'ファイルサイズが大きすぎます（最大25MB）'), 413

        # 一旦 .bin で保存
        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as t:
            up.save(t.name)
            temp_path = t.name

        # 先頭バイトから実体を判定してrename
        real_suffix = sniff_suffix(temp_path)

        # 許可された拡張子のチェック
        ALLOWED_EXTENSIONS = {'.webm', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.ogg', '.flac'}
        if real_suffix not in ALLOWED_EXTENSIONS:
            logger.warning(f"不正なファイル形式: {real_suffix}")
            try:
                os.remove(temp_path)
            except Exception:
                pass
            return jsonify(success=False, error=f'サポートされていないファイル形式です'), 400

        new_path = temp_path
        if real_suffix != '.bin':
            new_path = temp_path + real_suffix
            os.replace(temp_path, new_path)

        size = os.path.getsize(new_path)
        logger.debug(f"[upload] mime={up.mimetype} saved={new_path} size={size}")

        if size < 1024:  # 1KB未満は明らかに短すぎる
            try:
                os.remove(new_path)
            except Exception:
                pass
            logger.error(f"録音データが小さすぎます: {size} bytes")
            return jsonify(success=False, error=f'録音データが小さすぎます({size} bytes)。もう少し長く話してください。'), 400
        # Whisperへ（まず直送）
        if not openai_client:
            return jsonify(success=False, error='OpenAIクライアント未初期化'), 500

        # 会話履歴を取得（フロントエンドから送信される）
        history_json = request.form.get('history', '[]')
        try:
            history = json.loads(history_json) if history_json else []
        except json.JSONDecodeError:
            logger.warning(f"[Whisper] 会話履歴のJSON解析失敗: {history_json[:100]}")
            history = []

        # Whisperで音声認識（ビジネス用語認識精度向上・速度最適化）
        # promptにビジネス用語 + 会話の文脈を追加
        business_prompt = (
            "御社、貴社、費用、予算、実績、課題、提案、検討、ROI、動画制作、ショート動画、SNS、Instagram、YouTube、TikTok、"
            "外注、制作会社、キックオフミーティング、ヒアリング、見積もり、納期、事例、CVR、ターゲット層、訴求力、効果測定"
        )

        # 会話の文脈を追加（直近3往復まで、最大200文字）
        if history and len(history) > 0:
            recent_messages = history[-6:]  # 直近3往復（6メッセージ）
            context_parts = []
            for msg in recent_messages:
                speaker = msg.get('speaker', '不明')
                text = msg.get('text', '')
                if text:
                    context_parts.append(f"{speaker}「{text}」")

            if context_parts:
                context_text = "、".join(context_parts)
                # 文脈が長すぎる場合は切り詰め（Whisperのpromptは224トークンまで、約200文字）
                if len(context_text) > 200:
                    context_text = context_text[-200:]
                business_prompt = f"{business_prompt}。会話の流れ: {context_text}"
                logger.debug(f"[Whisper設定] 会話文脈を追加: {context_text[:100]}...")

        logger.debug(f"[Whisper設定] prompt長: {len(business_prompt)}文字, temperature: 0")

        try:
            # ⏱️ パフォーマンス計測: Whisper API呼び出し
            import time
            whisper_start = time.time()

            with open(new_path, 'rb') as f:
                r = openai_client.audio.transcriptions.create(
                    model='whisper-1',
                    file=f,
                    language='ja',
                    temperature=0,
                    prompt=business_prompt
                )

            whisper_duration = (time.time() - whisper_start) * 1000
            text = (getattr(r, 'text', '') or '').strip()
            logger.info(f"⏱️ [Whisper計測] 処理時間: {whisper_duration:.0f}ms, ファイルサイズ: {size} bytes, 認識結果: {text}")
            logger.debug(f"[Whisper成功] 認識結果: {text}")

            # YouTube定型文など明らかな誤認識をフィルタリング
            noise_patterns = [
                'ご視聴ありがとうございました',
                'チャンネル登録',
                'グッドボタン',
                '高評価',
                'コメント',
                'ご清聴ありがとうございました'
            ]
            if any(pattern in text for pattern in noise_patterns):
                logger.warning(f"[誤認識フィルタ] YouTube定型文を検出: {text}")
                return jsonify(success=False, error='音声が認識できませんでした。もう一度お試しください。'), 400

            # 使用量を記録
            if require_budget:
                from utils.cost_limiter import cost_limiter
                cost_limiter.record_usage('whisper')

            return jsonify(success=True, text=text, method='whisper', timestamp=datetime.now().isoformat())
        except Exception as e:
            logger.debug(f"[Whisper失敗] エラー: {e}, ファイルサイズ: {size} bytes")
            if not (PYDUB_AVAILABLE and FFMPEG_AVAILABLE):
                raise
            wav_path = new_path + '.wav'
            AudioSegment.from_file(new_path).set_frame_rate(16000).set_channels(1).export(wav_path, format='wav')
            try:
                # WAV変換後も同じビジネス・動画制作用語プロンプトを使用
                with open(wav_path, 'rb') as f:
                    r = openai_client.audio.transcriptions.create(
                        model='whisper-1',
                        file=f,
                        language='ja',
                        temperature=0,
                        prompt=business_prompt
                    )
                text = (getattr(r, 'text', '') or '').strip()

                # YouTube定型文など明らかな誤認識をフィルタリング
                noise_patterns = [
                    'ご視聴ありがとうございました',
                    'チャンネル登録',
                    'グッドボタン',
                    '高評価',
                    'コメント',
                    'ご清聴ありがとうございました'
                ]
                if any(pattern in text for pattern in noise_patterns):
                    logger.warning(f"[誤認識フィルタ] YouTube定型文を検出: {text}")
                    return jsonify(success=False, error='音声が認識できませんでした。もう一度お試しください。'), 400

                # 使用量を記録
                if require_budget:
                    from utils.cost_limiter import cost_limiter
                    cost_limiter.record_usage('whisper')

                return jsonify(success=True, text=text, method='whisper', timestamp=datetime.now().isoformat())
            finally:
                try: os.remove(wav_path)
                except Exception: pass
    except ValueError as e:
        logger.error(f"入力値が不正: {e}")
        return jsonify(success=False, error='音声ファイルの形式が不正です'), 400
    except OSError as e:
        logger.error(f"ファイルI/O: {e}")
        return jsonify(success=False, error='音声ファイルの処理中にエラーが発生しました'), 500
    except RateLimitError as e:
        # OpenAI APIクォータ超過
        logger.error(f"音声認識 - クォータ超過: {e}")
        # insufficient_quotaの場合は専用メッセージ
        error_str = str(e)
        if 'insufficient_quota' in error_str or 'exceeded your current quota' in error_str:
            return jsonify(success=False, error='月額利用料の上限に達しましたので、担当にご連絡ください'), 429
        else:
            return jsonify(success=False, error='APIの利用制限に達しました。しばらく待ってから再度お試しください'), 429
    except Exception as e:
        # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
        logger.error(f"予期しないエラー: {type(e).__name__}: {e}")
        return jsonify(success=False, error='音声認識中にエラーが発生しました。もう一度お試しください。'), 500
    finally:
        # 一時ファイルのクリーンアップ
        for path in [temp_path, new_path]:
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                    logger.debug(f"一時ファイルを削除: {path}")
                except Exception as e:
                    logger.warning(f"一時ファイル削除失敗: {e}")


def transcribe_with_whisper(audio_bytes):
    """Whisper APIを使用した音声認識"""
    try:
        logger.debug(f"音声データサイズ: {len(audio_bytes)} bytes")

        # 音声データを一時ファイルに保存
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
            temp_file.write(audio_bytes)
            temp_file_path = temp_file.name

        logger.debug(f"一時ファイル作成: {temp_file_path}")

        try:
            # pydubが利用可能かチェック
            if not PYDUB_AVAILABLE:
                raise Exception("pydubが利用できません。ffmpegのインストールを確認してください。")

            # 音声ファイルを読み込み、MP3に変換（Whisperの推奨形式）
            logger.debug("音声ファイル変換開始...")
            audio = AudioSegment.from_wav(temp_file_path)
            mp3_path = temp_file_path.replace('.wav', '.mp3')
            audio.export(mp3_path, format="mp3")
            logger.debug(f"MP3変換完了: {mp3_path}")

            # OpenAIクライアントの確認
            if not openai_client:
                raise Exception("OpenAIクライアントが初期化されていません")

            logger.debug("Whisper API呼び出し開始...")
            # Whisper APIで音声認識（新しいAPI形式）
            # プロンプトで文脈を提供（精度向上）
            # 文章形式の方が効果的：前のセグメントのスタイルを継続
            context_prompt = (
                "御社、貴社の事業内容について伺います。御社のSNS動画制作、ショート動画、"
                "TikTok、Instagram、YouTubeを活用したマーケティング、集客、"
                "ブランディングについて相談させていただきます。"
                "外注、制作会社、キックオフミーティング、ヒアリング、提案、見積もり、"
                "納期、実績、事例、CVR、ROI、ターゲット層、訴求力、効果測定。"
            )
            logger.debug(f"[Whisper設定] prompt: {context_prompt[:50]}..., temperature: 0")
            with open(mp3_path, 'rb') as audio_file:
                transcript = openai_client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    language="ja",  # 日本語指定
                    prompt=context_prompt,  # 文脈ヒント（誤認識を減らす）
                    temperature=0  # 最も確実な認識結果を返す
                )

            transcribed_text = transcript.text.strip()
            logger.info(f"音声認識結果: {transcribed_text}")

            return jsonify({
                'success': True,
                'text': transcribed_text,
                'method': 'whisper',
                'timestamp': datetime.now().isoformat()
            })

        finally:
            # 一時ファイルを削除
            for file_path in [temp_file_path, mp3_path]:
                if os.path.exists(file_path):
                    os.unlink(file_path)
                    logger.debug(f"一時ファイル削除: {file_path}")

    except Exception as e:
        logger.error(f"Whisper音声認識エラー詳細: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Whisper音声認識エラー: {str(e)}'
        }), 500


def transcribe_with_whisper_file(input_file_path):
    """ファイルパスからWhisper APIを使用（直送→失敗時にWAVへ変換して再送）"""
    mp3_path = None
    try:
        logger.debug(f"音声ファイル処理開始: {input_file_path}")
        size = os.path.getsize(input_file_path)
        logger.debug(f"受信サイズ: {size} bytes")
        if size < 2048:
            raise Exception("録音データが小さすぎます（2KB未満）")

        if not openai_client:
            raise Exception("OpenAIクライアントが初期化されていません")

        # 1) まずはそのままWhisperへ
        try:
            logger.debug("Whisperへ直接送信...")
            with open(input_file_path, 'rb') as f:
                transcript = openai_client.audio.transcriptions.create(
                    model="whisper-1",
                    file=f,
                    language="ja"
                )
        except Exception as direct_err:
            logger.warning(f"直接送信失敗: {direct_err}")
            if not PYDUB_AVAILABLE or not FFMPEG_AVAILABLE:
                raise
            logger.debug("pydubでWAV(16k,mono)へ変換して再送...")
            audio = AudioSegment.from_file(input_file_path)
            wav_path = input_file_path + '.wav'
            audio.set_frame_rate(16000).set_channels(1).export(wav_path, format='wav')
            with open(wav_path, 'rb') as f:
                transcript = openai_client.audio.transcriptions.create(
                    model="whisper-1",
                    file=f,
                    language="ja"
                )
            try:
                os.remove(wav_path)
            except Exception:
                pass

        text = (transcript.text or '').strip()
        logger.info(f"音声認識結果: {text}")
        return jsonify({'success': True, 'text': text, 'method': 'whisper', 'timestamp': datetime.now().isoformat()})

    except Exception as e:
        # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
        logger.exception(f"Whisper音声認識 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({'success': False, 'error': '音声認識中にエラーが発生しました。もう一度お試しください'}), 500
    finally:
        # 一時ファイルを削除
        for file_path in [input_file_path, mp3_path] if 'mp3_path' in locals() else [input_file_path]:
            if file_path and os.path.exists(file_path):
                try:
                    os.unlink(file_path)
                    logger.debug(f"一時ファイル削除: {file_path}")
                except Exception:
                    pass
