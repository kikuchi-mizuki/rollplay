from flask import Flask, request, jsonify, render_template, Response
from openai import OpenAI  # 新SDKクライアントを統一利用
import os
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

# flask-corsのインポート（エラーハンドリング付き）
try:
    from flask_cors import CORS
    CORS_AVAILABLE = True
except ImportError as e:
    print(f"flask-corsインポートエラー: {e}")
    CORS_AVAILABLE = False
    CORS = None

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

# Supabase設定
supabase_url = os.getenv('VITE_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY')
supabase_client: Client = None

if supabase_url and supabase_key:
    try:
        supabase_client = create_client(supabase_url, supabase_key)
        print("Supabase接続成功")
    except Exception as e:
        print(f"Supabase接続エラー: {e}")
else:
    print("警告: Supabase設定が見つかりません（データ永続化は無効）")

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
print("対話生成: GPT-4")

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
SALES_ROLEPLAY_PROMPT = """
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【絶対に守ること】
あなたは「顧客（悩みを持った事業主）」です。
あなたは「営業担当」ではありません。

✗ 営業のように質問してはいけません
✓ 顧客として悩みを話してください
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

あなたは、SNS動画制作会社の無料相談に来た事業主です。今、営業担当と初めて会っています。

## あなた自身について

SNS運用で本当に悩んでいます。毎日投稿してもフォロワーは増えず、「いいね」も伸びない。同業他社が動画で成功している話を聞くたびに焦りを感じています。

正直、SNSや動画制作のことはよく分かりません。でも、このままじゃダメだとは思っています。予算も限られているし、以前高額なサービスで失敗した経験もあって、慎重になっています。

## 今のあなたの気持ち

初対面の営業担当には、少し警戒心があります。でも、本気で悩んでいるので、良い質問をしてくれたり、共感してくれたりすると、心を開いて詳しく話したくなります。

自分の事業のことや、SNS運用の苦労話は、聞かれると饒舌に語ってしまいます。「実は去年も...」「正直、かなり焦ってて...」など、本音が出やすいです。

## 応答ルール

**営業に質問されたら、必ず具体的な悩みや状況を話してください。**

- 挨拶や定型文だけで終わらない
- 具体的な数字（フォロワー数、いいね数など）を含める
- 感情を表現する（「困ってて」「焦ってます」など）
- 3-5文で詳しく答える（50-150文字程度）

## 会話の自然な流れ

営業が何を聞いてくるかで、あなたの返答も変わります：
- 「どんな悩みですか？」→ SNS運用の具体的な課題を詳しく話す
- 「どれくらい投稿してます？」→ 投稿頻度や反応率を数字で答える
- 相槌だけ → 自然に続きを話す
- 共感される → もっと詳しく話したくなる

---

**会話例（必ず悩みを話す）:**

営業: 今日はどんなことでお悩みですか？
あなた: 実はInstagramとTikTokやってるんですけど、全然伸びなくて...週2-3回は投稿してるんですけど「いいね」が20-30くらいしか付かないんですよ。フォロワーも1,200人くらいで止まっちゃってて。他のサロンさんがリール動画でバズってるの見ると、うちも何とかしないとって正直焦ってます。

営業: なるほど。
あなた: そうなんです。TikTokも一応やってるんですけど、何投稿すればいいか分からなくて...スタッフに任せてるんですけど、全然再生されないんですよ。

営業: 予算はどれくらいお考えですか？
あなた: 月3-5万円くらいかなって思ってます。実は去年、広告代理店に相談したら月10万円って言われて断念したんです。今回は、もう少し現実的な予算で効果出したいなって。

---

**絶対に守ること:**
- あなたは「顧客」であり、「営業」ではありません
- 質問されたら、必ず具体的な悩みや状況を話してください
- 挨拶だけで終わらず、必ず内容のある返答をしてください
"""

@app.route('/')
def index():
    """Reactアプリを配信（distディレクトリが存在する場合）"""
    dist_path = os.path.join(os.path.dirname(__file__), 'dist', 'index.html')
    if os.path.exists(dist_path):
        with open(dist_path, 'r', encoding='utf-8') as f:
            return f.read()
    # フォールバック: 従来のHTMLテンプレート
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    try:
        from flask import send_from_directory
        static_dir = os.path.join(app.root_path, 'static')
        icon_file = 'favicon.ico'
        icon_path = os.path.join(static_dir, icon_file)
        if os.path.exists(icon_path):
            return send_from_directory(static_dir, icon_file)
        # アイコンが無い場合は 204 で黙って返す（コンソールエラー回避）
        return ('', 204)
    except Exception:
        return ('', 204)

# 一部ブラウザ/キャッシュが /static/favicon.ico を参照する場合のフォールバック
@app.route('/static/favicon.ico')
def static_favicon_fallback():
    return ('', 204)

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

