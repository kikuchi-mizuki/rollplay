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
import json
import re
import subprocess
import sys
from datetime import datetime
import base64
import io
import tempfile
from dotenv import load_dotenv
from shutil import which
from supabase import create_client, Client
from d_id_client import get_did_client, generate_cache_key, get_cached_video, save_video_to_cache, download_video_to_storage
from concurrent.futures import ThreadPoolExecutor, as_completed
from queue import Queue, Empty
import threading
from functools import wraps
import logging
from logging.handlers import RotatingFileHandler

# flask-corsのインポート（エラーハンドリング付き）
try:
    from flask_cors import CORS
    CORS_AVAILABLE = True
except ImportError as e:
    print(f"flask-corsインポートエラー: {e}")
    CORS_AVAILABLE = False
    CORS = None

# flask-limiterのインポート（レート制限用）
try:
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address
    LIMITER_AVAILABLE = True
    print("flask-limiter利用可能")
except ImportError as e:
    print(f"flask-limiterインポートエラー: {e}")
    LIMITER_AVAILABLE = False
    Limiter = None
    get_remote_address = None

# pydubのインポート（エラーハンドリング付き）
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
    print("pydub利用可能")
except ImportError as e:
    print(f"pydubインポートエラー: {e}")
    PYDUB_AVAILABLE = False
    AudioSegment = None

# yamlのインポート（エラーハンドリング付き）
try:
    import yaml
    YAML_AVAILABLE = True
    print("yaml利用可能")
except ImportError as e:
    print(f"yamlインポートエラー: {e}")
    YAML_AVAILABLE = False
    yaml = None

# FAISSとnumpyのインポート（RAG検索用）
try:
    import faiss
    import numpy as np
    FAISS_AVAILABLE = True
    print("FAISS利用可能")
except ImportError as e:
    print(f"FAISSインポートエラー: {e}")
    FAISS_AVAILABLE = False
    faiss = None
    np = None

# 環境変数を読み込み
load_dotenv()

# ===== ログ記録システムの設定 =====

# ロガーの設定
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

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
file_handler.setLevel(logging.INFO)

# コンソールハンドラー（開発用）
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)

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
logger.info("アプリケーション起動 - ログシステム初期化完了")
logger.info("=" * 80)

app = Flask(__name__)
if CORS_AVAILABLE and CORS:
    # CORS設定：開発環境と本番環境の両方に対応
    allowed_origins = [
        'http://localhost:3000',      # React開発環境
        'http://localhost:5173',      # Vite開発環境
        os.getenv('FRONTEND_URL', '')  # 本番環境フロントエンドURL
    ]
    # 空文字列を除外
    allowed_origins = [origin for origin in allowed_origins if origin]

    CORS(app, origins=allowed_origins if allowed_origins else '*')
    print(f"CORS有効化: {allowed_origins if allowed_origins else 'すべてのオリジン'}")

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
    logger.info("レート制限有効化: デフォルト 200回/日, 50回/時間")
else:
    logger.warning("flask-limiterが利用できません（レート制限は無効）")

# Supabase設定
supabase_url = os.getenv('VITE_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY')
supabase_client: Client = None

if supabase_url and supabase_key:
    try:
        supabase_client = create_client(supabase_url, supabase_key)
        logger.info("Supabase接続成功")
    except Exception as e:
        logger.error(f"Supabase接続エラー: {e}")
else:
    logger.warning("Supabase設定が見つかりません（データ永続化は無効）")

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
    print("警告: OPENAI_API_KEYが設定されていません")
    print("テストモードで実行します（モック応答を使用）")
    openai_client = None
else:
    try:
        os.environ['OPENAI_API_KEY'] = openai_api_key
        openai_client = OpenAI()  # 以降は必ずこのクライアントを使用
        print("OpenAIモジュールAPIを使用します")
    except Exception as e:
        print(f"OpenAIモジュールAPI初期化に失敗: {e}")
        openai_client = None

# Whisper統一版ではOpenAIのGPTモデルを使用
print("Whisper統一版: OpenAI GPT-4を使用")
print("音声認識: Whisper-1")
print("対話生成: GPT-4o-mini (max_tokens=1500)")

# ===== シナリオ読込（STEP4の先行準備：軽量Few-shot統合） =====
SCENARIO_DIR = os.path.join(os.path.dirname(__file__), 'scenarios')
SCENARIOS_INDEX_PATH = os.path.join(SCENARIO_DIR, 'index.json')
SCENARIOS_INDEX = {}
SCENARIO_CACHE = {}
DEFAULT_SCENARIO_ID = None

