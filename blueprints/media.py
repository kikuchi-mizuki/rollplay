"""
メディア処理ブループリント
音声認識・TTS・動画生成に関するエンドポイントを提供
"""
import logging
import os
import tempfile
from datetime import datetime
from flask import Blueprint, request, jsonify, Response

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


def init_blueprint(app):
    """
    ブループリント初期化
    app.pyから必要な設定やヘルパー関数を受け取る
    """
    global openai_client, supabase_client, PYDUB_AVAILABLE, FFMPEG_AVAILABLE
    global AudioSegment, sniff_suffix
    global generate_cache_key, get_cached_video, get_did_client
    global download_video_to_storage, save_video_to_cache
    global limiter

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


def apply_rate_limit(limit_string):
    """
    レート制限デコレータを条件付きで適用するヘルパー
    limiterが利用可能な場合のみレート制限を適用
    """
    def decorator(func):
        if limiter:
            return limiter.limit(limit_string)(func)
        return func
    return decorator


@media_bp.route('/tts', methods=['POST'])
def text_to_speech():
    """OpenAI TTSを使用した音声合成"""
    try:
        data = request.get_json()
        text = data.get('text', '')
        voice = data.get('voice', 'nova')  # アバターに応じた音声ID（日本語に適した女性声）

        if not text:
            return jsonify(success=False, error='テキストが空です'), 400

        if not openai_client:
            return jsonify(success=False, error='OpenAIクライアント未初期化'), 500

        # 有効な音声IDのチェック
        valid_voices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
        if voice not in valid_voices:
            voice = 'alloy'  # デフォルトにフォールバック

        # OpenAI TTSで音声生成（高品質モデル + リアルな会話スピード）
        response = openai_client.audio.speech.create(
            model="tts-1",  # 高速モデル（レスポンス重視）  # 高品質モデル（より自然な発音）
            voice=voice,       # アバターに応じた音声（alloy, echo, fable, onyx, nova, shimmer）
            input=text,
            speed=1.3          # リアルな営業ロープレのペース（1-2秒で返答開始）
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
        import traceback
        traceback.print_exc()
        return jsonify(success=False, error='音声生成中にエラーが発生しました。もう一度お試しください'), 500


@media_bp.route('/did-video', methods=['POST'])
def generate_did_video():
    """
    D-ID APIを使用してリップシンク動画を生成（Week 7: キャッシング対応）

    Request:
        {
            "text": "こんにちは",
            "avatar_url": "https://...",  # オプション: アバター画像URL
            "voice_id": "ja-JP-NanamiNeural"  # オプション: 音声ID
        }

    Response:
        {
            "success": true,
            "video_url": "https://...",
            "cached": true|false,  # キャッシュヒットかどうか
            "talk_id": "..."  # 新規生成時のみ
        }
    """
    try:
        data = request.json
        text = data.get('text', '')
        avatar_url = data.get('avatar_url', 'https://d-id-public-bucket.s3.amazonaws.com/alice.jpg')
        voice_id = data.get('voice_id', 'ja-JP-NanamiNeural')

        if not text:
            return jsonify(success=False, error='テキストが必要です'), 400

        # Week 7: キャッシュキーを生成
        cache_key = generate_cache_key(text, voice_id, avatar_url)

        # Week 7: キャッシュをチェック
        if supabase_client:
            cached_video = get_cached_video(supabase_client, cache_key)
            if cached_video:
                # キャッシュヒット！即座に返却
                return jsonify(
                    success=True,
                    video_url=cached_video['video_url'],
                    cached=True,
                    cache_hit_count=cached_video.get('hit_count', 0)
                )

        # キャッシュミス：D-IDで新規生成
        did_client = get_did_client()
        if not did_client:
            return jsonify(success=False, error='D-ID APIが設定されていません'), 500

        # D-ID動画を生成（テキストから直接）
        logger.info(f"🎬 Generating D-ID video for text: {text[:50]}...")
        result = did_client.create_talk_from_text(
            text=text,
            voice_id=voice_id,
            source_url=avatar_url
        )

        talk_id = result.get('id')
        logger.debug(f"📝 D-ID talk created: {talk_id}")

        # 完了を待機（最大120秒）
        did_video_url = did_client.wait_for_completion(talk_id, timeout=120)

        if did_video_url:
            logger.info(f"✅ D-ID video ready: {did_video_url}")

            # Week 7: Supabase Storageに保存してキャッシュ
            if supabase_client:
                storage_url = download_video_to_storage(supabase_client, did_video_url, cache_key)
                if storage_url:
                    # キャッシュテーブルに保存
                    save_video_to_cache(
                        supabase_client,
                        cache_key=cache_key,
                        text=text,
                        voice_id=voice_id,
                        avatar_url=avatar_url,
                        video_url=storage_url,
                        storage_path=f"video_cache/{cache_key}.mp4"
                    )
                    # Supabase Storageの URL を返す
                    final_video_url = storage_url
                else:
                    # Storage保存失敗時はD-IDのURLをそのまま使用
                    final_video_url = did_video_url
            else:
                final_video_url = did_video_url

            return jsonify(
                success=True,
                video_url=final_video_url,
                cached=False,
                talk_id=talk_id
            )
        else:
            return jsonify(
                success=False,
                error='動画生成がタイムアウトしました',
                talk_id=talk_id
            ), 500

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(success=False, error=str(e)), 500


@media_bp.route('/transcribe', methods=['POST'])
@apply_rate_limit("5 per minute")  # Whisper API使用のためレート制限
def transcribe():
    try:
        if 'audio' not in request.files:
            return jsonify(success=False, error='音声ファイルが見つかりません'), 400
        up = request.files['audio']
        # 一旦 .bin で保存
        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as t:
            up.save(t.name)
            temp_path = t.name
        # 先頭バイトから実体を判定してrename
        real_suffix = sniff_suffix(temp_path)
        new_path = temp_path
        if real_suffix != '.bin':
            new_path = temp_path + real_suffix
            os.replace(temp_path, new_path)
        size = os.path.getsize(new_path)
        logger.debug(f"[upload] mime={up.mimetype} saved={new_path} size={size}")
        if size < 1024:  # 1KB未満は明らかに短すぎる
            try: os.remove(new_path)
            except Exception: pass
            logger.error(f"録音データが小さすぎます: {size} bytes")
            return jsonify(success=False, error=f'録音データが小さすぎます({size} bytes)。もう少し長く話してください。'), 400
        # Whisperへ（まず直送）
        if not openai_client:
            return jsonify(success=False, error='OpenAIクライアント未初期化'), 500

        # Whisperで音声認識（promptなしで無音時の誤認識を防止）
        # promptを削除：無音時に「ご視聴ありがとうございます」などの定型句を生成するのを防ぐ
        logger.debug(f"[Whisper設定] prompt: なし, temperature: 0")

        try:
            with open(new_path, 'rb') as f:
                r = openai_client.audio.transcriptions.create(
                    model='whisper-1',
                    file=f,
                    language='ja',
                    temperature=0
                )
            text = (getattr(r, 'text', '') or '').strip()
            logger.debug(f"[Whisper成功] 認識結果: {text}")
            return jsonify(success=True, text=text, method='whisper', timestamp=datetime.now().isoformat())
        except Exception as e:
            logger.debug(f"[Whisper失敗] エラー: {e}, ファイルサイズ: {size} bytes")
            if not (PYDUB_AVAILABLE and FFMPEG_AVAILABLE):
                raise
            wav_path = new_path + '.wav'
            AudioSegment.from_file(new_path).set_frame_rate(16000).set_channels(1).export(wav_path, format='wav')
            try:
                with open(wav_path, 'rb') as f:
                    r = openai_client.audio.transcriptions.create(
                        model='whisper-1',
                        file=f,
                        language='ja',
                        temperature=0
                    )
                text = (getattr(r, 'text', '') or '').strip()
                return jsonify(success=True, text=text, method='whisper', timestamp=datetime.now().isoformat())
            finally:
                try: os.remove(wav_path)
                except Exception: pass
    except ValueError as e:
        logger.error(f"入力値が不正: {e}")
        return jsonify(success=False, error='音声ファイルの形式が不正です'), 400
    except OSError as e:
        logger.error(f"ファイルI/O: {e}")
        import traceback; traceback.print_exc()
        return jsonify(success=False, error='音声ファイルの処理中にエラーが発生しました'), 500
    except Exception as e:
        # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
        logger.error(f"予期しないエラー: {type(e).__name__}: {e}")
        import traceback; traceback.print_exc()
        return jsonify(success=False, error='音声認識中にエラーが発生しました。もう一度お試しください。'), 500
    finally:
        try:
            if 'new_path' in locals() and new_path and os.path.exists(new_path):
                os.remove(new_path)
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
                "御社の事業内容について伺います。SNS動画制作、ショート動画、"
                "TikTok、Instagram、YouTubeを活用したマーケティング、集客、"
                "ブランディングについて相談させていただきます。"
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
        import traceback
        traceback.print_exc()
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
        logger.error(f"Whisper音声認識エラー詳細: {str(e)}")
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': f'Whisper音声認識エラー: {str(e)}'}), 500
    finally:
        # 一時ファイルを削除
        for file_path in [input_file_path, mp3_path] if 'mp3_path' in locals() else [input_file_path]:
            if file_path and os.path.exists(file_path):
                try:
                    os.unlink(file_path)
                    logger.debug(f"一時ファイル削除: {file_path}")
                except Exception:
                    pass
