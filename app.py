from flask import Flask, request, jsonify, render_template, Response
from openai import OpenAI  # 新SDKクライアントを統一利用
import os
# Blueprintsのインポート
from blueprints.scenarios import scenarios_bp, init_blueprint as init_scenarios_blueprint
from blueprints.media import media_bp, init_blueprint as init_media_blueprint
from blueprints.static import static_bp, init_blueprint as init_static_blueprint
from blueprints.admin import admin_bp, init_blueprint as init_admin_blueprint
from blueprints.evaluations import evaluations_bp, init_blueprint as init_evaluations_blueprint
from blueprints.conversations import conversations_bp, init_blueprint as init_conversations_blueprint
# コスト制限モジュールのインポート
from utils.cost_limiter import cost_limiter, require_budget
import json
import re
import subprocess
import sys
from datetime import datetime
import base64
import io
import tempfile
import secrets
import hmac
import hashlib
from dotenv import load_dotenv
from shutil import which
from supabase import create_client, Client
from d_id_client import get_did_client, generate_cache_key, get_cached_video, save_video_to_cache, download_video_to_storage
from concurrent.futures import ThreadPoolExecutor, as_completed
from queue import Queue, Empty
import threading
from functools import wraps, lru_cache
import logging
from logging.handlers import RotatingFileHandler

# flask-corsのインポート（エラーハンドリング付き）
try:
    from flask_cors import CORS
    CORS_AVAILABLE = True
except ImportError as e:
    logging.warning(f"flask-corsインポートエラー: {e}")
    CORS_AVAILABLE = False
    CORS = None

# flask-limiterのインポート（レート制限用）
try:
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address
    LIMITER_AVAILABLE = True
    logging.info("flask-limiter利用可能")
except ImportError as e:
    logging.warning(f"flask-limiterインポートエラー: {e}")
    LIMITER_AVAILABLE = False
    Limiter = None
    get_remote_address = None

# flasggerのインポート（API仕様書自動生成用）
try:
    from flasgger import Swagger
    FLASGGER_AVAILABLE = True
    logging.info("flasgger利用可能")
except ImportError as e:
    logging.warning(f"flasggerインポートエラー: {e}")
    FLASGGER_AVAILABLE = False
    Swagger = None

# pydubのインポート（エラーハンドリング付き）
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
    logging.info("pydub利用可能")
except ImportError as e:
    logging.warning(f"pydubインポートエラー: {e}")
    PYDUB_AVAILABLE = False
    AudioSegment = None

# yamlのインポート（エラーハンドリング付き）
try:
    import yaml
    YAML_AVAILABLE = True
    logging.info("yaml利用可能")
except ImportError as e:
    logging.warning(f"yamlインポートエラー: {e}")
    YAML_AVAILABLE = False
    yaml = None

# FAISSとnumpyのインポート（RAG検索用）
try:
    import faiss
    import numpy as np
    FAISS_AVAILABLE = True
    logging.info("FAISS利用可能")
except ImportError as e:
    logging.warning(f"FAISSインポートエラー: {e}")
    FAISS_AVAILABLE = False
    faiss = None
    np = None

# 環境変数を読み込み
load_dotenv()

# ===== シンプルなメモリベースのレート制限（フォールバック） =====
from collections import defaultdict
from datetime import datetime, timedelta