def load_scenarios_index():
    """`scenarios/index.json` を読み込み、有効なシナリオ一覧とデフォルトIDを保持する"""
    global SCENARIOS_INDEX, DEFAULT_SCENARIO_ID
    try:
        if not os.path.exists(SCENARIOS_INDEX_PATH):
            print(f"シナリオindexが見つかりません: {SCENARIOS_INDEX_PATH}")
            SCENARIOS_INDEX = {}
            DEFAULT_SCENARIO_ID = None
            return
        with open(SCENARIOS_INDEX_PATH, 'r', encoding='utf-8') as f:
            idx = json.load(f)
        DEFAULT_SCENARIO_ID = idx.get('default_id')
        entries = idx.get('scenarios', [])
        SCENARIOS_INDEX = {e['id']: os.path.join(SCENARIO_DIR, e['file']) for e in entries if e.get('enabled', True)}
        print(f"シナリオ読込: {len(SCENARIOS_INDEX)}件、default={DEFAULT_SCENARIO_ID}")
    except Exception as e:
        print(f"シナリオindex読込エラー: {e}")
        SCENARIOS_INDEX = {}
        DEFAULT_SCENARIO_ID = None

def load_scenario_object(scenario_id: str):
    """シナリオIDからJSONを読み込み、キャッシュして返す。存在しない場合はNone。"""
    if not scenario_id:
        return None
    if scenario_id in SCENARIO_CACHE:
        return SCENARIO_CACHE[scenario_id]
    path = SCENARIOS_INDEX.get(scenario_id)
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            obj = json.load(f)
        SCENARIO_CACHE[scenario_id] = obj
        return obj
    except Exception as e:
        print(f"シナリオ読込エラー({scenario_id}): {e}")
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
            print(f"Rubricファイルが見つかりません: {RUBRIC_PATH}")
            RUBRIC_DATA = None
            return
        if not YAML_AVAILABLE or not yaml:
            print("yamlモジュールが利用不可のため、Rubricを読み込めません")
            RUBRIC_DATA = None
            return
        with open(RUBRIC_PATH, 'r', encoding='utf-8') as f:
            RUBRIC_DATA = yaml.safe_load(f)
        print(f"Rubric読込完了: version={RUBRIC_DATA.get('version')}")
    except Exception as e:
        print(f"Rubric読込エラー: {e}")
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
            print(f"共有ペルソナファイルが見つかりません: {PERSONAS_PATH}")
            SHARED_PERSONAS = []
            return
        with open(PERSONAS_PATH, 'r', encoding='utf-8') as f:
            SHARED_PERSONAS = json.load(f)
        print(f"共有ペルソナ読込完了: {len(SHARED_PERSONAS)}パターン")
    except Exception as e:
        print(f"共有ペルソナ読込エラー: {e}")
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
        print("[ペルソナ選択] 共有ペルソナが読み込まれていません")
        return None

    # ランダムにペルソナを選択
    persona = random.choice(SHARED_PERSONAS)
    persona_id = persona.get('persona_id', '不明')
    persona_name = persona.get('persona_name', '不明')

    print(f"[ペルソナ選択] ランダム選択: {persona_name} (ID: {persona_id})")

    # シーンに応じた状況設定を取得
    base_profile = persona.get('base_profile', {})
    scene_variations = persona.get('scene_variations', {})

    # シーンIDに対応する状況設定を取得（デフォルトはmeeting_1st）
    scene_variation = scene_variations.get(scene_id, scene_variations.get('meeting_1st', {}))

    if not scene_variation:
        print(f"[ペルソナ選択] 警告: シーンID '{scene_id}' の状況設定が見つかりません")

    # ベースプロフィールとシーン状況を統合
    combined_persona = {
        'persona_id': persona_id,
        'persona_name': persona_name,
        **base_profile,
        **scene_variation
    }

    print(f"[ペルソナ選択] シーン: {scene_id}, 態度: {scene_variation.get('tone', '不明')}")

    return combined_persona

load_shared_personas()

# ===== Few-shot評価サンプル読込（Week 5：評価精度向上） =====
EVALUATION_SAMPLES_DIR = os.path.join(os.path.dirname(__file__), 'evaluation_samples')
EVALUATION_SAMPLES_CACHE = {}