@app.route('/api/scenarios', methods=['GET'])
def get_scenarios():
    """シナリオ一覧を取得"""
    try:
        with open(SCENARIOS_INDEX_PATH, 'r', encoding='utf-8') as f:
            idx = json.load(f)
        return jsonify({
            'success': True,
            'scenarios': idx.get('scenarios', []),
            'default_id': idx.get('default_id')
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/scenarios/<scenario_id>', methods=['GET'])
def get_scenario(scenario_id):
    """シナリオ詳細を取得"""
    try:
        scenario_obj = load_scenario_object(scenario_id)
        if not scenario_obj:
            return jsonify({
                'success': False,
                'error': f'シナリオが見つかりません: {scenario_id}'
            }), 404
        return jsonify({
            'success': True,
            'scenario': scenario_obj
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        conversation_history = data.get('history', [])
        scenario_id = data.get('scenario_id') or DEFAULT_SCENARIO_ID
        scenario_obj = load_scenario_object(scenario_id)
        
        # Whisper統一版: GPT-4を使用して対話生成
        if openai_api_key and openai_client:
            try:
                # 会話履歴を構築
                system_prompt = SALES_ROLEPLAY_PROMPT
                # シナリオのpersona/guidelinesをsystem補強
                if scenario_obj:
                    # persona_variationsがある場合はランダムに選択
                    if 'persona_variations' in scenario_obj and scenario_obj['persona_variations']:
                        import random
                        persona = random.choice(scenario_obj['persona_variations'])
                        print(f"[ペルソナ選択] {persona.get('variation_name', '不明')} を選択しました")
                    else:
                        persona = scenario_obj.get('persona') or {}
                    guidelines = scenario_obj.get('guidelines') or []
                    persona_txt = []

                    # 顧客役の詳細情報を追加
                    if 'customer_role' in persona:
                        persona_txt.append(f"顧客役: {persona['customer_role']}")
                    if 'business_detail' in persona:
                        persona_txt.append(f"事業詳細: {persona['business_detail']}")
                    if 'tone' in persona:
                        persona_txt.append(f"トーン・態度: {persona['tone']}")
                    if 'knowledge_level' in persona:
                        persona_txt.append(f"知識レベル: {persona['knowledge_level']}")

                    # SNS運用状況の詳細を追加
                    if 'current_sns_status' in persona:
                        sns_status = persona['current_sns_status']
                        if isinstance(sns_status, dict):
                            persona_txt.append("現在のSNS運用状況:")
                            if 'instagram' in sns_status:
                                persona_txt.append(f"  - Instagram: {sns_status['instagram']}")
                            if 'tiktok' in sns_status:
                                persona_txt.append(f"  - TikTok: {sns_status['tiktok']}")
                            if 'challenges' in sns_status:
                                challenges = sns_status['challenges']
                                if challenges:
                                    persona_txt.append("  - 具体的な課題: " + "、".join(challenges[:3]))  # 最初の3つ

                    # 予算感を追加
                    if 'budget_sense' in persona:
                        persona_txt.append(f"予算感: {persona['budget_sense']}")

                    if persona_txt:
                        system_prompt += "\n\n【シナリオ設定】\n- " + "\n- ".join(persona_txt)
                    if guidelines:
                        system_prompt += "\n\n【返答ガイドライン】\n- " + "\n- ".join(guidelines)

                messages = [{"role": "system", "content": system_prompt}]
                
                # 会話履歴を追加
                for msg in conversation_history[-10:]:  # 最新10件まで
                    if msg['speaker'] == '営業':
                        messages.append({"role": "user", "content": msg['text']})
                    elif msg['speaker'] == '顧客':
                        messages.append({"role": "assistant", "content": msg['text']})

                # RAG検索（過去の音声データから類似パターンを検索）
                rag_context = ""
                if RAG_INDEX and RAG_METADATA and len(RAG_METADATA) > 0:
                    try:
                        # 営業の発言と直近の会話履歴から検索クエリを構築
                        # 直近2-3往復の会話も含めて検索精度を向上
                        search_query = user_message
                        if conversation_history:
                            recent_context = " ".join([msg.get('text', '') for msg in conversation_history[-4:]])
                            if recent_context:
                                search_query = f"{recent_context} {user_message}"
                        
                        # 類似パターンを検索（シナリオIDでフィルタリング）
                        rag_results = search_rag_patterns(search_query, top_k=3, scenario_id=scenario_id)
                        if rag_results:
                            rag_patterns = []
                            for result in rag_results:
                                pattern_text = result.get('text', '')
                                pattern_type = result.get('type', '')
                                if pattern_text:
                                    # パターンタイプに応じた説明を追加
                                    type_label = {
                                        'good_question': '良い質問例',
                                        'objection_handling': '異論処理例',
                                        'closing': 'クロージング例'
                                    }.get(pattern_type, '実例')
                                    rag_patterns.append(f"- [{type_label}] {pattern_text}")
                            
                            if rag_patterns:
                                rag_context = "\n\n【過去の実例パターン（参考）】\n以下のような実際の会話パターンを参考に、自然でリアルな応答をしてください：\n" + "\n".join(rag_patterns)
                                # system_promptに追加
                                system_prompt += rag_context
                                messages[0] = {"role": "system", "content": system_prompt}
                                print(f"[RAG検索] {len(rag_results)}件の類似パターンを検出")
                            else:
                                print("[RAG検索] 類似パターンが見つかりませんでした")
                    except Exception as e:
                        print(f"RAG検索エラー（フォールバック）: {e}")
                        import traceback
                        traceback.print_exc()
                        # RAG検索に失敗しても続行（通常の応答生成にフォールバック）
                
                # few-shot（シナリオのutterancesを先頭に織り込む）
                if scenario_obj:
                    few = scenario_obj.get('utterances') or []
                    # 過剰にならないよう最大4往復（8発話）
                    for u in few[:8]:
                        sp = u.get('speaker')
                        tx = u.get('text', '')
                        if not tx:
                            continue
                        if sp == '営業':
                            messages.append({"role": "user", "content": tx})
                        elif sp == 'お客様':
                            messages.append({"role": "assistant", "content": tx})
                
                # 現在の営業の発言を追加
                messages.append({"role": "user", "content": user_message})
                
                # GPT応答生成（新SDK）
                response = openai_client.chat.completions.create(
                    model="gpt-4o",         # 最新モデル（高速・高品質）
                    messages=messages,
                    max_tokens=300,         # 詳細な応答を可能にする
                    temperature=0.85        # プロンプト遵守と自然さのバランス
                )
                ai_response = response.choices[0].message.content.strip()
                
            except Exception as e:
                print(f"GPT-4 API エラー: {e}")
                # フォールバック: モック応答
                ai_response = get_mock_response(user_message)
        else:
            # テストモード: モック応答
            ai_response = get_mock_response(user_message)

        return jsonify({
            'success': True,
            'response': ai_response,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/chat-stream', methods=['POST'])
def chat_stream():
    """
    ストリーミング対応のチャットエンドポイント
    GPT応答を即座に生成・TTS・送信してリアルタイム性を向上
    """
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        conversation_history = data.get('history', [])
        scenario_id = data.get('scenario_id') or DEFAULT_SCENARIO_ID
        scenario_obj = load_scenario_object(scenario_id)

        def generate():
            """SSE (Server-Sent Events) でストリーミング送信"""
            try:
                if not openai_api_key or not openai_client:
                    yield f"data: {json.dumps({'error': 'OpenAI API未設定'})}\n\n"
                    return

                # システムプロンプト構築（既存ロジックと同じ）
                system_prompt = SALES_ROLEPLAY_PROMPT
                if scenario_obj:
                    persona = scenario_obj.get('persona') or {}
                    # persona_variationsがある場合はランダムに選択
                    if 'persona_variations' in scenario_obj and scenario_obj['persona_variations']:
                        import random
                        persona = random.choice(scenario_obj['persona_variations'])
                        print(f"[ペルソナ選択] {persona.get('variation_name', '不明')} を選択しました")

                    guidelines = scenario_obj.get('guidelines') or []
                    persona_txt = []

                    # ペルソナ情報をシステムプロンプトに追加
                    if 'customer_role' in persona:
                        persona_txt.append(f"顧客役: {persona['customer_role']}")
                    if 'business_detail' in persona:
                        persona_txt.append(f"事業詳細: {persona['business_detail']}")
                    if 'tone' in persona:
                        persona_txt.append(f"トーン・態度: {persona['tone']}")
                    if 'knowledge_level' in persona:
                        persona_txt.append(f"知識レベル: {persona['knowledge_level']}")
                    if 'current_sns_status' in persona:
                        sns_status = persona['current_sns_status']
                        if isinstance(sns_status, dict):
                            persona_txt.append("現在のSNS運用状況:")
                            if 'instagram' in sns_status:
                                persona_txt.append(f"  - Instagram: {sns_status['instagram']}")
                            if 'tiktok' in sns_status:
                                persona_txt.append(f"  - TikTok: {sns_status['tiktok']}")
                            if 'challenges' in sns_status:
                                challenges = sns_status['challenges']
                                if challenges:
                                    persona_txt.append("  - 具体的な課題: " + "、".join(challenges[:3]))
                    if 'budget_sense' in persona:
                        persona_txt.append(f"予算感: {persona['budget_sense']}")

                    if persona_txt:
                        system_prompt += "\n\n【シナリオ設定】\n- " + "\n- ".join(persona_txt)
                    if guidelines:
                        system_prompt += "\n\n【返答ガイドライン】\n- " + "\n- ".join(guidelines)

                # メッセージ履歴構築
                messages = [{"role": "system", "content": system_prompt}]
                for msg in conversation_history[-10:]:
                    if msg['speaker'] == '営業':
                        messages.append({"role": "user", "content": msg['text']})
                    elif msg['speaker'] == '顧客':
                        messages.append({"role": "assistant", "content": msg['text']})

                messages.append({"role": "user", "content": user_message})

                # GPT-4oストリーミング応答
                print("[ストリーミング] GPT-4o応答生成開始")
                response = openai_client.chat.completions.create(
                    model="gpt-4o",
                    messages=messages,
                    max_tokens=300,         # 詳細な応答を可能にする
                    temperature=0.85,       # プロンプト遵守と自然さのバランス
                    stream=True  # ストリーミング有効化
                )

                # チャンクバッファ
                text_buffer = ""
                chunk_count = 0

                # ストリーミングレスポンスを処理
                for chunk in response:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        text_buffer += content

                        # 句点「。」で文を分割（自然な音声のため）
                        # 読点での分割は削除（ぶつ切り防止）
                        should_send = False
                        delimiter = ''

                        if '。' in text_buffer:
                            should_send = True
                            delimiter = '。'
                        elif len(text_buffer) >= 40:  # 長すぎる場合のみ分割
                            should_send = True
                            delimiter = None

                        if should_send:
                            if delimiter:
                                chunks = text_buffer.split(delimiter)
                                # 最後の要素（未完成の文）を除いて処理
                                for part in chunks[:-1]:
                                    if part.strip():
                                        chunk_text = part.strip() + delimiter
                                        chunk_count += 1
                                        print(f"[チャンク{chunk_count}] {chunk_text}")

                                        # TTS生成
                                        try:
                                            tts_response = openai_client.audio.speech.create(
                                                model="tts-1-hd",
                                                voice="nova",
                                                input=chunk_text,
                                                speed=1.15  # 自然な会話速度（1.3は早すぎ）
                                            )
                                            audio_data = tts_response.content
                                            audio_base64 = base64.b64encode(audio_data).decode('utf-8')

                                            # SSEで音声データを送信
                                            yield f"data: {json.dumps({'audio': audio_base64, 'text': chunk_text, 'chunk': chunk_count})}\n\n"
                                        except Exception as tts_error:
                                            print(f"[TTS エラー] {tts_error}")

                                # 未完成の文をバッファに残す
                                text_buffer = chunks[-1]
                            else:
                                # 読点がない場合、20文字で強制送信
                                chunk_text = text_buffer.strip()
                                chunk_count += 1
                                print(f"[チャンク{chunk_count}] {chunk_text}")

                                try:
                                    tts_response = openai_client.audio.speech.create(
                                        model="tts-1-hd",
                                        voice="nova",
                                        input=chunk_text,
                                        speed=1.15  # 自然な会話速度（1.3は早すぎ）
                                    )
                                    audio_data = tts_response.content
                                    audio_base64 = base64.b64encode(audio_data).decode('utf-8')
                                    yield f"data: {json.dumps({'audio': audio_base64, 'text': chunk_text, 'chunk': chunk_count})}\n\n"
                                except Exception as tts_error:
                                    print(f"[TTS エラー] {tts_error}")

                                text_buffer = ""

                # 残りのテキストを処理
                if text_buffer.strip():
                    chunk_count += 1
                    print(f"[最終チャンク{chunk_count}] {text_buffer}")
                    try:
                        tts_response = openai_client.audio.speech.create(
                            model="tts-1-hd",
                            voice="nova",
                            input=text_buffer.strip(),
                            speed=1.15  # 自然な会話速度（1.3は早すぎ）
                        )
                        audio_data = tts_response.content
                        audio_base64 = base64.b64encode(audio_data).decode('utf-8')
                        yield f"data: {json.dumps({'audio': audio_base64, 'text': text_buffer.strip(), 'chunk': chunk_count, 'final': True})}\n\n"
                    except Exception as tts_error:
                        print(f"[最終TTS エラー] {tts_error}")

                print(f"[ストリーミング完了] 合計{chunk_count}チャンク送信")

            except Exception as e:
                import traceback
                traceback.print_exc()
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return Response(generate(), mimetype='text/event-stream', headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


def get_mock_response(user_message):
    """モック応答を生成"""
    mock_responses = [
        "こんにちは！お忙しい中お時間をいただき、ありがとうございます。どのようなご相談でしょうか？",
        "なるほど、興味深いですね。詳しく教えていただけますか？",
        "確かにその通りですね。他にも気になる点はございますか？",
        "とても良い提案だと思います。具体的にはどのような内容でしょうか？",
        "それは素晴らしいですね。ぜひ検討させていただきます。"
    ]
    
    if "こんにちは" in user_message or "はじめまして" in user_message:
        return mock_responses[0]
    elif "質問" in user_message or "教えて" in user_message:
        return mock_responses[1]
    elif "提案" in user_message or "サービス" in user_message:
        return mock_responses[3]
    else:
        return mock_responses[1]

@app.route('/api/tts', methods=['POST'])
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
            model="tts-1-hd",  # 高品質モデル（より自然な発音）
            voice=voice,       # アバターに応じた音声（alloy, echo, fable, onyx, nova, shimmer）
            input=text,
            speed=1.3          # リアルな営業ロープレのペース（1-2秒で返答開始）
        )

        # 音声データを返す
        audio_data = response.content
        return Response(audio_data, mimetype='audio/mpeg')

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(success=False, error=str(e)), 500


@app.route('/api/did-video', methods=['POST'])
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
        print(f"🎬 Generating D-ID video for text: {text[:50]}...")
        result = did_client.create_talk_from_text(
            text=text,
            voice_id=voice_id,
            source_url=avatar_url
        )

        talk_id = result.get('id')
        print(f"📝 D-ID talk created: {talk_id}")

        # 完了を待機（最大120秒）
        did_video_url = did_client.wait_for_completion(talk_id, timeout=120)

        if did_video_url:
            print(f"✅ D-ID video ready: {did_video_url}")

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


@app.route('/api/transcribe', methods=['POST'])
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
        print(f"[upload] mime={up.mimetype} saved={new_path} size={size}")
        if size < 2048:
            try: os.remove(new_path)
            except Exception: pass
            return jsonify(success=False, error='録音データが小さすぎます(2KB未満)'), 400
        # Whisperへ（まず直送）
        if not openai_client:
            return jsonify(success=False, error='OpenAIクライアント未初期化'), 500
        try:
            with open(new_path, 'rb') as f:
                r = openai_client.audio.transcriptions.create(
                    model='whisper-1',
                    file=f,
                    language='ja'
                )
            text = (getattr(r, 'text', '') or '').strip()
            return jsonify(success=True, text=text, method='whisper', timestamp=datetime.now().isoformat())
        except Exception as e:
            print(f"[direct whisper failed] {e}")
            if not (PYDUB_AVAILABLE and FFMPEG_AVAILABLE):
                raise
            wav_path = new_path + '.wav'
            AudioSegment.from_file(new_path).set_frame_rate(16000).set_channels(1).export(wav_path, format='wav')
            try:
                with open(wav_path, 'rb') as f:
                    r = openai_client.audio.transcriptions.create(
                        model='whisper-1',
                        file=f,
                        language='ja'
                    )
                text = (getattr(r, 'text', '') or '').strip()
                return jsonify(success=True, text=text, method='whisper', timestamp=datetime.now().isoformat())
            finally:
                try: os.remove(wav_path)
                except Exception: pass
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify(success=False, error=str(e)), 500
    finally:
        try:
            if 'new_path' in locals() and new_path and os.path.exists(new_path):
                os.remove(new_path)
        except Exception:
            pass

def transcribe_with_whisper(audio_bytes):
    """Whisper APIを使用した音声認識"""
    try:
        print(f"音声データサイズ: {len(audio_bytes)} bytes")
        
        # 音声データを一時ファイルに保存
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
            temp_file.write(audio_bytes)
            temp_file_path = temp_file.name
        
        print(f"一時ファイル作成: {temp_file_path}")
        
        try:
            # pydubが利用可能かチェック
            if not PYDUB_AVAILABLE:
                raise Exception("pydubが利用できません。ffmpegのインストールを確認してください。")
            
            # 音声ファイルを読み込み、MP3に変換（Whisperの推奨形式）
            print("音声ファイル変換開始...")
            audio = AudioSegment.from_wav(temp_file_path)
            mp3_path = temp_file_path.replace('.wav', '.mp3')
            audio.export(mp3_path, format="mp3")
            print(f"MP3変換完了: {mp3_path}")
            
            # OpenAIクライアントの確認
            if not openai_client:
                raise Exception("OpenAIクライアントが初期化されていません")
            
            print("Whisper API呼び出し開始...")
            # Whisper APIで音声認識（新しいAPI形式）
            with open(mp3_path, 'rb') as audio_file:
                transcript = openai_client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    language="ja"  # 日本語指定
                )
            
            transcribed_text = transcript.text.strip()
            print(f"音声認識結果: {transcribed_text}")
            
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
                    print(f"一時ファイル削除: {file_path}")
                    
    except Exception as e:
        print(f"Whisper音声認識エラー詳細: {str(e)}")
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
        print(f"音声ファイル処理開始: {input_file_path}")
        size = os.path.getsize(input_file_path)
        print(f"受信サイズ: {size} bytes")
        if size < 2048:
            raise Exception("録音データが小さすぎます（2KB未満）")

        if not openai_client:
            raise Exception("OpenAIクライアントが初期化されていません")

        # 1) まずはそのままWhisperへ
        try:
            print("Whisperへ直接送信...")
            with open(input_file_path, 'rb') as f:
                transcript = openai_client.audio.transcriptions.create(
                    model="whisper-1",
                    file=f,
                    language="ja"
                )
        except Exception as direct_err:
            print(f"直接送信失敗: {direct_err}")
            if not PYDUB_AVAILABLE or not FFMPEG_AVAILABLE:
                raise
            print("pydubでWAV(16k,mono)へ変換して再送...")
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
        print(f"音声認識結果: {text}")
        return jsonify({'success': True, 'text': text, 'method': 'whisper', 'timestamp': datetime.now().isoformat()})

    except Exception as e:
        print(f"Whisper音声認識エラー詳細: {str(e)}")
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': f'Whisper音声認識エラー: {str(e)}'}), 500
    finally:
        # 一時ファイルを削除
        for file_path in [input_file_path, mp3_path] if 'mp3_path' in locals() else [input_file_path]:
            if file_path and os.path.exists(file_path):
                try:
                    os.unlink(file_path)
                    print(f"一時ファイル削除: {file_path}")
                except Exception:
                    pass

# Gemini音声認識関数は削除（Whisper統一版のため）

@app.route('/api/evaluate', methods=['POST'])
def evaluate_conversation():
    try:
        data = request.get_json()
        conversation = data.get('conversation', [])
        scenario_id = data.get('scenario_id')  # シナリオIDを取得

        # 営業の発言のみを抽出
        sales_utterances = [msg['text'] for msg in conversation if msg['speaker'] == '営業']

        if not sales_utterances:
            return jsonify({
                'success': False,
                'error': '営業の発言が見つかりません'
            }), 400

        # 講評生成（Week 5改善版: シナリオ別Few-shot対応）
        evaluation = generate_evaluation_with_gpt4(sales_utterances, scenario_id)

        return jsonify({
            'success': True,
            'evaluation': evaluation,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def generate_evaluation_with_gpt4(sales_utterances, scenario_id=None):
    """GPT-4を使用した営業スキル評価（Week 5改善版: シナリオ別Few-shot対応）"""
    try:
        # 営業の発言を結合
        sales_text = " ".join(sales_utterances)

        # シナリオ情報とFew-shotサンプルを読み込む
        scenario_context = ""
        few_shot_examples = ""

        if scenario_id:
            # シナリオ情報を読み込む
            scenario_obj = load_scenario_object(scenario_id)
            if scenario_obj:
                scenario_title = scenario_obj.get('title', '')
                scenario_context = f"\n【シナリオ】: {scenario_title}\n"
                scenario_context += f"【シナリオの重点評価項目】:\n"
                persona = scenario_obj.get('persona', {})
                if persona:
                    scenario_context += f"- 相談者の状態: {persona.get('tone', '')} ({persona.get('relationship', '')})\n"

            # Few-shotサンプルを読み込む
            samples_data = load_evaluation_samples(scenario_id)
            if samples_data:
                eval_focus = samples_data.get('evaluation_focus', [])
                if eval_focus:
                    scenario_context += "- 評価の重点: " + ", ".join(eval_focus) + "\n"

                # Few-shotサンプルを構築（良い例1件、悪い例1件）
                examples = samples_data.get('few_shot_examples', [])
                good_examples = [ex for ex in examples if ex.get('quality') == 'good']
                poor_examples = [ex for ex in examples if ex.get('quality') == 'poor']

                if good_examples:
                    good_ex = good_examples[0]  # 最初の良い例を使用
                    few_shot_examples += "\n【評価サンプル1：良い例】\n"
                    few_shot_examples += "営業の発言: " + " → ".join(good_ex['conversation'][::2][:3]) + "...\n"
                    few_shot_examples += f"評価スコア: 質問力={good_ex['evaluation']['scores']['questioning_skill']}, "
                    few_shot_examples += f"傾聴力={good_ex['evaluation']['scores']['listening_skill']}, "
                    few_shot_examples += f"提案力={good_ex['evaluation']['scores']['proposal_skill']}, "
                    few_shot_examples += f"クロージング={good_ex['evaluation']['scores']['closing_skill']}\n"
                    few_shot_examples += f"評価理由: {good_ex['evaluation']['strengths'][0]}\n"

                if poor_examples:
                    poor_ex = poor_examples[0]  # 最初の悪い例を使用
                    few_shot_examples += "\n【評価サンプル2：改善が必要な例】\n"
                    few_shot_examples += "営業の発言: " + " → ".join(poor_ex['conversation'][::2][:3]) + "...\n"
                    few_shot_examples += f"評価スコア: 質問力={poor_ex['evaluation']['scores']['questioning_skill']}, "
                    few_shot_examples += f"傾聴力={poor_ex['evaluation']['scores']['listening_skill']}, "
                    few_shot_examples += f"提案力={poor_ex['evaluation']['scores']['proposal_skill']}, "
                    few_shot_examples += f"クロージング={poor_ex['evaluation']['scores']['closing_skill']}\n"
                    few_shot_examples += f"評価理由: {poor_ex['evaluation']['improvements'][0]}\n"

        # Rubricから評価基準を構築
        rubric_description = ""
        if RUBRIC_DATA and 'evaluation_criteria' in RUBRIC_DATA:
            criteria_list = []
            for criterion in RUBRIC_DATA['evaluation_criteria']:
                name = criterion.get('name', '')
                desc = criterion.get('description', '')
                criteria_list.append(f"- {name}: {desc}")
            rubric_description = "\n".join(criteria_list)
        else:
            # フォールバック: 簡易版
            rubric_description = """- 質問力: 顧客のニーズ・課題を適切に引き出す質問
- 傾聴力: 相手の発言を理解し、適切に受容・共感
- 提案力: 顧客の課題に対する具体的な解決策を提示
- クロージング力: 次のアクション・決定を促す適切なクロージング"""

        # GPT-4で評価を生成（Few-shot対応）
        evaluation_prompt = f"""
        あなたはSNS動画制作営業のスキル評価の専門家です。以下の営業の発言を分析して、営業スキルを詳細に評価してください。
        {scenario_context}
        【営業の発言】
        {sales_text}

        【評価項目】（5点満点で評価）
        {rubric_description}
        {few_shot_examples}

        上記のサンプルを参考に、以下のJSON形式で評価を出力してください：
        {{
            "scores": {{
                "questioning": 数値,
                "listening": 数値,
                "proposing": 数値,
                "closing": 数値,
                "total": 数値
            }},
            "comments": ["コメント1", "コメント2", ...],
            "overall_comment": "総合評価コメント",
            "improvement_suggestions": ["改善提案1", "改善提案2", ...],
            "analysis": {{
                "questions_count": 数値,
                "listening_responses_count": 数値,
                "proposals_count": 数値,
                "closings_count": 数値,
                "conversation_flow": "会話段階"
            }}
        }}
        """
        
        response = openai_client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "あなたは営業スキルの専門家です。営業の発言を分析して詳細な評価を提供してください。"},
                {"role": "user", "content": evaluation_prompt}
            ],
            max_tokens=1000,
            temperature=0.3
        )
        
        # JSONレスポンスを解析
        evaluation_text = response.choices[0].message.content.strip()
        
        # JSONの開始と終了を検索
        start_idx = evaluation_text.find('{')
        end_idx = evaluation_text.rfind('}') + 1
        
        if start_idx != -1 and end_idx != -1:
            json_text = evaluation_text[start_idx:end_idx]
            evaluation = json.loads(json_text)
            
            # 基本情報を追加
            evaluation['total_utterances'] = len(sales_utterances)
            
            return evaluation
        else:
            # JSON解析に失敗した場合はフォールバック
            return generate_evaluation_fallback(sales_utterances)
            
    except Exception as e:
        print(f"GPT-4評価エラー: {e}")
        # フォールバック: 従来の評価ロジック
        return generate_evaluation_fallback(sales_utterances)

def generate_evaluation_fallback(sales_utterances):
    """フォールバック用の評価生成（従来のロジック）"""
    
    # 基本的な評価ロジック
    total_utterances = len(sales_utterances)
    
    # 質問力の評価（より詳細な分析）
    question_words = ['何', 'どの', 'なぜ', 'どうして', 'いつ', 'どこ', '誰', 'いくつ', 'いくら', 'どのように', 'なぜ', 'どうやって']
    open_questions = ['どのように', 'なぜ', 'どうして', 'どのような']
    questions = [utterance for utterance in sales_utterances 
                if any(word in utterance for word in question_words)]
    open_questions_count = len([utterance for utterance in sales_utterances 
                               if any(word in utterance for word in open_questions)])
    
    questioning_score = min(5, (len(questions) * 1.5) + (open_questions_count * 0.5))
    
    # 傾聴力の評価（より多様な表現を検出）
    listening_words = ['そうですね', 'なるほど', '確かに', 'おっしゃる通り', '理解しました', '承知いたしました', 
                      'お聞かせください', '詳しく教えてください', '興味深いですね', 'それは大変ですね']
    listening_responses = [utterance for utterance in sales_utterances 
                          if any(word in utterance for word in listening_words)]
    listening_score = min(5, len(listening_responses) * 1.5)
    
    # 提案力の評価（より具体的な提案表現）
    proposal_words = ['提案', 'おすすめ', '解決', '改善', 'サービス', 'プラン', '案', '方法', 'ソリューション', 
                     'お手伝い', 'サポート', 'ご提供', 'ご案内']
    proposals = [utterance for utterance in sales_utterances 
                if any(word in utterance for word in proposal_words)]
    proposing_score = min(5, len(proposals) * 1.5)
    
    # クロージング力の評価（より多様なクロージング表現）
    closing_words = ['いかがでしょうか', '検討', 'お時間', 'ご連絡', '次回', '後日', 'ご検討', 'お考え', 
                    'お決め', 'お返事', 'ご返答', 'お待ち', 'お聞かせ']
    closings = [utterance for utterance in sales_utterances 
               if any(word in utterance for word in closing_words)]
    closing_score = min(5, len(closings) * 1.5)
    
    # 感情分析（簡易版）
    positive_words = ['ありがとう', '感謝', '嬉しい', '素晴らしい', '良い', '助かります', '心強い']
    negative_words = ['困って', '大変', '難しい', '問題', '課題', '悩み']
    
    positive_count = len([utterance for utterance in sales_utterances 
                         if any(word in utterance for word in positive_words)])
    negative_count = len([utterance for utterance in sales_utterances 
                         if any(word in utterance for word in negative_words)])
    
    # 会話の流れ分析
    conversation_flow = analyze_conversation_flow(sales_utterances)
    
    # 総合スコア（重み付け）
    total_score = (questioning_score * 0.25 + listening_score * 0.25 + 
                  proposing_score * 0.3 + closing_score * 0.2)
    
    # 高度な評価コメント生成
    comments = generate_advanced_comments(questioning_score, listening_score, proposing_score, 
                                        closing_score, conversation_flow, positive_count, negative_count)
    
    # 総合評価（より詳細）
    overall_comment = generate_overall_comment(total_score, conversation_flow, positive_count, negative_count)
    
    # 改善提案
    improvement_suggestions = generate_improvement_suggestions(questioning_score, listening_score, 
                                                             proposing_score, closing_score, conversation_flow)
    
    return {
        'scores': {
            'questioning': round(questioning_score, 1),
            'listening': round(listening_score, 1),
            'proposing': round(proposing_score, 1),
            'closing': round(closing_score, 1),
            'total': round(total_score, 1)
        },
        'comments': comments,
        'overall_comment': overall_comment,
        'improvement_suggestions': improvement_suggestions,
        'total_utterances': total_utterances,
        'analysis': {
            'questions_count': len(questions),
            'open_questions_count': open_questions_count,
            'listening_responses_count': len(listening_responses),
            'proposals_count': len(proposals),
            'closings_count': len(closings),
            'positive_expressions': positive_count,
            'negative_expressions': negative_count,
            'conversation_flow': conversation_flow
        }
    }

def analyze_conversation_flow(utterances):
    """会話の流れを分析"""
    if len(utterances) < 2:
        return "短い会話"
    
    # 会話の段階を分析
    stages = {
        'greeting': 0,  # 挨拶
        'needs_analysis': 0,  # ニーズ分析
        'proposal': 0,  # 提案
        'objection_handling': 0,  # 反対意見対応
        'closing': 0  # クロージング
    }
    
    for utterance in utterances:
        if any(word in utterance for word in ['こんにちは', 'はじめまして', 'お忙しい中']):
            stages['greeting'] += 1
        elif any(word in utterance for word in ['困って', '課題', '問題', '悩み', 'どのような']):
            stages['needs_analysis'] += 1
        elif any(word in utterance for word in ['提案', 'おすすめ', '解決', 'サービス']):
            stages['proposal'] += 1
        elif any(word in utterance for word in ['でも', 'しかし', '心配', '不安']):
            stages['objection_handling'] += 1
        elif any(word in utterance for word in ['いかがでしょうか', '検討', 'お時間']):
            stages['closing'] += 1
    
    # 最も多い段階を特定
    max_stage = max(stages, key=stages.get)
    return max_stage

def generate_advanced_comments(questioning, listening, proposing, closing, flow, positive, negative):
    """高度な評価コメントを生成"""
    comments = []
    
    # 質問力の詳細評価
    if questioning >= 4:
        comments.append("✅ 相手の課題を積極的に引き出せており、オープンクエスチョンも効果的に使用しています")
    elif questioning >= 2:
        comments.append("⚠️ 質問はできていますが、より深掘りするためのオープンクエスチョンを増やしましょう")
    else:
        comments.append("❌ 質問が不足しています。相手のニーズを理解するために積極的に質問しましょう")
    
    # 傾聴力の詳細評価
    if listening >= 4:
        comments.append("✅ 相手の話をよく聞き、共感を示す表現が豊富です")
    elif listening >= 2:
        comments.append("⚠️ 基本的な傾聴はできていますが、より多様な共感表現を使いましょう")
    else:
        comments.append("❌ 傾聴力が不足しています。相手の話に共感する表現を増やしましょう")
    
    # 提案力の詳細評価
    if proposing >= 4:
        comments.append("✅ 具体的で魅力的な提案ができています")
    elif proposing >= 2:
        comments.append("⚠️ 提案はしていますが、より具体的なベネフィットを伝えましょう")
    else:
        comments.append("❌ 提案力が不足しています。相手の課題に対する解決策を明確に提示しましょう")
    
    # クロージング力の詳細評価
    if closing >= 4:
        comments.append("✅ 次のアクションを明確に促せており、クロージングが上手です")
    elif closing >= 2:
        comments.append("⚠️ クロージングはしていますが、より具体的な次のステップを提案しましょう")
    else:
        comments.append("❌ クロージングが不足しています。会話の終わりに次のアクションを明確にしましょう")
    
    # 会話の流れに関するコメント
    if flow == 'greeting':
        comments.append("💡 挨拶段階で止まっています。ニーズ分析に進みましょう")
    elif flow == 'needs_analysis':
        comments.append("💡 ニーズ分析はできています。提案段階に進みましょう")
    elif flow == 'proposal':
        comments.append("💡 提案はできています。クロージングに進みましょう")
    elif flow == 'closing':
        comments.append("💡 良い会話の流れです。クロージングまで到達できています")
    
    # 感情分析に関するコメント
    if positive > negative:
        comments.append("😊 ポジティブな表現が多く、良い関係性を築けています")
    elif negative > positive:
        comments.append("😟 ネガティブな表現が多いです。よりポジティブなアプローチを心がけましょう")
    
    return comments

def generate_overall_comment(total_score, flow, positive, negative):
    """総合評価コメントを生成"""
    if total_score >= 4.5:
        return "🌟 素晴らしい営業スキルです！プロレベルの対応ができています。"
    elif total_score >= 4:
        return "⭐ 優秀な営業スキルです。さらに磨きをかけて完璧を目指しましょう。"
    elif total_score >= 3:
        return "👍 良い営業スキルです。継続的な練習でさらに向上させましょう。"
    elif total_score >= 2:
        return "📈 基本的な営業スキルはあります。弱点を克服してレベルアップしましょう。"
    else:
        return "🎯 営業スキルの基礎を固めましょう。一つずつ確実に身につけていきましょう。"

def generate_improvement_suggestions(questioning, listening, proposing, closing, flow):
    """改善提案を生成"""
    suggestions = []
    
    if questioning < 3:
        suggestions.append("📝 質問力向上: 5W1H（何・誰・いつ・どこ・なぜ・どのように）を意識した質問を練習しましょう")
    
    if listening < 3:
        suggestions.append("👂 傾聴力向上: 相手の話を聞く際は「なるほど」「そうですね」などの相づちを意識しましょう")
    
    if proposing < 3:
        suggestions.append("💡 提案力向上: 相手の課題に対する具体的な解決策とベネフィットを明確に伝えましょう")
    
    if closing < 3:
        suggestions.append("🎯 クロージング力向上: 会話の終わりには必ず次のアクションを明確に提案しましょう")
    
    if flow == 'greeting':
        suggestions.append("🔄 会話の流れ: 挨拶の後は相手の課題やニーズを聞く質問から始めましょう")
    
    return suggestions

# ===== Week 3: データ永続化機能 =====

@app.route('/api/conversations', methods=['POST'])
def save_conversation():
    """会話履歴をSupabaseに保存"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Supabaseが設定されていません'}), 500

        data = request.get_json()
        user_id = data.get('user_id')
        store_id = data.get('store_id')
        scenario_id = data.get('scenario_id')
        messages = data.get('messages', [])
        duration = data.get('duration_seconds', 0)

        if not user_id or not scenario_id:
            return jsonify({'success': False, 'error': 'user_idとscenario_idは必須です'}), 400

        # conversationsテーブルに保存
        result = supabase_client.table('conversations').insert({
            'user_id': user_id,
            'store_id': store_id,
            'scenario_id': scenario_id,
            'scenario_title': data.get('scenario_title', scenario_id),
            'messages': messages,
            'duration_seconds': duration
        }).execute()

        return jsonify({
            'success': True,
            'conversation_id': result.data[0]['id'] if result.data else None,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/conversations', methods=['GET'])
def get_conversations():
    """会話履歴を取得"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Supabaseが設定されていません'}), 500

        user_id = request.args.get('user_id')
        scenario_id = request.args.get('scenario_id')
        limit = request.args.get('limit', 50)

        if not user_id:
            return jsonify({'success': False, 'error': 'user_idは必須です'}), 400

        # conversationsテーブルから取得
        query = supabase_client.table('conversations').select('*').eq('user_id', user_id)

        if scenario_id:
            query = query.eq('scenario_id', scenario_id)

        result = query.order('created_at', desc=True).limit(limit).execute()

        return jsonify({
            'success': True,
            'conversations': result.data,
            'count': len(result.data)
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/evaluations', methods=['GET', 'POST'])
def handle_evaluations():
    """評価履歴の取得または保存"""
    if request.method == 'GET':
        # 評価履歴を取得
        try:
            if not supabase_client:
                return jsonify({'success': False, 'error': 'Supabaseが設定されていません'}), 500

            user_id = request.args.get('user_id')
            scenario_id = request.args.get('scenario_id')
            limit = request.args.get('limit', 50)

            if not user_id:
                return jsonify({'success': False, 'error': 'user_idは必須です'}), 400

            # evaluationsテーブルから取得
            query = supabase_client.table('evaluations').select('*').eq('user_id', user_id)

            if scenario_id:
                query = query.eq('scenario_id', scenario_id)

            result = query.order('created_at', desc=True).limit(limit).execute()

            return jsonify({
                'success': True,
                'evaluations': result.data,
                'count': len(result.data)
            })

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'success': False, 'error': str(e)}), 500

    else:  # POST
        # 評価履歴を保存
        try:
            if not supabase_client:
                return jsonify({'success': False, 'error': 'Supabaseが設定されていません'}), 500

            data = request.get_json()
            conversation_id = data.get('conversation_id')
            user_id = data.get('user_id')
            store_id = data.get('store_id')
            scenario_id = data.get('scenario_id')
            scores = data.get('scores', {})
            comments = data.get('comments', {})

            if not user_id or not scenario_id:
                return jsonify({'success': False, 'error': 'user_idとscenario_idは必須です'}), 400

            # スコアの合計と平均を計算（フロントエンドから来るフィールド名を考慮）
            total_score = sum([
                scores.get('questioning_skill', scores.get('questioning', 0)),
                scores.get('listening_skill', scores.get('listening', 0)),
                scores.get('proposal_skill', scores.get('proposing', 0)),
                scores.get('closing_skill', scores.get('closing', 0))
            ])
            average_score = total_score / 4

            # evaluationsテーブルに保存
            result = supabase_client.table('evaluations').insert({
                'conversation_id': conversation_id,
                'user_id': user_id,
                'store_id': store_id,
                'scenario_id': scenario_id,
                'scores': scores,
                'total_score': int(total_score),
                'average_score': round(average_score, 2),
                'comments': comments
            }).execute()

            return jsonify({
                'success': True,
                'evaluation_id': result.data[0]['id'] if result.data else None,
                'timestamp': datetime.now().isoformat()
            })

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'success': False, 'error': str(e)}), 500


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
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/admin/stores/stats', methods=['GET'])
def get_stores_stats():
    """全店舗の統計情報を取得（本部管理者専用）"""
    try:
        # SupabaseクライアントがNoneでないことを確認
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # 全店舗取得
        stores_result = supabase_client.table('stores').select('*').execute()
        stores = stores_result.data if stores_result.data else []

        # 全ユーザー数
        profiles_result = supabase_client.table('profiles').select('id, store_id').execute()
        total_users = len(profiles_result.data) if profiles_result.data else 0

        # 全会話数
        conversations_result = supabase_client.table('conversations').select('id').execute()
        total_conversations = len(conversations_result.data) if conversations_result.data else 0

        # 全評価数と平均スコア
        evaluations_result = supabase_client.table('evaluations').select('average_score').execute()
        evaluations = evaluations_result.data if evaluations_result.data else []
        total_evaluations = len(evaluations)
        overall_avg_score = sum(e['average_score'] for e in evaluations) / total_evaluations if total_evaluations > 0 else 0

        return jsonify({
            'success': True,
            'stats': {
                'total_stores': len(stores),
                'total_users': total_users,
                'total_conversations': total_conversations,
                'total_evaluations': total_evaluations,
                'overall_avg_score': round(overall_avg_score, 2)
            }
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/stores/rankings', methods=['GET'])
def get_stores_rankings():
    """店舗別ランキングを取得（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # 全店舗取得
        stores_result = supabase_client.table('stores').select('*').execute()
        stores = stores_result.data if stores_result.data else []

        rankings = []
        for store in stores:
            store_id = store['id']

            # 店舗のユーザー数
            profiles_result = supabase_client.table('profiles').select('id').eq('store_id', store_id).execute()
            user_count = len(profiles_result.data) if profiles_result.data else 0

            # 店舗の会話数
            conversations_result = supabase_client.table('conversations').select('id').eq('store_id', store_id).execute()
            conversation_count = len(conversations_result.data) if conversations_result.data else 0

            # 店舗の評価平均スコア
            evaluations_result = supabase_client.table('evaluations').select('average_score').eq('store_id', store_id).execute()
            evaluations = evaluations_result.data if evaluations_result.data else []
            avg_score = sum(e['average_score'] for e in evaluations) / len(evaluations) if evaluations else 0

            rankings.append({
                'store_id': store_id,
                'store_code': store['store_code'],
                'store_name': store['store_name'],
                'region': store.get('region'),
                'user_count': user_count,
                'conversation_count': conversation_count,
                'evaluation_count': len(evaluations),
                'average_score': round(avg_score, 2)
            })

        # 平均スコアでソート（降順）
        rankings.sort(key=lambda x: x['average_score'], reverse=True)

        return jsonify({
            'success': True,
            'rankings': rankings
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stores/<store_id>/members', methods=['GET'])
def get_store_members(store_id):
    """店舗メンバー一覧を取得（店舗管理者・本部管理者）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # メンバー取得
        profiles_result = supabase_client.table('profiles').select('*').eq('store_id', store_id).execute()
        members = profiles_result.data if profiles_result.data else []

        # 各メンバーの統計情報を追加
        for member in members:
            user_id = member['id']

            # 会話数
            conversations_result = supabase_client.table('conversations').select('id').eq('user_id', user_id).execute()
            member['conversation_count'] = len(conversations_result.data) if conversations_result.data else 0

            # 評価平均スコア
            evaluations_result = supabase_client.table('evaluations').select('average_score').eq('user_id', user_id).execute()
            evaluations = evaluations_result.data if evaluations_result.data else []
            member['average_score'] = round(sum(e['average_score'] for e in evaluations) / len(evaluations), 2) if evaluations else 0
            member['evaluation_count'] = len(evaluations)

        return jsonify({
            'success': True,
            'members': members
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/regions/stats', methods=['GET'])
def get_regions_stats():
    """リージョン別集計を取得（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # 全店舗取得
        stores_result = supabase_client.table('stores').select('*').execute()
        stores = stores_result.data if stores_result.data else []

        # リージョン別にグループ化
        regions = {}
        for store in stores:
            region = store.get('region', '未設定')
            if region not in regions:
                regions[region] = {
                    'region': region,
                    'store_count': 0,
                    'total_users': 0,
                    'total_conversations': 0,
                    'total_evaluations': 0,
                    'total_score': 0,
                    'stores': []
                }

            store_id = store['id']

            # 店舗のユーザー数
            profiles_result = supabase_client.table('profiles').select('id').eq('store_id', store_id).execute()
            user_count = len(profiles_result.data) if profiles_result.data else 0

            # 店舗の会話数
            conversations_result = supabase_client.table('conversations').select('id').eq('store_id', store_id).execute()
            conversation_count = len(conversations_result.data) if conversations_result.data else 0

            # 店舗の評価平均スコア
            evaluations_result = supabase_client.table('evaluations').select('average_score').eq('store_id', store_id).execute()
            evaluations = evaluations_result.data if evaluations_result.data else []
            avg_score = sum(e['average_score'] for e in evaluations) / len(evaluations) if evaluations else 0

            # リージョンの統計を更新
            regions[region]['store_count'] += 1
            regions[region]['total_users'] += user_count
            regions[region]['total_conversations'] += conversation_count
            regions[region]['total_evaluations'] += len(evaluations)
            if evaluations:
                regions[region]['total_score'] += avg_score

            # 店舗情報を追加
            regions[region]['stores'].append({
                'store_id': store_id,
                'store_code': store['store_code'],
                'store_name': store['store_name'],
                'user_count': user_count,
                'conversation_count': conversation_count,
                'evaluation_count': len(evaluations),
                'average_score': round(avg_score, 2)
            })

        # リージョンごとの平均スコアを計算
        region_stats = []
        for region_name, region_data in regions.items():
            store_count = region_data['store_count']
            avg_score = region_data['total_score'] / store_count if store_count > 0 else 0

            region_stats.append({
                'region': region_name,
                'store_count': store_count,
                'total_users': region_data['total_users'],
                'total_conversations': region_data['total_conversations'],
                'total_evaluations': region_data['total_evaluations'],
                'average_score': round(avg_score, 2),
                'stores': region_data['stores']
            })

        # 平均スコアでソート（降順）
        region_stats.sort(key=lambda x: x['average_score'], reverse=True)

        return jsonify({
            'success': True,
            'regions': region_stats
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stores/<store_id>/analytics', methods=['GET'])
def get_store_analytics(store_id):
    """店舗分析データを取得（店舗管理者・本部管理者）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # 店舗情報
        store_result = supabase_client.table('stores').select('*').eq('id', store_id).execute()
        if not store_result.data:
            return jsonify({'success': False, 'error': 'Store not found'}), 404

        store = store_result.data[0]

        # シナリオ別統計
        evaluations_result = supabase_client.table('evaluations').select('scenario_id, average_score').eq('store_id', store_id).execute()
        evaluations = evaluations_result.data if evaluations_result.data else []

        scenario_stats = {}
        for eval in evaluations:
            scenario_id = eval['scenario_id']
            if scenario_id not in scenario_stats:
                scenario_stats[scenario_id] = {'count': 0, 'total_score': 0}
            scenario_stats[scenario_id]['count'] += 1
            scenario_stats[scenario_id]['total_score'] += eval['average_score']

        scenario_analytics = []
        for scenario_id, stats in scenario_stats.items():
            scenario_analytics.append({
                'scenario_id': scenario_id,
                'count': stats['count'],
                'average_score': round(stats['total_score'] / stats['count'], 2)
            })

        return jsonify({
            'success': True,
            'store': store,
            'scenario_analytics': scenario_analytics,
            'total_evaluations': len(evaluations)
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# 静的アセットを配信
@app.route('/assets/<path:filename>')
def serve_assets(filename):
    """Viteでビルドされたアセットファイルを配信"""
    from flask import send_from_directory
    assets_path = os.path.join(os.path.dirname(__file__), 'dist', 'assets')
    return send_from_directory(assets_path, filename)


# キャッチオールルート: React Routerのクライアント側ルーティングをサポート
@app.route('/<path:path>')
def catch_all(path):
    """
    APIルート以外のすべてのパスでindex.htmlを返す
    これによりReact Routerがクライアント側でルーティングを処理できる
    """
    from flask import send_from_directory
    print(f"🔍 Catch-all route called with path: {path}")

    # APIルートは除外
    if path.startswith('api/'):
        print(f"❌ API route, returning 404: {path}")
        return jsonify({'error': 'Not found'}), 404

    # メディアファイル（動画・画像）を配信
    if path.endswith(('.mp4', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico')):
        dist_path = os.path.join(os.path.dirname(__file__), 'dist')
        file_path = os.path.join(dist_path, path)
        if os.path.exists(file_path):
            print(f"📹 Serving media file: {path}")
            return send_from_directory(dist_path, path)

    # distディレクトリのindex.htmlを返す
    dist_index = os.path.join(os.path.dirname(__file__), 'dist', 'index.html')
    print(f"📁 Looking for index.html at: {dist_index}")
    print(f"✅ File exists: {os.path.exists(dist_index)}")

    if os.path.exists(dist_index):
        print(f"✅ Serving index.html for path: {path}")
        with open(dist_index, 'r', encoding='utf-8') as f:
            return f.read()

    print(f"❌ index.html not found at: {dist_index}")
    return jsonify({'error': 'Frontend not built', 'path': path}), 404


# ===== Week 6: CSV一括出力機能 =====

@app.route('/api/admin/export/evaluations', methods=['GET'])
def export_all_evaluations():
    """全評価データをCSV形式で出力（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # パラメータ取得
        store_id = request.args.get('store_id')
        region = request.args.get('region')
        scenario_id = request.args.get('scenario_id')

        # 評価データ取得
        query = supabase_client.table('evaluations').select('*')

        if store_id:
            query = query.eq('store_id', store_id)

        if scenario_id:
            query = query.eq('scenario_id', scenario_id)

        query = query.order('created_at', desc=True)
        evaluations_result = query.execute()
        evaluations = evaluations_result.data if evaluations_result.data else []

        # 店舗情報とユーザー情報を取得
        stores_result = supabase_client.table('stores').select('*').execute()
        stores_dict = {s['id']: s for s in (stores_result.data or [])}

        profiles_result = supabase_client.table('profiles').select('*').execute()
        profiles_dict = {p['id']: p for p in (profiles_result.data or [])}

        # リージョンフィルタリング
        if region:
            evaluations = [e for e in evaluations if stores_dict.get(e.get('store_id'), {}).get('region') == region]

        # CSV データ生成
        import io
        import csv

        output = io.StringIO()
        writer = csv.writer(output)

        # ヘッダー
        writer.writerow([
            '評価ID',
            '店舗コード',
            '店舗名',
            'リージョン',
            'ユーザー名',
            'シナリオID',
            '質問力',
            '傾聴力',
            '提案力',
            'クロージング力',
            '合計スコア',
            '平均スコア',
            '評価日時'
        ])

        # データ行
        for evaluation in evaluations:
            store = stores_dict.get(evaluation.get('store_id'), {})
            user = profiles_dict.get(evaluation.get('user_id'), {})
            scores = evaluation.get('scores', {})

            writer.writerow([
                evaluation.get('id', ''),
                store.get('store_code', ''),
                store.get('store_name', ''),
                store.get('region', ''),
                user.get('display_name', ''),
                evaluation.get('scenario_id', ''),
                scores.get('questioning_skill', 0),
                scores.get('listening_skill', 0),
                scores.get('proposal_skill', 0),
                scores.get('closing_skill', 0),
                evaluation.get('total_score', 0),
                evaluation.get('average_score', 0),
                evaluation.get('created_at', '')
            ])

        # BOM付きUTF-8で返却（Excel互換）
        csv_data = '\ufeff' + output.getvalue()

        return csv_data, 200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': f'attachment; filename=evaluations_export_{evaluation.get("created_at", "").split("T")[0] if evaluations else "all"}.csv'
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/export/stores', methods=['GET'])
def export_all_stores():
    """全店舗データをCSV形式で出力（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # パラメータ取得
        region = request.args.get('region')

        # 店舗データ取得
        query = supabase_client.table('stores').select('*')

        if region:
            query = query.eq('region', region)

        query = query.order('store_code')
        stores_result = query.execute()
        stores = stores_result.data if stores_result.data else []

        # 各店舗の統計情報を取得
        for store in stores:
            store_id = store['id']

            # ユーザー数
            profiles_result = supabase_client.table('profiles').select('id').eq('store_id', store_id).execute()
            store['user_count'] = len(profiles_result.data) if profiles_result.data else 0

            # 会話数
            conversations_result = supabase_client.table('conversations').select('id').eq('store_id', store_id).execute()
            store['conversation_count'] = len(conversations_result.data) if conversations_result.data else 0

            # 評価平均スコア
            evaluations_result = supabase_client.table('evaluations').select('average_score').eq('store_id', store_id).execute()
            evaluations = evaluations_result.data if evaluations_result.data else []
            store['evaluation_count'] = len(evaluations)
            store['average_score'] = round(sum(e['average_score'] for e in evaluations) / len(evaluations), 2) if evaluations else 0

        # CSV データ生成
        import io
        import csv

        output = io.StringIO()
        writer = csv.writer(output)

        # ヘッダー
        writer.writerow([
            '店舗コード',
            '店舗名',
            'リージョン',
            'ステータス',
            'ユーザー数',
            '会話数',
            '評価数',
            '平均スコア',
            '作成日'
        ])

        # データ行
        for store in stores:
            writer.writerow([
                store.get('store_code', ''),
                store.get('store_name', ''),
                store.get('region', ''),
                store.get('status', ''),
                store.get('user_count', 0),
                store.get('conversation_count', 0),
                store.get('evaluation_count', 0),
                store.get('average_score', 0),
                store.get('created_at', '')
            ])

        # BOM付きUTF-8で返却（Excel互換）
        csv_data = '\ufeff' + output.getvalue()

        return csv_data, 200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename=stores_export.csv'
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ===== Week 5: 評価精度検証機能 =====

@app.route('/api/instructor-evaluations', methods=['POST'])
def save_instructor_evaluation():
    """講師評価をSupabaseに保存"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Supabaseが設定されていません'}), 500

        data = request.get_json()
        conversation_id = data.get('conversation_id')
        evaluation_id = data.get('evaluation_id')
        user_id = data.get('user_id')
        store_id = data.get('store_id')
        scenario_id = data.get('scenario_id')
        instructor_scores = data.get('instructor_scores')
        instructor_comments = data.get('instructor_comments', {})
        instructor_name = data.get('instructor_name', '')

        if not conversation_id or not evaluation_id or not instructor_scores:
            return jsonify({'success': False, 'error': 'conversation_id, evaluation_id, instructor_scoresは必須です'}), 400

        # AI評価を取得
        ai_eval_result = supabase_client.table('evaluations').select('scores, average_score').eq('id', evaluation_id).execute()
        ai_scores = ai_eval_result.data[0]['scores'] if ai_eval_result.data else {}

        # スコアの差分を計算
        score_differences = {}
        for key in instructor_scores.keys():
            if key in ai_scores:
                score_differences[key] = abs(instructor_scores[key] - ai_scores[key])

        # 精度指標を計算
        accuracy_metrics = calculate_accuracy_metrics(instructor_scores, ai_scores)

        # instructor_evaluationsテーブルに保存
        result = supabase_client.table('instructor_evaluations').insert({
            'conversation_id': conversation_id,
            'evaluation_id': evaluation_id,
            'user_id': user_id,
            'store_id': store_id,
            'scenario_id': scenario_id,
            'instructor_scores': instructor_scores,
            'instructor_comments': instructor_comments,
            'ai_scores': ai_scores,
            'score_differences': score_differences,
            'accuracy_metrics': accuracy_metrics,
            'instructor_name': instructor_name
        }).execute()

        instructor_evaluation_id = result.data[0]['id'] if result.data else None

        return jsonify({
            'success': True,
            'instructor_evaluation_id': instructor_evaluation_id,
            'score_differences': score_differences,
            'accuracy_metrics': accuracy_metrics
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/instructor-evaluations', methods=['GET'])
def get_instructor_evaluations():
    """講師評価を取得"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Supabaseが設定されていません'}), 500

        user_id = request.args.get('user_id')
        scenario_id = request.args.get('scenario_id')
        limit = int(request.args.get('limit', 50))

        query = supabase_client.table('instructor_evaluations').select('*')

        if user_id:
            query = query.eq('user_id', user_id)

        if scenario_id:
            query = query.eq('scenario_id', scenario_id)

        query = query.order('created_at', desc=True).limit(limit)

        result = query.execute()

        return jsonify({
            'success': True,
            'instructor_evaluations': result.data if result.data else []
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/evaluation-accuracy', methods=['GET'])
def get_evaluation_accuracy():
    """評価精度レポートを生成"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Supabaseが設定されていません'}), 500

        scenario_id = request.args.get('scenario_id')
        limit = int(request.args.get('limit', 100))

        query = supabase_client.table('instructor_evaluations').select('*')

        if scenario_id:
            query = query.eq('scenario_id', scenario_id)

        query = query.order('created_at', desc=True).limit(limit)

        result = query.execute()
        instructor_evaluations = result.data if result.data else []

        if not instructor_evaluations:
            return jsonify({
                'success': True,
                'report': {
                    'total_evaluations': 0,
                    'overall_accuracy': 0,
                    'accuracy_by_metric': {},
                    'average_difference': 0,
                    'message': '評価データがありません'
                }
            })

        # 全体の精度を計算
        total_accuracy = 0
        accuracy_by_metric = {
            'questioning_skill': [],
            'listening_skill': [],
            'proposal_skill': [],
            'closing_skill': []
        }
        total_differences = []

        for evaluation in instructor_evaluations:
            metrics = evaluation.get('accuracy_metrics', {})
            total_accuracy += metrics.get('overall_accuracy', 0)

            # メトリック別の精度を収集
            for metric in accuracy_by_metric.keys():
                if metric in evaluation.get('score_differences', {}):
                    difference = evaluation['score_differences'][metric]
                    accuracy_by_metric[metric].append(1 - (difference / 5))  # 5点満点での精度
                    total_differences.append(difference)

        # 平均精度を計算
        overall_accuracy = total_accuracy / len(instructor_evaluations) if instructor_evaluations else 0
        average_difference = sum(total_differences) / len(total_differences) if total_differences else 0

        # メトリック別の平均精度を計算
        metric_accuracy = {}
        for metric, accuracies in accuracy_by_metric.items():
            metric_accuracy[metric] = sum(accuracies) / len(accuracies) if accuracies else 0

        report = {
            'total_evaluations': len(instructor_evaluations),
            'overall_accuracy': round(overall_accuracy * 100, 2),
            'accuracy_by_metric': {k: round(v * 100, 2) for k, v in metric_accuracy.items()},
            'average_difference': round(average_difference, 2),
            'scenario_id': scenario_id,
            'evaluations': instructor_evaluations[:10]  # 最新10件を返す
        }

        return jsonify({
            'success': True,
            'report': report
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


def calculate_accuracy_metrics(instructor_scores, ai_scores):
    """精度指標を計算"""
    if not ai_scores:
        return {'overall_accuracy': 0, 'message': 'AI評価がありません'}

    differences = []
    for key in instructor_scores.keys():
        if key in ai_scores:
            diff = abs(instructor_scores[key] - ai_scores[key])
            differences.append(diff)

    if not differences:
        return {'overall_accuracy': 0, 'message': 'スコアの比較ができません'}

    # 平均差分を計算（5点満点）
    avg_difference = sum(differences) / len(differences)
    # 精度を計算（差分が小さいほど精度が高い）
    overall_accuracy = 1 - (avg_difference / 5)

    return {
        'overall_accuracy': round(overall_accuracy, 4),
        'average_difference': round(avg_difference, 2),
        'total_comparisons': len(differences)
    }


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