class SimpleRateLimiter:
    """
    シンプルなメモリベースのレート制限（flask-limiterのフォールバック）
    スレッドセーフで、固定ウィンドウ戦略を使用
    """
    def __init__(self, app=None, key_func=None, max_keys=10000):
        self.app = app
        self.key_func = key_func or self._default_key_func
        self.storage = defaultdict(list)
        self.lock = threading.Lock()
        self.max_keys = max_keys  # DoS対策: 最大キー数制限

    def _default_key_func(self):
        """
        デフォルトのキー関数（プロキシ対応のリモートアドレス取得）
        X-Forwarded-Forヘッダーから実際のクライアントIPを取得
        """
        from flask import request

        # X-Forwarded-Forヘッダーから実際のIPアドレスを取得
        # 形式: "client, proxy1, proxy2" から最初のIPを取得
        forwarded_for = request.headers.get('X-Forwarded-For')
        if forwarded_for:
            # 最初のIPアドレス（実際のクライアント）を取得
            client_ip = forwarded_for.split(',')[0].strip()
            # 簡単なIPアドレス形式の検証
            import re
            # IPv4またはIPv6の基本的な形式チェック
            if re.match(r'^[\d\.]+$|^[\da-fA-F:]+$', client_ip):
                return client_ip

        # X-Real-IPヘッダー（一部のプロキシが使用）
        real_ip = request.headers.get('X-Real-IP')
        if real_ip:
            return real_ip.strip()

        # フォールバック: request.remote_addr
        return request.remote_addr or 'unknown'

    def _parse_limit_string(self, limit_string):
        """
        レート制限文字列をパース
        例: "10 per minute" -> (10, 60秒)
        """
        import re
        match = re.match(r'(\d+)\s+per\s+(second|minute|hour|day)', limit_string.lower())
        if not match:
            raise ValueError(f"Invalid limit string: {limit_string}")

        count = int(match.group(1))
        unit = match.group(2)

        unit_seconds = {
            'second': 1,
            'minute': 60,
            'hour': 3600,
            'day': 86400
        }

        return count, unit_seconds[unit]

    def limit(self, limit_string):
        """
        レート制限デコレータを返す（flask-limiter互換）

        Args:
            limit_string: レート制限文字列（例: "10 per minute"）
        """
        def decorator(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                limit_count, window_seconds = self._parse_limit_string(limit_string)
                key = self.key_func()

                with self.lock:
                    now = datetime.now()
                    cutoff_time = now - timedelta(seconds=window_seconds)

                    # 古いエントリをクリーンアップ
                    self.storage[key] = [
                        timestamp for timestamp in self.storage[key]
                        if timestamp > cutoff_time
                    ]

                    # DoS対策: キー数制限チェック
                    if len(self.storage) > self.max_keys:
                        # 最も古いタイムスタンプを持つキーを削除
                        oldest_key = min(
                            self.storage.keys(),
                            key=lambda k: self.storage[k][0] if self.storage[k] else now
                        )
                        del self.storage[oldest_key]
                        logger.warning(f"⚠️ レート制限ストレージ上限到達: 古いキーを削除 {oldest_key}")

                    # レート制限チェック
                    if len(self.storage[key]) >= limit_count:
                        logger.warning(f"⚠️ レート制限超過: {key} ({limit_string})")
                        return jsonify({
                            'success': False,
                            'error': 'レート制限を超過しました。しばらく待ってから再試行してください。'
                        }), 429

                    # リクエストを記録
                    self.storage[key].append(now)

                return func(*args, **kwargs)
            return wrapper
        return decorator

    def cleanup_old_entries(self, max_age_seconds=3600):
        """
        古いエントリを定期的にクリーンアップ（メモリリーク防止）
        max_age_seconds: 保持する最大秒数（デフォルト1時間）
        """
        with self.lock:
            cutoff_time = datetime.now() - timedelta(seconds=max_age_seconds)
            for key in list(self.storage.keys()):
                self.storage[key] = [
                    timestamp for timestamp in self.storage[key]
                    if timestamp > cutoff_time
                ]
                if not self.storage[key]:
                    del self.storage[key]

# ===== ログ記録システムの設定 =====

# 環境変数からログレベルを取得（デフォルト: 本番環境はWARNING、開発環境はINFO）
is_production = os.getenv('PRODUCTION', '').lower() in ('true', '1', 'yes')
default_log_level = 'WARNING' if is_production else 'INFO'
log_level_str = os.getenv('LOG_LEVEL', default_log_level).upper()

# ログレベル文字列を logging 定数に変換
log_level = getattr(logging, log_level_str, logging.INFO)

# ロガーの設定
logger = logging.getLogger(__name__)
logger.setLevel(log_level)

# ログディレクトリの作成
log_dir = os.path.join(os.path.dirname(__file__), 'logs')
os.makedirs(log_dir, exist_ok=True)

# ファイルハンドラー（ローテーション付き: 最大10MB、5世代保持）
file_handler = RotatingFileHandler(
    os.path.join(log_dir, 'app.log'),
    maxBytes=10 * 1024 * 1024,  # 10MB
    backupCount=5,
    encoding='utf-8'
)
file_handler.setLevel(log_level)

# コンソールハンドラー（開発用）
console_handler = logging.StreamHandler()
console_handler.setLevel(log_level)

# フォーマッター設定
formatter = logging.Formatter(
    '%(asctime)s [%(levelname)s] %(name)s: %(message)s [in %(pathname)s:%(lineno)d]',
    datefmt='%Y-%m-%d %H:%M:%S'
)
file_handler.setFormatter(formatter)
console_handler.setFormatter(formatter)

# ハンドラーを追加
logger.addHandler(file_handler)
logger.addHandler(console_handler)

logger.info("=" * 80)
logger.info(f"アプリケーション起動 - ログシステム初期化完了（ログレベル: {log_level_str}）")
logger.info(f"環境: {'本番' if is_production else '開発'}")
logger.info("=" * 80)

# ===== CSRF保護（カスタム実装） =====

# CSRF秘密鍵（環境変数から取得、なければ生成）
CSRF_SECRET_KEY = os.getenv('CSRF_SECRET_KEY')
if not CSRF_SECRET_KEY:
    # 開発環境用に固定キーを使用（本番環境では環境変数を設定すること）
    CSRF_SECRET_KEY = secrets.token_urlsafe(32)
    logger.warning("⚠️ CSRF_SECRET_KEYが設定されていません - ランダムキーを使用（サーバー再起動でトークンが無効化されます）")
else:
    logger.info("✅ CSRF_SECRET_KEYが設定されています")

# CSRFトークンストア（メモリベース、有効期限付き）
csrf_tokens = {}  # {token: {user_id: str, created_at: datetime}}
csrf_token_lock = threading.Lock()

def generate_csrf_token(user_id: str = None) -> str:
    """
    CSRFトークンを生成

    Args:
        user_id: ユーザーID（認証済みユーザーの場合）

    Returns:
        CSRFトークン（Base64エンコード）
    """
    # ランダムトークンを生成
    random_token = secrets.token_urlsafe(32)

    # HMAC署名を生成（改ざん防止）
    message = f"{random_token}:{user_id or 'anonymous'}"
    signature = hmac.new(
        CSRF_SECRET_KEY.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()

    # トークン = ランダム値:署名
    token = f"{random_token}:{signature}"

    # トークンストアに保存
    with csrf_token_lock:
        csrf_tokens[token] = {
            'user_id': user_id,
            'created_at': datetime.now()
        }

    return token

def verify_csrf_token(token: str, user_id: str = None) -> bool:
    """
    CSRFトークンを検証

    Args:
        token: CSRFトークン
        user_id: ユーザーID（認証済みユーザーの場合）

    Returns:
        トークンが有効かどうか
    """
    if not token:
        return False

    try:
        # トークンを分割
        parts = token.split(':')
        if len(parts) != 2:
            return False

        random_token, signature = parts

        # HMAC署名を検証
        message = f"{random_token}:{user_id or 'anonymous'}"
        expected_signature = hmac.new(
            CSRF_SECRET_KEY.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(signature, expected_signature):
            logger.warning(f"⚠️ CSRF署名検証失敗: user_id={user_id}")
            return False

        # トークンストアから取得
        with csrf_token_lock:
            token_data = csrf_tokens.get(token)
            if not token_data:
                logger.warning(f"⚠️ CSRFトークンが見つかりません: user_id={user_id}")
                return False

            # 有効期限チェック（1時間）
            age = (datetime.now() - token_data['created_at']).total_seconds()
            if age > 3600:  # 1時間
                del csrf_tokens[token]
                logger.warning(f"⚠️ CSRFトークンが期限切れ: age={age}秒, user_id={user_id}")
                return False

            # ユーザーIDが一致するかチェック（認証済みユーザーの場合）
            if user_id and token_data['user_id'] != user_id:
                logger.warning(f"⚠️ CSRFトークンのユーザーID不一致: expected={token_data['user_id']}, actual={user_id}")
                return False

        return True

    except Exception as e:
        logger.error(f"CSRF検証エラー: {e}")
        return False

def cleanup_csrf_tokens():
    """
    期限切れCSRFトークンをクリーンアップ
    """
    with csrf_token_lock:
        now = datetime.now()
        expired_tokens = [
            token for token, data in csrf_tokens.items()
            if (now - data['created_at']).total_seconds() > 3600
        ]
        for token in expired_tokens:
            del csrf_tokens[token]
        if expired_tokens:
            logger.info(f"🧹 期限切れCSRFトークンを削除: {len(expired_tokens)}個")

def require_csrf(f):
    """
    CSRF保護デコレータ

    GETリクエストは除外、POST/PUT/DELETEのみ検証
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # GETリクエストはCSRF検証をスキップ
        if request.method == 'GET':
            return f(*args, **kwargs)

        # CSRFトークンを取得
        csrf_token = request.headers.get('X-CSRF-Token')

        if not csrf_token:
            logger.warning(f"⚠️ CSRFトークンが提供されていません: {request.method} {request.path}")
            return jsonify({
                'success': False,
                'error': 'CSRFトークンが必要です'
            }), 403

        # ユーザーIDを取得（認証済みの場合）
        user_id = None
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            try:
                from supabase import create_client
                supabase_url = os.getenv('SUPABASE_URL')
                supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
                if supabase_url and supabase_key:
                    supabase_client = create_client(supabase_url, supabase_key)
                    token = auth_header.replace('Bearer ', '')
                    user_response = supabase_client.auth.get_user(token)
                    if user_response and user_response.user:
                        user_id = user_response.user.id
            except Exception as e:
                logger.debug(f"ユーザーID取得エラー（CSRF検証）: {e}")

        # CSRFトークンを検証
        if not verify_csrf_token(csrf_token, user_id):
            logger.warning(f"⚠️ CSRF検証失敗: {request.method} {request.path}, user_id={user_id}")
            return jsonify({
                'success': False,
                'error': 'CSRFトークンが無効です'
            }), 403

        return f(*args, **kwargs)

    return decorated_function

# CSRFトークンクリーンアップタイマー（30分ごと）
def csrf_cleanup_timer():
    while True:
        threading.Event().wait(1800)  # 30分
        cleanup_csrf_tokens()

csrf_cleanup_thread = threading.Thread(target=csrf_cleanup_timer, daemon=True)
csrf_cleanup_thread.start()
logger.info("✅ CSRFトークンクリーンアップスレッド起動")

app = Flask(__name__)
if CORS_AVAILABLE and CORS:
    # CORS設定：開発環境と本番環境の両方に対応
    allowed_origins = [
        'http://localhost:3000',      # React開発環境
        'http://localhost:5173',      # Vite開発環境
    ]

    # 本番環境のFRONTEND_URLを追加
    frontend_url = os.getenv('FRONTEND_URL', '').strip()
    if frontend_url:
        allowed_origins.append(frontend_url)
        logger.info(f"✅ 本番フロントエンドURL追加: {frontend_url}")
    else:
        logger.warning("⚠️ FRONTEND_URLが設定されていません（開発環境のみ対応）")

    # 空文字列を除外
    allowed_origins = [origin for origin in allowed_origins if origin]

    # 本番環境ではオリジンを必ず指定（セキュリティ強化）
    if not allowed_origins:
        logger.error("❌ CORS設定エラー: 許可するオリジンが1つも設定されていません")
        raise ValueError("CORS origins must be configured. Set FRONTEND_URL in production.")

    CORS(app,
         origins=allowed_origins,
         supports_credentials=True,
         allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
         methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
         max_age=3600  # プリフライトリクエストのキャッシュ時間（1時間）
    )
    logger.info(f"✅ CORS有効化: {allowed_origins}")

# レート制限の設定（APIコスト爆発を防ぐ）
limiter = None
if LIMITER_AVAILABLE and Limiter:
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://",
        strategy="fixed-window"
    )
    logger.info("✅ flask-limiterでレート制限有効化: デフォルト 200回/日, 50回/時間")
else:
    # フォールバック: シンプルなメモリベースのレート制限を使用
    limiter = SimpleRateLimiter(app=app)
    logger.warning("⚠️ flask-limiterが利用できません - SimpleRateLimiterフォールバックを使用")
    logger.info("✅ メモリベースのレート制限有効化（フォールバック）")

    # 定期的にメモリをクリーンアップするタイマーを設定
    def cleanup_timer():
        while True:
            threading.Event().wait(1800)  # 30分ごと
            if limiter and isinstance(limiter, SimpleRateLimiter):
                limiter.cleanup_old_entries()
                logger.info("🧹 レート制限ストレージをクリーンアップしました")

    cleanup_thread = threading.Thread(target=cleanup_timer, daemon=True)
    cleanup_thread.start()
    logger.info("✅ レート制限クリーンアップスレッド起動")

# Swagger設定（API仕様書自動生成）
if FLASGGER_AVAILABLE and Swagger:
    swagger_config = {
        "headers": [],
        "specs": [
            {
                "endpoint": 'apispec',
                "route": '/apispec.json',
                "rule_filter": lambda rule: True,
                "model_filter": lambda tag: True,
            }
        ],
        "static_url_path": "/flasgger_static",
        "swagger_ui": True,
        "specs_route": "/api/docs"
    }
    swagger_template = {
        "swagger": "2.0",
        "info": {
            "title": "営業ロープレ自動化システム API",
            "description": "AIが顧客役を演じる営業トレーニングシステムのAPI仕様書",
            "version": "1.0.0",
            "contact": {
                "name": "API Support"
            }
        },
        "securityDefinitions": {
            "Bearer": {
                "type": "apiKey",
                "name": "Authorization",
                "in": "header",
                "description": "JWT認証トークン（形式: Bearer <token>）"
            }
        },
        "security": [
            {
                "Bearer": []
            }
        ],
        "tags": [
            {"name": "認証", "description": "ユーザー認証関連"},
            {"name": "シナリオ", "description": "シナリオ管理"},
            {"name": "会話", "description": "チャット対話・会話履歴"},
            {"name": "評価", "description": "AI評価・講師評価"},
            {"name": "メディア", "description": "音声認識・TTS・動画生成"},
            {"name": "管理者", "description": "管理者機能・統計"},
            {"name": "静的ファイル", "description": "フロントエンド配信"}
        ]
    }
    Swagger(app, config=swagger_config, template=swagger_template)
    logger.info("Swagger UI有効化: /api/docs でAPI仕様書を参照可能")
else:
    logger.warning("flasggerが利用できません（API仕様書生成は無効）")

# Supabase設定
supabase_url = os.getenv('VITE_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY')
supabase_client: Client = None

if supabase_url and supabase_key:
    try:
        supabase_client = create_client(supabase_url, supabase_key)
        logger.info(f"✅ Supabase接続成功: {supabase_url}")
    except Exception as e:
        logger.error(f"❌ Supabase接続エラー: URL={supabase_url}, Error={type(e).__name__}: {e}", exc_info=True)
        supabase_client = None
else:
    if not supabase_url:
        logger.warning("⚠️ VITE_SUPABASE_URLが設定されていません")
    if not supabase_key:
        logger.warning("⚠️ SUPABASE_SERVICE_ROLE_KEYまたはVITE_SUPABASE_ANON_KEYが設定されていません")
    logger.warning("Supabaseなしで起動します（データ永続化機能は無効）")

# ===== 入力値検証の定数 =====

# メッセージと会話履歴の制限（セキュリティとコスト対策）
MAX_MESSAGE_LENGTH = 2000  # ユーザーメッセージの最大文字数
MAX_HISTORY_LENGTH = 50    # 会話履歴の最大メッセージ数
MAX_SCENARIO_NAME_LENGTH = 100  # シナリオ名の最大文字数
MAX_EVALUATION_TEXT_LENGTH = 10000  # 評価テキストの最大文字数

logger.info(f"入力値検証設定: メッセージ最大{MAX_MESSAGE_LENGTH}文字, 履歴最大{MAX_HISTORY_LENGTH}件")

# ===== 認証と権限制御（アプリケーション層） =====

def get_current_user():
    """
    リクエストヘッダーからSupabase JWTトークンを取得し、ユーザー情報を返す

    Returns:
        dict: {'user_id': str, 'role': str, 'profile': dict} または None
    """
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None

    token = auth_header.replace('Bearer ', '')

    try:
        # Supabase auth APIでトークンを検証してユーザー情報を取得
        user_response = supabase_client.auth.get_user(token)
        if not user_response or not user_response.user:
            return None

        user = user_response.user
        user_id = user.id

        # profilesテーブルからロール情報を取得
        profile_response = supabase_client.table('profiles').select('*').eq('id', user_id).single().execute()

        if not profile_response.data:
            # プロフィールが存在しない場合はデフォルトのuser role
            return {
                'user_id': user_id,
                'role': 'user',
                'profile': None
            }

        profile = profile_response.data
        return {
            'user_id': user_id,
            'role': profile.get('role', 'user'),
            'profile': profile
        }
    except Exception as e:
        logger.warning(f"認証エラー: {e}")
        return None

def require_auth(f):
    """
    認証が必要なエンドポイント用デコレータ
    ログインしていない場合は401エラーを返す
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        current_user = get_current_user()
        if not current_user:
            return jsonify({'success': False, 'error': 'Authentication required'}), 401

        # リクエストコンテキストにユーザー情報を追加
        request.current_user = current_user
        return f(*args, **kwargs)
    return decorated_function

def require_role(*allowed_roles):
    """
    特定のロールが必要なエンドポイント用デコレータ

    Args:
        *allowed_roles: 許可されたロール ('admin', 'manager', 'user')

    Example:
        @require_role('admin')
        @require_role('admin', 'manager')
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            current_user = get_current_user()
            if not current_user:
                return jsonify({'success': False, 'error': 'Authentication required'}), 401

            if current_user['role'] not in allowed_roles:
                return jsonify({
                    'success': False,
                    'error': f'Permission denied. Required role: {", ".join(allowed_roles)}'
                }), 403

            # リクエストコンテキストにユーザー情報を追加
            request.current_user = current_user
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def can_access_data(current_user, data_user_id=None, data_store_id=None):
    """
    現在のユーザーが指定されたデータにアクセス可能かチェック

    Args:
        current_user: get_current_user()の戻り値
        data_user_id: データの所有者のuser_id
        data_store_id: データの所属店舗ID

    Returns:
        bool: アクセス可能ならTrue
    """
    if not current_user:
        return False

    role = current_user['role']
    user_id = current_user['user_id']
    profile = current_user.get('profile', {})
    user_store_id = profile.get('store_id') if profile else None

    # 管理者は全データにアクセス可能
    if role == 'admin':
        return True

    # 店舗管理者は自店舗のデータにアクセス可能
    if role == 'manager' and data_store_id and user_store_id == data_store_id:
        return True

    # 一般ユーザーは自分のデータのみアクセス可能
    if data_user_id and user_id == data_user_id:
        return True

    return False

# OpenAI API設定（Whisper統一版）
openai_api_key = os.getenv('OPENAI_API_KEY')
if not openai_api_key:
    logger.warning("⚠️ OPENAI_API_KEYが設定されていません")
    logger.warning("テストモードで実行します（モック応答を使用）")
    logger.warning("本番環境では.envファイルにOPENAI_API_KEYを設定してください")
    openai_client = None
else:
    try:
        # OpenAI APIクライアント初期化
        openai_client = OpenAI(api_key=openai_api_key)
        logger.info("✅ OpenAI API初期化成功")
    except Exception as e:
        logger.error(f"❌ OpenAI API初期化エラー: {type(e).__name__}: {e}", exc_info=True)
        openai_client = None

# Whisper統一版ではOpenAIのGPTモデルを使用
logger.info("Whisper統一版: OpenAI GPT-4を使用")
logger.info("音声認識: Whisper-1")
logger.info("対話生成: GPT-4o-mini (max_tokens=150, 完結性重視)")

# ===== シナリオ読込（STEP4の先行準備：軽量Few-shot統合） =====
SCENARIO_DIR = os.path.join(os.path.dirname(__file__), 'scenarios')
SCENARIOS_INDEX_PATH = os.path.join(SCENARIO_DIR, 'index.json')
SCENARIOS_INDEX = {}
DEFAULT_SCENARIO_ID = None

def load_scenarios_index():
    """`scenarios/index.json` を読み込み、有効なシナリオ一覧とデフォルトIDを保持する"""
    global SCENARIOS_INDEX, DEFAULT_SCENARIO_ID
    try:
        if not os.path.exists(SCENARIOS_INDEX_PATH):
            logger.warning(f"シナリオindexが見つかりません: {SCENARIOS_INDEX_PATH}")
            SCENARIOS_INDEX = {}
            DEFAULT_SCENARIO_ID = None
            return
        with open(SCENARIOS_INDEX_PATH, 'r', encoding='utf-8') as f:
            idx = json.load(f)
        DEFAULT_SCENARIO_ID = idx.get('default_id')
        entries = idx.get('scenarios', [])
        SCENARIOS_INDEX = {e['id']: os.path.join(SCENARIO_DIR, e['file']) for e in entries if e.get('enabled', True)}
        logger.info(f"シナリオ読込: {len(SCENARIOS_INDEX)}件、default={DEFAULT_SCENARIO_ID}")
    except Exception as e:
        logger.error(f"シナリオindex読込エラー: {e}")
        SCENARIOS_INDEX = {}
        DEFAULT_SCENARIO_ID = None

@lru_cache(maxsize=128)
def load_scenario_object(scenario_id: str):
    """シナリオIDからJSONを読み込み、LRUキャッシュで管理（最大128件）"""
    if not scenario_id:
        return None
    path = SCENARIOS_INDEX.get(scenario_id)
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            obj = json.load(f)
        return obj
    except Exception as e:
        logger.error(f"シナリオ読込エラー({scenario_id}): {e}")
        return None

load_scenarios_index()

# ===== Rubric読込（STEP4：評価基準の外部化） =====
RUBRIC_DIR = os.path.join(os.path.dirname(__file__), 'rubrics')
RUBRIC_PATH = os.path.join(RUBRIC_DIR, 'rubric.yaml')
RUBRIC_DATA = None

def load_rubric():
    """`rubrics/rubric.yaml` を読み込み、評価基準データを保持する"""
    global RUBRIC_DATA
    try:
        if not os.path.exists(RUBRIC_PATH):
            logger.warning(f"Rubricファイルが見つかりません: {RUBRIC_PATH}")
            RUBRIC_DATA = None
            return
        if not YAML_AVAILABLE or not yaml:
            logger.warning("yamlモジュールが利用不可のため、Rubricを読み込めません")
            RUBRIC_DATA = None
            return
        with open(RUBRIC_PATH, 'r', encoding='utf-8') as f:
            RUBRIC_DATA = yaml.safe_load(f)
        logger.info(f"Rubric読込完了: version={RUBRIC_DATA.get('version')}")
    except Exception as e:
        logger.error(f"Rubric読込エラー: {e}")
        RUBRIC_DATA = None

load_rubric()

# ===== 共有ペルソナ読込（全シーン共通） =====
PERSONAS_DIR = os.path.join(os.path.dirname(__file__), 'personas')
PERSONAS_PATH = os.path.join(PERSONAS_DIR, 'shared_personas.json')
SHARED_PERSONAS = []

def load_shared_personas():
    """`personas/shared_personas.json` を読み込み、全シーン共通のペルソナ一覧を保持する"""
    global SHARED_PERSONAS
    try:
        if not os.path.exists(PERSONAS_PATH):
            logger.warning(f"共有ペルソナファイルが見つかりません: {PERSONAS_PATH}")
            SHARED_PERSONAS = []
            return
        with open(PERSONAS_PATH, 'r', encoding='utf-8') as f:
            SHARED_PERSONAS = json.load(f)
        logger.info(f"共有ペルソナ読込完了: {len(SHARED_PERSONAS)}パターン")
    except Exception as e:
        logger.error(f"共有ペルソナ読込エラー: {e}")
        SHARED_PERSONAS = []

def select_random_persona_for_scene(scene_id: str):
    """
    シーンIDに応じて、ランダムにペルソナを選択し、そのシーンの状況設定を返す

    Args:
        scene_id: シーンID (meeting_1st, meeting_1_5th, meeting_2nd, meeting_3rd, kickoff, upsell)

    Returns:
        dict: ペルソナ情報（base_profile + scene_variation）
    """
    import random

    if not SHARED_PERSONAS:
        logger.warning("[ペルソナ選択] 共有ペルソナが読み込まれていません")
        return None

    # ランダムにペルソナを選択
    persona = random.choice(SHARED_PERSONAS)
    persona_id = persona.get('persona_id', '不明')
    persona_name = persona.get('persona_name', '不明')

    logger.debug(f"[ペルソナ選択] ランダム選択: {persona_name} (ID: {persona_id})")

    # シーンに応じた状況設定を取得
    base_profile = persona.get('base_profile', {})
    scene_variations = persona.get('scene_variations', {})

    # シーンIDに対応する状況設定を取得（デフォルトはmeeting_1st）
    scene_variation = scene_variations.get(scene_id, scene_variations.get('meeting_1st', {}))

    if not scene_variation:
        logger.warning(f"[ペルソナ選択] 警告: シーンID '{scene_id}' の状況設定が見つかりません")

    # ベースプロフィールとシーン状況を統合
    combined_persona = {
        'persona_id': persona_id,
        'persona_name': persona_name,
        **base_profile,
        **scene_variation
    }

    logger.debug(f"[ペルソナ選択] シーン: {scene_id}, 態度: {scene_variation.get('tone', '不明')}")

    return combined_persona


def select_persona_by_id(persona_id, scene_id):
    """
    指定されたpersona_idのペルソナを選択し、
    ベースプロフィールとシーン状況を統合して返す

    Args:
        persona_id: ペルソナID
        scene_id: シーンID (meeting_1st, meeting_1_5th, meeting_2nd, meeting_3rd, kickoff, upsell)

    Returns:
        dict: ペルソナ情報（base_profile + scene_variation）
    """
    if not SHARED_PERSONAS:
        logger.warning("[ペルソナ選択] 共有ペルソナが読み込まれていません")
        return None

    # persona_idが一致するペルソナを検索
    persona = next((p for p in SHARED_PERSONAS if p.get('persona_id') == persona_id), None)

    if not persona:
        logger.warning(f"[ペルソナ選択] 指定されたpersona_id '{persona_id}' が見つかりません")
        return None

    persona_name = persona.get('persona_name', '不明')
    logger.debug(f"[ペルソナ選択] ID指定選択: {persona_name} (ID: {persona_id})")

    # シーンに応じた状況設定を取得
    base_profile = persona.get('base_profile', {})
    scene_variations = persona.get('scene_variations', {})

    # シーンIDに対応する状況設定を取得（デフォルトはmeeting_1st）
    scene_variation = scene_variations.get(scene_id, scene_variations.get('meeting_1st', {}))

    if not scene_variation:
        logger.warning(f"[ペルソナ選択] 警告: シーンID '{scene_id}' の状況設定が見つかりません")

    # ベースプロフィールとシーン状況を統合
    combined_persona = {
        'persona_id': persona_id,
        'persona_name': persona_name,
        **base_profile,
        **scene_variation
    }

    logger.debug(f"[ペルソナ選択] シーン: {scene_id}, 態度: {scene_variation.get('tone', '不明')}")

    return combined_persona


load_shared_personas()

# ===== Few-shot評価サンプル読込（Week 5：評価精度向上） =====
EVALUATION_SAMPLES_DIR = os.path.join(os.path.dirname(__file__), 'evaluation_samples')

@lru_cache(maxsize=64)
def load_evaluation_samples(scenario_id: str):
    """シナリオIDに対応するFew-shot評価サンプルを読み込む（LRUキャッシュ管理、最大64件）"""
    if not scenario_id:
        return None

    # ファイルパスを構築
    samples_file = os.path.join(EVALUATION_SAMPLES_DIR, f"{scenario_id}_samples.json")

    if not os.path.exists(samples_file):
        logger.warning(f"評価サンプルファイルが見つかりません: {samples_file}")
        return None

    try:
        with open(samples_file, 'r', encoding='utf-8') as f:
            samples_data = json.load(f)
        logger.info(f"評価サンプル読込完了: {scenario_id} ({len(samples_data.get('few_shot_examples', []))}件)")
        return samples_data
    except Exception as e:
        logger.error(f"評価サンプル読込エラー({scenario_id}): {e}")
        return None

# ===== RAGインデックス読込（STEP6：RAG連携） =====
RAG_INDEX_DIR = os.path.join(os.path.dirname(__file__), 'rag_index')
RAG_INDEX_PATH = os.path.join(RAG_INDEX_DIR, 'sales_patterns.faiss')
RAG_METADATA_PATH = os.path.join(RAG_INDEX_DIR, 'sales_patterns.json')
RAG_INDEX = None
RAG_METADATA = []

def load_rag_index():
    """RAGインデックスを読み込む"""
    global RAG_INDEX, RAG_METADATA
    try:
        if not FAISS_AVAILABLE or not faiss or not np:
            logger.warning("FAISSが利用不可のため、RAG検索は無効です")
            RAG_INDEX = None
            RAG_METADATA = []
            return
        
        if not os.path.exists(RAG_INDEX_PATH) or not os.path.exists(RAG_METADATA_PATH):
            logger.warning(f"RAGインデックスが見つかりません: {RAG_INDEX_PATH}")
            RAG_INDEX = None
            RAG_METADATA = []
            return
        
        # FAISSインデックスを読み込み
        RAG_INDEX = faiss.read_index(RAG_INDEX_PATH)
        
        # メタデータを読み込み
        with open(RAG_METADATA_PATH, 'r', encoding='utf-8') as f:
            RAG_METADATA = json.load(f)
        
        logger.info(f"RAGインデックス読込完了: {len(RAG_METADATA)}件のパターン")
    except Exception as e:
        logger.error(f"RAGインデックス読込エラー: {e}")
        RAG_INDEX = None
        RAG_METADATA = []

load_rag_index()

# ffmpeg 存在チェック（pydub用）
FFMPEG_AVAILABLE = which('ffmpeg') is not None
if not FFMPEG_AVAILABLE:
    logger.warning("警告: ffmpeg が見つかりません。'brew install ffmpeg' などで導入してください")

# ===== RAG検索関数（STEP6：RAG連携） =====
def search_rag_patterns(query: str, top_k: int = 3, scenario_id: str = None):
    """
    RAGインデックスから類似パターンを検索

    Args:
        query: 検索クエリ（営業の発言など）
        top_k: 返す結果の数
        scenario_id: シナリオIDでフィルタリング（Noneの場合は全シナリオから検索）

    Returns:
        類似パターンのリスト（text, type, scenario_idを含む辞書のリスト）
    """
    if not RAG_INDEX or not RAG_METADATA or not openai_client:
        return []

    try:
        # シナリオIDでフィルタリング
        if scenario_id:
            # 指定シナリオのメタデータのみを対象にする
            filtered_indices = [i for i, m in enumerate(RAG_METADATA) if m.get('scenario_id') == scenario_id]
            if not filtered_indices:
                # 該当するシナリオのデータがない場合は全データから検索
                logger.debug(f"[RAG検索] シナリオ {scenario_id} のデータがありません。全データから検索します。")
                filtered_indices = list(range(len(RAG_METADATA)))
        else:
            filtered_indices = list(range(len(RAG_METADATA)))

        # クエリをEmbedding化
        response = openai_client.embeddings.create(
            model="text-embedding-3-large",
            input=[query]
        )
        query_embedding = np.array([response.data[0].embedding], dtype=np.float32)

        # L2正規化（FAISSインデックスと同様に）
        faiss.normalize_L2(query_embedding)

        # FAISSインデックスで検索（内積）
        # フィルタリング後の候補数の3倍を取得して、後でフィルタリング
        search_k = min(top_k * 10, len(RAG_METADATA))
        if search_k == 0:
            return []

        distances, indices = RAG_INDEX.search(query_embedding, search_k)

        # メタデータから結果を取得（シナリオフィルター適用）
        results = []
        for i, idx in enumerate(indices[0]):
            if idx < len(RAG_METADATA) and idx in filtered_indices:
                pattern = RAG_METADATA[idx].copy()
                pattern['similarity'] = float(distances[0][i])
                results.append(pattern)
                if len(results) >= top_k:
                    break

        return results
    except Exception as e:
        logger.error(f"RAG検索エラー: {e}")
        return []

# 営業ロープレ用のプロンプト（顧客役として明確に指示）
SALES_ROLEPLAY_PROMPT = """あなたは【シナリオ設定】で指定された事業の経営者・マネージャーです。
営業担当との**ビジネス商談**に臨んでいます。

## 🌐 言語設定 【最重要】

**🚨 絶対に遵守：すべての発言を日本語で行ってください 🚨**
- **CRITICAL: You must respond ONLY in Japanese (日本語)**
- **絶対に英語で応答しないでください（Never respond in English）**
- **すべての文を日本語で構成する（Every sentence must be in Japanese）**
- 英語や他の言語への翻訳は一切禁止
- 日本のビジネス慣習に従った自然な日本語で話す
- ビジネス用語（CVR、SNS、ROI等）はそのまま使用して良いが、文章全体は必ず日本語で構成する

**言語チェック：**
- 応答する前に、自分の回答が100%日本語であることを確認してください
- 英語の単語や文が混ざっていないか確認してください
- もし英語が混ざっていたら、即座に日本語に書き直してください

## 発音・イントネーションの注意 【重要】

**🎤 聞き取りやすい日本語を話してください：**
- **明瞭な発音**：一文字一文字をはっきりと発音する
- **適切な間**：文と文の間に自然な間を入れる（句読点を意識）
- **自然なリズム**：ロボット的にならず、人間らしい抑揚をつける
- **読点の使用**：長い文は避け、「、」で区切って話す
- **句点で終わる**：必ず「。」で文を終える
- **カタカナ語は自然に**：外来語も日本語として自然に発音

**❌ 避けるべき話し方：**
- 早口すぎて聞き取れない
- 単調すぎて機械的
- 長すぎる一文（息継ぎなし）
- 不自然な強調やアクセント
- 英語のような発音

## 役割

**あなたは顧客（意思決定者）です。**
- 営業から提案を受ける立場
- ビジネス課題を抱えており、投資対効果を重視している
- 慎重に検討し、データや実績を求める
- 時間は限られている（効率的な会話を好む）

## 会話の基本ルール

**1. ビジネスらしい応答の長さ:**
- 最初の挨拶: 5-10文字（「よろしくお願いします」）
- Yes/No質問: 10-20文字（端的に答える）
- オープンクエスチョン: 20-40文字（要点を絞って話す）
- 詳細を求められた時: 40-60文字（数字・事実ベースで）

**2. ビジネスパーソンらしい話し方:**
- **簡潔・明瞭**：冗長な説明は避ける
- **要点先行**：結論から話す（「はい、〜です」「いえ、〜でして」）
- **具体的**：「売上が伸びない」より「前年比10%減」
- **適度なフィラー**：「そうですね」「えーと」は使うが、多用しない
- **ビジネス用語**：「費用対効果」「ROI」「コンバージョン」など自然に使う
- **読点を活用**：長い文は「、」で区切って聞き取りやすく
- 【シナリオ設定】のexample_dialoguesを参考に

**3. 段階的開示（営業主導を促す）:**
- 最初から全て話さない
- 営業の質問レベルに応じて情報を出す
- 良い質問（具体的・本質的）には、詳しく話す
- 悪い質問（抽象的・一方的）には、簡潔に答えて待つ

## ビジネス商談での実践的な反応

**典型的なビジネスパーソンの反応:**
- 効果への懐疑: 「実績はありますか？」「数字で示せますか？」
- 予算意識: 「投資対効果はどうですか？」「費用感を教えてください」
- 比較検討: 「他社サービスと何が違いますか？」「競合優位性は？」
- 具体性を求める: 「具体的な導入フローは？」「期間はどのくらい？」
- 時間効率: 「要点を教えてください」「ポイントは何ですか？」

**良い営業（ヒアリング力・提案力がある）には:**
- 具体的な数字やデータを共有する
- 前向きに検討する姿勢を見せる
- 次のアクション（再訪問・資料送付等）を受け入れる

**悪い営業（一方的・押し売り）には:**
- 距離を置く（「ちょっと検討させてください」）
- 慎重な態度を取る
- 早く切り上げようとする

## 重要な制約

✅ **必ず守る:**
- 【シナリオ設定】の内容に従う
- **最初に設定した業種・事業内容を絶対に変えない**（例：「美容サロン」と言ったら最後まで美容サロン）
- **最初に設定した現状を絶対に変えない**（例：「月10本外注中」と言ったら最後まで月10本外注中）
- 過去の会話と完全な一貫性を保つ
- 営業の質問に自然に反応
- **ビジネスパーソンらしく**：効率的・論理的・数字志向
- **聞き取りやすく**：明瞭な発音、適切な間、自然なリズム
- **事業概要を聞かれたら**：【シナリオ設定】の「業種」「場所」「事業詳細」を使って答える

## 🚨 厳守事項：発話の長さ制限

**1発話の文数制限（絶対厳守）:**
- ✅ **1文**: 最適（例：「はい、承知しました。」）
- ✅ **2文**: 許容（例：「そうですね。検討してみます。」）
- ⚠️ **3文**: 絶対上限（これ以上は禁止）
- ❌ **4文以上**: 絶対禁止

**1発話の目安文字数**: 20-60文字（最大100文字）

**良い発話の例:**
- 「はい、承知しました。」（1文・9文字）✅
- 「そうですね。前向きに検討します。」（2文・16文字）✅
- 「実績はありますか？具体的な数字があれば教えてください。」（2文・28文字）✅

**悪い発話の例（絶対禁止）:**
- 「はい、承知しました。それでは詳細について教えていただけますか。特に導入事例について知りたいです。費用対効果も気になります。」（4文・62文字）❌

**応答を出す前に必ず確認:**
1. 文の数を数える（「。」の数を数える）
2. 3文以下か確認する
3. 4文以上なら、最も重要な1-2文だけに削る

❌ **絶対にしない:**
- 営業のように質問攻めする
- **自分の業種・状況を途中で変える**（例：美容サロン→音声教室など）
- 最初から全てを話す
- **長々と説明する（3文以上話すのは絶対禁止）**
- カジュアルすぎる口調（友達ではない）
- 【シナリオ設定】にない業種・事業を話す
- 早口すぎて聞き取れない話し方
- 単調で機械的な話し方
- **一度に複数のトピックを話す（1発話=1トピック）**
"""

# ===== ヘルパー関数 =====

# APIレスポンス標準化ヘルパー
def success_response(data=None, message=None, status_code=200):
    """
    成功レスポンスの標準形式

    Args:
        data: レスポンスデータ（dict, list, etc.）
        message: オプションのメッセージ
        status_code: HTTPステータスコード（デフォルト200）

    Returns:
        JSON形式のレスポンス
    """
    response = {
        'success': True,
        'timestamp': datetime.now().isoformat()
    }
    if data is not None:
        response['data'] = data
    if message:
        response['message'] = message
    return jsonify(response), status_code


def error_response(error, code=None, status_code=500):
    """
    エラーレスポンスの標準形式

    Args:
        error: エラーメッセージ（str）
        code: エラーコード（オプション）
        status_code: HTTPステータスコード（デフォルト500）

    Returns:
        JSON形式のレスポンス
    """
    response = {
        'success': False,
        'error': error,
        'timestamp': datetime.now().isoformat()
    }
    if code:
        response['code'] = code
    return jsonify(response), status_code


def validate_integer_param(value, param_name, default=50, min_value=1, max_value=1000):
    """
    クエリパラメータの整数値をバリデーション

    Args:
        value: 検証する値
        param_name: パラメータ名（エラーメッセージ用）
        default: デフォルト値
        min_value: 最小値
        max_value: 最大値

    Returns:
        検証済みの整数値
    """
    if value is None:
        return default

    try:
        int_value = int(value)
        if int_value < min_value:
            logger.warning(f"{param_name}が最小値未満: {int_value} < {min_value}、最小値を使用")
            return min_value
        if int_value > max_value:
            logger.warning(f"{param_name}が最大値超過: {int_value} > {max_value}、最大値を使用")
            return max_value
        return int_value
    except (ValueError, TypeError):
        logger.warning(f"{param_name}の変換エラー: {value}、デフォルト値{default}を使用")
        return default


def validate_required_string(value, param_name):
    """
    必須文字列パラメータのバリデーション

    Args:
        value: 検証する値
        param_name: パラメータ名（エラーメッセージ用）

    Returns:
        検証済みの文字列、またはNone

    Raises:
        ValueError: 値が空の場合
    """
    if not value or not isinstance(value, str) or not value.strip():
        raise ValueError(f"{param_name}は必須です")
    return value.strip()


# 先頭バイトで実体コンテナを推定
def sniff_suffix(path: str) -> str:
    try:
        with open(path, 'rb') as f:
            head = f.read(16)
    except Exception:
        return '.bin'
    if head.startswith(b"\x1A\x45\xDF\xA3"):
        return '.webm'  # EBML
    if head.startswith(b"OggS"):
        return '.ogg'
    if head.startswith(b"RIFF") and b"WAVE" in head[:12]:
        return '.wav'
    if b"ftyp" in head:
        return '.mp4'  # mp4/m4a 兼用
    if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3"):
        return '.mp3'
    return '.bin'

# ===== Blueprintの登録 =====

# シナリオ管理Blueprint
app.register_blueprint(scenarios_bp)
app.config['SCENARIOS_INDEX_PATH'] = SCENARIOS_INDEX_PATH
app.config['load_scenario_object'] = load_scenario_object
app.config['SHARED_PERSONAS'] = SHARED_PERSONAS  # ペルソナ一覧
init_scenarios_blueprint(app)

# メディア処理Blueprint
app.register_blueprint(media_bp)
app.config['openai_client'] = openai_client
app.config['supabase_client'] = supabase_client
app.config['PYDUB_AVAILABLE'] = PYDUB_AVAILABLE
app.config['FFMPEG_AVAILABLE'] = FFMPEG_AVAILABLE
app.config['AudioSegment'] = AudioSegment
app.config['sniff_suffix'] = sniff_suffix
app.config['generate_cache_key'] = generate_cache_key
app.config['get_cached_video'] = get_cached_video
app.config['get_did_client'] = get_did_client
app.config['download_video_to_storage'] = download_video_to_storage
app.config['save_video_to_cache'] = save_video_to_cache
app.config['limiter'] = limiter  # レート制限機能を渡す
app.config['require_auth'] = require_auth  # 認証デコレータを渡す
app.config['require_csrf'] = require_csrf  # CSRF保護デコレータを渡す
app.config['cost_limiter'] = cost_limiter  # コスト制限機能を渡す
app.config['require_budget'] = require_budget  # 予算チェックデコレータを渡す
init_media_blueprint(app)

# 管理者機能Blueprint
app.register_blueprint(admin_bp)
init_admin_blueprint(app)

# 評価機能Blueprint
app.register_blueprint(evaluations_bp)
init_evaluations_blueprint(app)

# 会話機能Blueprint
app.register_blueprint(conversations_bp)
app.config['openai_api_key'] = openai_api_key
app.config['success_response'] = success_response  # APIレスポンスヘルパー
app.config['error_response'] = error_response  # APIレスポンスヘルパー
app.config['validate_integer_param'] = validate_integer_param  # パラメータバリデーション
app.config['validate_required_string'] = validate_required_string  # パラメータバリデーション
app.config['DEFAULT_SCENARIO_ID'] = DEFAULT_SCENARIO_ID
app.config['SALES_ROLEPLAY_PROMPT'] = SALES_ROLEPLAY_PROMPT
app.config['load_scenario_object'] = load_scenario_object
app.config['select_random_persona_for_scene'] = select_random_persona_for_scene
app.config['select_persona_by_id'] = select_persona_by_id
app.config['RAG_INDEX'] = RAG_INDEX
app.config['RAG_METADATA'] = RAG_METADATA
app.config['search_rag_patterns'] = search_rag_patterns
app.config['load_evaluation_samples'] = load_evaluation_samples
app.config['RUBRIC_DATA'] = RUBRIC_DATA
app.config['limiter'] = limiter  # レート制限機能を渡す
app.config['MAX_MESSAGE_LENGTH'] = MAX_MESSAGE_LENGTH  # 入力検証定数
app.config['MAX_HISTORY_LENGTH'] = MAX_HISTORY_LENGTH
app.config['MAX_EVALUATION_TEXT_LENGTH'] = MAX_EVALUATION_TEXT_LENGTH
init_conversations_blueprint(app)

# ===== ルート定義 =====

@app.route('/api/clear-cache', methods=['POST'])
def clear_cache():
    """シナリオキャッシュをクリア（開発用）"""
    try:
        # LRUキャッシュをクリア
        scenario_info = load_scenario_object.cache_info()
        evaluation_info = load_evaluation_samples.cache_info()

        load_scenario_object.cache_clear()
        load_evaluation_samples.cache_clear()

        total_cleared = scenario_info.currsize + evaluation_info.currsize
        logger.info(f"LRUキャッシュをクリアしました（シナリオ: {scenario_info.currsize}件, 評価サンプル: {evaluation_info.currsize}件）")
        return jsonify({
            'success': True,
            'message': f'キャッシュをクリアしました（{total_cleared}件）'
        })
    except Exception as e:
        # 予期しないエラー
        logger.exception(f"キャッシュクリア - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': 'キャッシュのクリアに失敗しました'
        }), 500

@app.route('/ingest', methods=['GET', 'POST'])
def ingest_videos():
    """動画取り込みスクリプトを実行"""
    try:
        import subprocess
        script_path = os.path.join(os.path.dirname(__file__), 'tools', 'batch_ingest_videos.py')
        
        if not os.path.exists(script_path):
            return jsonify({
                'success': False,
                'error': '取り込みスクリプトが見つかりません'
            }), 404
        
        # サブプロセスで実行
        result = subprocess.run(
            [sys.executable, script_path],
            cwd=os.path.dirname(__file__),
            capture_output=True,
            text=True,
            encoding='utf-8'
        )
        
        # シナリオインデックスを再読み込み
        load_scenarios_index()
        
        # 結果を取得
        output = result.stdout
        error = result.stderr
        
        # 作成件数を抽出（簡易版）
        scenarios_created = 0
        rag_items = 0
        
        if '作成シナリオ数:' in output:
            match = re.search(r'作成シナリオ数:\s*(\d+)', output)
            if match:
                scenarios_created = int(match.group(1))
        
        if 'RAGアイテム数:' in output:
            match = re.search(r'RAGアイテム数:\s*(\d+)', output)
            if match:
                rag_items = int(match.group(1))
        
        return jsonify({
            'success': True,
            'scenarios_created': scenarios_created,
            'rag_items': rag_items,
            'output': output,
            'error': error
        })

    except FileNotFoundError as e:
        # スクリプトファイルまたは依存ファイルが見つからない
        logger.error(f"動画取り込み - ファイルが見つかりません: {e}")
        return jsonify({
            'success': False,
            'error': '必要なファイルが見つかりませんでした'
        }), 404
    except OSError as e:
        # サブプロセス実行エラー
        logger.error(f"動画取り込み - プロセス実行エラー: {e}")
        return jsonify({
            'success': False,
            'error': 'スクリプトの実行に失敗しました'
        }), 500
    except ValueError as e:
        # 数値変換エラー（出力解析時）
        logger.error(f"動画取り込み - 出力解析エラー: {e}")
        return jsonify({
            'success': False,
            'error': 'スクリプトの出力形式が不正です'
        }), 500
    except Exception as e:
        # 予期しないエラー
        logger.exception(f"動画取り込み - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': '動画取り込み処理中にエラーが発生しました'
        }), 500

# ===== Swagger UI エンドポイント =====
@app.route('/api/docs')
def api_docs():
    """Swagger UI for API documentation"""
    return '''
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>API Documentation - 営業ロープレシステム</title>
    <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
    <style>
        body { margin: 0; padding: 0; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            const ui = SwaggerUIBundle({
                url: '/api/openapi.yaml',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                layout: "StandaloneLayout"
            });
            window.ui = ui;
        };
    </script>
</body>
</html>
    '''

@app.route('/api/openapi.yaml')
def openapi_spec():
    """OpenAPI 3.0 specification file"""
    from flask import send_file
    import os
    spec_path = os.path.join(os.path.dirname(__file__), 'docs', 'openapi.yaml')
    return send_file(spec_path, mimetype='text/yaml')

# ===== セキュリティヘッダーの追加 =====
@app.after_request
def add_security_headers(response):
    """セキュリティヘッダーを追加してXSS、クリックジャッキング等を防止"""
    # HTTPS強制（本番環境）
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    # MIMEタイプスニッフィング防止
    response.headers['X-Content-Type-Options'] = 'nosniff'
    # クリックジャッキング防止
    response.headers['X-Frame-Options'] = 'DENY'
    # XSS保護
    response.headers['X-XSS-Protection'] = '1; mode=block'
    # Content Security Policy（段階的に強化）
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co https://api.openai.com https://cdn.jsdelivr.net https://storage.googleapis.com;"
    return response

# ===== 静的ファイルBlueprint（最後に登録 - キャッチオールルートのため） =====
app.register_blueprint(static_bp)
init_static_blueprint(app)


# ===== CSRFトークン取得エンドポイント =====
@app.route('/api/csrf-token', methods=['GET'])
def get_csrf_token():
    """
    CSRFトークンを取得

    認証済みユーザーの場合はユーザーIDと紐付け、
    未認証の場合は匿名トークンを発行
    """
    user_id = None

    # 認証ヘッダーからユーザーIDを取得
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        try:
            token = auth_header.replace('Bearer ', '')
            user_response = supabase_client.auth.get_user(token)
            if user_response and user_response.user:
                user_id = user_response.user.id
        except Exception as e:
            logger.debug(f"ユーザーID取得エラー（CSRFトークン発行）: {e}")

    # CSRFトークンを生成
    csrf_token = generate_csrf_token(user_id)

    return jsonify({
        'success': True,
        'csrf_token': csrf_token
    })


if __name__ == '__main__':
    import sys
    # 環境変数PORTを優先、次にコマンドライン引数、最後にデフォルト5001
    port = int(os.getenv('PORT', 5001))
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            logger.warning("無効なポート番号です。環境変数またはデフォルトを使用します。")

    logger.info(f"サーバーを起動中... ポート:{port}")
    app.run(debug=False, use_reloader=False, host='0.0.0.0', port=port)