def load_evaluation_samples(scenario_id: str):
    """シナリオIDに対応するFew-shot評価サンプルを読み込む"""
    global EVALUATION_SAMPLES_CACHE

    if not scenario_id:
        return None

    # キャッシュチェック
    if scenario_id in EVALUATION_SAMPLES_CACHE:
        return EVALUATION_SAMPLES_CACHE[scenario_id]

    # ファイルパスを構築
    samples_file = os.path.join(EVALUATION_SAMPLES_DIR, f"{scenario_id}_samples.json")

    if not os.path.exists(samples_file):
        print(f"評価サンプルファイルが見つかりません: {samples_file}")
        return None

    try:
        with open(samples_file, 'r', encoding='utf-8') as f:
            samples_data = json.load(f)
        EVALUATION_SAMPLES_CACHE[scenario_id] = samples_data
        print(f"評価サンプル読込完了: {scenario_id} ({len(samples_data.get('few_shot_examples', []))}件)")
        return samples_data
    except Exception as e:
        print(f"評価サンプル読込エラー({scenario_id}): {e}")
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
            print("FAISSが利用不可のため、RAG検索は無効です")
            RAG_INDEX = None
            RAG_METADATA = []
            return
        
        if not os.path.exists(RAG_INDEX_PATH) or not os.path.exists(RAG_METADATA_PATH):
            print(f"RAGインデックスが見つかりません: {RAG_INDEX_PATH}")
            RAG_INDEX = None
            RAG_METADATA = []
            return
        
        # FAISSインデックスを読み込み
        RAG_INDEX = faiss.read_index(RAG_INDEX_PATH)
        
        # メタデータを読み込み
        with open(RAG_METADATA_PATH, 'r', encoding='utf-8') as f:
            RAG_METADATA = json.load(f)
        
        print(f"RAGインデックス読込完了: {len(RAG_METADATA)}件のパターン")
    except Exception as e:
        print(f"RAGインデックス読込エラー: {e}")
        RAG_INDEX = None
        RAG_METADATA = []

load_rag_index()

# ffmpeg 存在チェック（pydub用）
FFMPEG_AVAILABLE = which('ffmpeg') is not None
if not FFMPEG_AVAILABLE:
    print("警告: ffmpeg が見つかりません。'brew install ffmpeg' などで導入してください")

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
                print(f"[RAG検索] シナリオ {scenario_id} のデータがありません。全データから検索します。")
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
        print(f"RAG検索エラー: {e}")
        return []

# 営業ロープレ用のプロンプト（顧客役として明確に指示）
SALES_ROLEPLAY_PROMPT = """あなたは【シナリオ設定】で指定された事業の経営者・マネージャーです。
営業担当との商談に臨んでいます。

## 役割

**あなたは顧客です。**
- 営業から提案を受ける立場
- 課題を抱えており、解決策を探している
- でも慎重で、すぐには決めない

## 会話の基本

**1. 応答の長さ:**
- 最初の挨拶: 5-10文字（「よろしくお願いします」など）
- 簡単な質問: 10-20文字
- 詳しく聞かれたら: 30-50文字

**2. 自然な話し方:**
- ChatGPTのように自然に応答
- フィラーを適度に使う（「えーと」「そうですね」「うーん」）
- 【シナリオ設定】のexample_dialoguesを参考に

**3. 段階的開示:**
- 最初から全て話さない
- 営業の質問に応じて徐々に情報を出す
- 良い質問をされたら、詳しく話す

## 実践的な顧客の反応

**典型的なパターン:**
- 懐疑的: 「本当に効果ありますか？」
- 予算を気にする: 「それって高くないですか？」
- 比較検討: 「他社と何が違うんですか？」
- 具体性を求める: 「具体的にどんな感じですか？」

**良い営業には:**
- 具体的な質問に答える
- 数字やデータを共有する
- 前向きに検討する姿勢を見せる

## 重要

✅ **必ず守る:**
- 【シナリオ設定】の内容に従う
- 過去の会話と一貫性を保つ
- 営業の質問に自然に反応

❌ **絶対にしない:**
- 営業のように質問する
- 自分の業種を変える
- 最初から全てを話す
"""

# ===== ヘルパー関数 =====

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
app.config['DEFAULT_SCENARIO_ID'] = DEFAULT_SCENARIO_ID
app.config['SALES_ROLEPLAY_PROMPT'] = SALES_ROLEPLAY_PROMPT
app.config['load_scenario_object'] = load_scenario_object
app.config['select_random_persona_for_scene'] = select_random_persona_for_scene
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
        global SCENARIO_CACHE
        cache_size = len(SCENARIO_CACHE)
        SCENARIO_CACHE.clear()
        logger.info(f"シナリオキャッシュをクリアしました（{cache_size}件）")
        return jsonify({
            'success': True,
            'message': f'キャッシュをクリアしました（{cache_size}件）'
        })
    except KeyError as e:
        # キャッシュキーエラー（通常は発生しない）
        logger.error(f"キャッシュクリア - キーエラー: {e}")
        return jsonify({
            'success': False,
            'error': 'キャッシュの操作中にエラーが発生しました'
        }), 500
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

# ===== 静的ファイルBlueprint（最後に登録 - キャッチオールルートのため） =====
app.register_blueprint(static_bp)
init_static_blueprint(app)


if __name__ == '__main__':
    import sys
    # 環境変数PORTを優先、次にコマンドライン引数、最後にデフォルト5001
    port = int(os.getenv('PORT', 5001))
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("無効なポート番号です。環境変数またはデフォルトを使用します。")

    print(f"サーバーを起動中... ポート:{port}")
    app.run(debug=False, use_reloader=False, host='0.0.0.0', port=port)
