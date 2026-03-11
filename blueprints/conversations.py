"""
会話・評価機能ブループリント
チャット応答、会話保存・取得、評価生成・保存などの機能を提供
"""
import json
import base64
import logging
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from flask import Blueprint, jsonify, request, Response
from openai import RateLimitError
from utils.validation import (
    validate_json_size,
    validate_string_field,
    validate_integer_field,
    validate_list_field
)

# ロガー取得
logger = logging.getLogger(__name__)

# Blueprintオブジェクト作成
conversations_bp = Blueprint('conversations', __name__)

# グローバル変数（init_blueprint()で初期化）
supabase_client = None
openai_client = None
openai_api_key = None
DEFAULT_SCENARIO_ID = None
SALES_ROLEPLAY_PROMPT = None
DIRECTOR_ROLEPLAY_PROMPT = None
load_scenario_object = None
select_random_persona_for_scene = None
select_persona_by_id = None
RAG_INDEX = None
RAG_METADATA = None
search_rag_patterns = None
load_evaluation_samples = None
RUBRIC_DATA = None
limiter = None  # レート制限機能
require_csrf = None  # CSRF保護機能
require_budget = None  # コスト制限機能
MAX_MESSAGE_LENGTH = 2000  # デフォルト値
MAX_HISTORY_LENGTH = 50
MAX_EVALUATION_TEXT_LENGTH = 10000

# ペルソナキャッシュ（セッション単位でペルソナを保持）
# {scenario_id: {persona_data, created_at}}
persona_cache = {}


def init_blueprint(app):
    """
    ブループリント初期化
    app.pyから必要な設定やヘルパー関数を受け取る
    """
    global supabase_client, openai_client, openai_api_key
    global DEFAULT_SCENARIO_ID, SALES_ROLEPLAY_PROMPT, DIRECTOR_ROLEPLAY_PROMPT
    global load_scenario_object, select_random_persona_for_scene, select_persona_by_id
    global RAG_INDEX, RAG_METADATA, search_rag_patterns
    global load_evaluation_samples, RUBRIC_DATA
    global limiter, require_csrf, require_budget
    global MAX_MESSAGE_LENGTH, MAX_HISTORY_LENGTH, MAX_EVALUATION_TEXT_LENGTH

    supabase_client = app.config.get('supabase_client')
    openai_client = app.config.get('openai_client')
    openai_api_key = app.config.get('openai_api_key')
    DEFAULT_SCENARIO_ID = app.config.get('DEFAULT_SCENARIO_ID')
    SALES_ROLEPLAY_PROMPT = app.config.get('SALES_ROLEPLAY_PROMPT')
    DIRECTOR_ROLEPLAY_PROMPT = app.config.get('DIRECTOR_ROLEPLAY_PROMPT')
    load_scenario_object = app.config.get('load_scenario_object')
    select_random_persona_for_scene = app.config.get('select_random_persona_for_scene')
    select_persona_by_id = app.config.get('select_persona_by_id')
    RAG_INDEX = app.config.get('RAG_INDEX')
    RAG_METADATA = app.config.get('RAG_METADATA')
    search_rag_patterns = app.config.get('search_rag_patterns')
    load_evaluation_samples = app.config.get('load_evaluation_samples')
    RUBRIC_DATA = app.config.get('RUBRIC_DATA')
    limiter = app.config.get('limiter')
    require_csrf = app.config.get('require_csrf')
    require_budget = app.config.get('require_budget')
    validate_integer_param = app.config.get('validate_integer_param')
    validate_required_string = app.config.get('validate_required_string')
    MAX_MESSAGE_LENGTH = app.config.get('MAX_MESSAGE_LENGTH', 2000)
    MAX_HISTORY_LENGTH = app.config.get('MAX_HISTORY_LENGTH', 50)
    MAX_EVALUATION_TEXT_LENGTH = app.config.get('MAX_EVALUATION_TEXT_LENGTH', 10000)


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


def apply_csrf(func):
    """
    CSRF保護デコレータを条件付きで適用するヘルパー
    require_csrfが利用可能な場合のみCSRF保護を適用
    """
    if require_csrf:
        return require_csrf(func)
    # require_csrfがNoneの場合は警告
    logger.warning(f"⚠️ CSRF保護が無効です: {func.__name__}")
    return func


def get_difficulty_instructions(difficulty: str) -> str:
    """
    難易度レベルに応じたAI指示を生成

    Args:
        difficulty: 'beginner' | 'intermediate' | 'advanced'

    Returns:
        難易度に応じた指示文字列
    """
    difficulty_map = {
        'beginner': {
            'title': '初級モード',
            'instructions': [
                '質問には丁寧に答え、営業担当者をサポートする',
                '課題や関心事を比較的明確に伝える',
                '興味を持っている様子を示し、前向きな反応を返す',
                '複雑な質問や予算の詳細な追求は控える',
                '営業が良い提案をした場合は素直に評価する'
            ]
        },
        'intermediate': {
            'title': '中級モード',
            'instructions': [
                '適度に警戒心を持ち、質問には慎重に答える',
                '自社の課題は存在するが、すぐには明かさない',
                '営業の提案に対して適度な質問や確認を行う',
                '予算や条件について具体的な確認をする',
                '営業のスキルに応じて態度を変える（良い質問には詳細に答える）'
            ]
        },
        'advanced': {
            'title': '上級モード',
            'instructions': [
                '警戒心が強く、簡単には心を開かない',
                '具体的な数字（売上、ROI、予算など）について詳しく質問する',
                '他社サービスとの比較や、実績について厳しく質問する',
                '営業の提案に対して懐疑的な姿勢を示す',
                '「なぜ？」「具体的には？」など深掘りする質問を多用する',
                '営業が優れた提案をしない限り、簡単には前向きにならない',
                '時間的制約や予算の厳しさを明確に示す'
            ]
        }
    }

    level_data = difficulty_map.get(difficulty, difficulty_map['intermediate'])
    instructions_text = '\n- '.join(level_data['instructions'])

    return f"\n\n【{level_data['title']}】\n- {instructions_text}"


def get_persona_type_from_profile(persona: dict) -> str:
    """
    ペルソナ情報から音声タイプを判定する

    Args:
        persona: ペルソナ辞書（persona_id, base_profile等を含む）

    Returns:
        判定されたペルソナタイプ（'young_entrepreneur', 'tech_founder', 等）
        判定できない場合は 'mid_manager'（デフォルト）
    """
    persona_id = persona.get('persona_id', '')
    base_profile = persona.get('base_profile', {})
    business_type = base_profile.get('business_type', '')

    # 🎯 判定順序重要: より具体的な条件を先に判定

    # 美容/アパレル → young_entrepreneur (明るく快活) ⚠️ 「アパレルEC」を先に判定
    if '美容' in business_type or 'サロン' in business_type or 'アパレル' in business_type or 'beauty' in persona_id or 'apparel' in persona_id:
        return 'young_entrepreneur'
    # IT/テック/SaaS系 → tech_founder (明るく前向き)
    elif 'IT' in business_type or 'テック' in business_type or 'スタートアップ' in business_type or 'SaaS' in business_type or 'tech' in persona_id or 'saas' in persona_id:
        return 'tech_founder'
    # クリエイティブ/広告/マッチングアプリ → creative_director (やや速め)
    elif 'クリエイティブ' in business_type or 'デザイン' in business_type or '制作' in business_type or '動画' in business_type or '広告' in business_type or 'マッチングアプリ' in business_type or 'creative' in persona_id or 'ad_agency' in persona_id or 'matching' in persona_id:
        return 'creative_director'
    # 飲食/伝統/建設/運送 → traditional_owner (落ち着いて慎重)
    elif '飲食' in business_type or 'レストラン' in business_type or '伝統' in business_type or '建設' in business_type or '運送' in business_type or 'restaurant' in persona_id or 'construction' in persona_id or 'driver' in persona_id:
        return 'traditional_owner'
    # 教育 → confident (自信家)
    elif '教育' in business_type or 'スクール' in business_type or 'education' in persona_id:
        return 'confident'
    # 不動産/人材紹介 → mid_manager (標準的で丁寧)
    elif '不動産' in business_type or '人材紹介' in business_type or 'real_estate' in persona_id or 'recruitment' in persona_id:
        return 'mid_manager'
    # EC/オンライン → mid_manager (標準的) ⚠️ より一般的な条件は最後に
    elif 'EC' in business_type or 'オンライン' in business_type or 'ecommerce' in persona_id:
        return 'mid_manager'
    # デフォルト → mid_manager (標準的)
    else:
        return 'mid_manager'


@conversations_bp.route('/api/conversations', methods=['POST'])
@apply_csrf
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
        persona = data.get('persona')  # ペルソナ情報を取得

        if not user_id or not scenario_id:
            return jsonify({'success': False, 'error': 'user_idとscenario_idは必須です'}), 400

        # conversationsテーブルに保存
        conversation_data = {
            'user_id': user_id,
            'store_id': store_id,
            'scenario_id': scenario_id,
            'scenario_title': data.get('scenario_title', scenario_id),
            'messages': messages,
            'duration_seconds': duration
        }

        # ペルソナ情報がある場合は保存
        if persona:
            conversation_data['persona'] = persona

        result = supabase_client.table('conversations').insert(conversation_data).execute()

        return jsonify({
            'success': True,
            'conversation_id': result.data[0]['id'] if result.data else None,
            'timestamp': datetime.now().isoformat()
        })

    except ValueError as e:
        # 入力値エラー（不正なJSON、必須フィールド欠落など）
        logger.error(f"会話保存 - 入力値が不正: {e}")
        return jsonify({'success': False, 'error': '会話データの形式が不正です'}), 400
    except KeyError as e:
        # 必要なフィールドが欠落
        logger.error(f"会話保存 - 必須フィールドが欠落: {e}")
        return jsonify({'success': False, 'error': '必要な情報が含まれていません'}), 400
    except Exception as e:
        # データベースエラーまたは予期しないエラー
        logger.error(f"会話保存 - 予期しないエラー: {type(e).__name__}: {e}", exc_info=True)
        return jsonify({'success': False, 'error': '会話の保存中にエラーが発生しました'}), 500


@conversations_bp.route('/api/conversations', methods=['GET'])
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

    except ValueError as e:
        # 入力値エラー（不正なパラメータなど）
        logger.error(f"会話取得 - 入力値が不正: {e}")
        return jsonify({'success': False, 'error': 'リクエストパラメータが不正です'}), 400
    except Exception as e:
        # データベースエラーまたは予期しないエラー
        logger.error(f"会話取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({'success': False, 'error': '会話履歴の取得中にエラーが発生しました'}), 500


@conversations_bp.route('/api/evaluations', methods=['GET', 'POST'])
@apply_csrf
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

        except ValueError as e:
            # 入力値エラー（不正なパラメータなど）
            logger.error(f"評価取得 - 入力値が不正: {e}")
            return jsonify({'success': False, 'error': 'リクエストパラメータが不正です'}), 400
        except Exception as e:
            # データベースエラーまたは予期しないエラー
            logger.error(f"評価取得 - 予期しないエラー: {type(e).__name__}: {e}")
            return jsonify({'success': False, 'error': '評価履歴の取得中にエラーが発生しました'}), 500

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

        except ValueError as e:
            # 入力値エラー（不正なJSON、必須フィールド欠落など）
            logger.error(f"評価保存 - 入力値が不正: {e}")
            return jsonify({'success': False, 'error': '評価データの形式が不正です'}), 400
        except KeyError as e:
            # 必要なフィールドが欠落
            logger.error(f"評価保存 - 必須フィールドが欠落: {e}")
            return jsonify({'success': False, 'error': '必要な情報が含まれていません'}), 400
        except ZeroDivisionError as e:
            # スコアの平均計算でゼロ除算
            logger.error(f"評価保存 - スコア計算エラー: {e}")
            return jsonify({'success': False, 'error': 'スコアデータが不正です'}), 400
        except Exception as e:
            # データベースエラーまたは予期しないエラー
            logger.error(f"評価保存 - 予期しないエラー: {type(e).__name__}: {e}")
            return jsonify({'success': False, 'error': '評価の保存中にエラーが発生しました'}), 500


# ===== チャット応答エンドポイント =====

@conversations_bp.route('/api/chat', methods=['POST'])
@apply_csrf
@apply_rate_limit("10 per minute")  # GPT-4o-mini使用のためレート制限
def chat():
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        conversation_history = data.get('history', [])
        scenario_id = data.get('scenario_id') or DEFAULT_SCENARIO_ID
        conversation_id = data.get('conversation_id')  # 会話IDを取得
        request_persona = data.get('persona')  # フロントエンドから送信されたペルソナ（会話継続時のフォールバック）
        persona_id = data.get('persona_id')  # フロントエンドから送信されたペルソナID（新規会話時）

        # 入力値検証
        if len(user_message) > MAX_MESSAGE_LENGTH:
            logger.warning(f"メッセージ長超過: {len(user_message)}文字 (最大{MAX_MESSAGE_LENGTH}文字)")
            return jsonify({
                'success': False,
                'error': f'メッセージが長すぎます（最大{MAX_MESSAGE_LENGTH}文字）'
            }), 400

        if len(conversation_history) > MAX_HISTORY_LENGTH:
            logger.warning(f"会話履歴超過: {len(conversation_history)}件 (最大{MAX_HISTORY_LENGTH}件)")
            # 最新のメッセージのみを保持
            conversation_history = conversation_history[-MAX_HISTORY_LENGTH:]

        scenario_obj = load_scenario_object(scenario_id)

        # ペルソナ選択ロジック（例外処理の外で定義）
        is_first_message = len(conversation_history) == 0
        persona = None

        if is_first_message:
            # 会話開始時: ペルソナをランダムに選択
            persona = select_random_persona_for_scene(scenario_id)
            logger.info(f"[ペルソナ選択] 新規会話: ランダム選択 - {persona.get('name', 'Unknown') if persona else 'None'}")
        elif conversation_id and supabase_client:
            # 会話継続中: DBから既存のペルソナを取得
            try:
                result = supabase_client.table('conversations').select('persona').eq('id', conversation_id).limit(1).execute()
                if result.data and result.data[0].get('persona'):
                    persona = result.data[0]['persona']
                    logger.info(f"[ペルソナ選択] 会話継続: DBから取得 - {persona.get('name', 'Unknown')}")
                else:
                    logger.warning(f"[ペルソナ選択] 会話継続: DBにペルソナなし (conversation_id={conversation_id})")
                    # フォールバック: フロントエンドから送信されたpersonaを使用
                    if request_persona:
                        persona = request_persona
                        logger.info(f"[ペルソナ選択] フロントエンドから取得（フォールバック） - {persona.get('name', 'Unknown')}")
            except Exception as e:
                logger.error(f"[ペルソナ取得エラー] conversation_id={conversation_id}: {e}")
                # フォールバック: フロントエンドから送信されたpersonaを使用
                if request_persona:
                    persona = request_persona
                    logger.info(f"[ペルソナ選択] フロントエンドから取得（エラー時フォールバック） - {persona.get('name', 'Unknown')}")
        else:
            # conversation_idがない会話継続（後方互換）: フロントエンドから送信されたpersonaを使用
            if request_persona:
                persona = request_persona
                logger.info(f"[ペルソナ選択] 会話継続: フロントエンドから取得 - {persona.get('name', 'Unknown')}")
            else:
                logger.warning("[ペルソナ選択] 会話継続だがconversation_idなし: ペルソナなしで継続")

        # Whisper統一版: GPT-4を使用して対話生成
        if openai_api_key and openai_client:
            try:
                # シナリオのcategoryに応じてプロンプトを選択
                is_director = scenario_obj and scenario_obj.get('category') == 'director'
                system_prompt = DIRECTOR_ROLEPLAY_PROMPT if is_director else SALES_ROLEPLAY_PROMPT
                logger.info(f"[プロンプト選択] is_director={is_director}, プロンプトタイプ={'DIRECTOR' if is_director else 'SALES'}")

                # シナリオのguidelinesを取得
                guidelines = scenario_obj.get('guidelines', []) if scenario_obj else []
                is_director = scenario_obj and scenario_obj.get('category') == 'director'
                persona_txt = []

                # 会話開始時のみ、詳細なペルソナ情報をシステムプロンプトに追加
                if persona and is_first_message:
                    # ペルソナ情報を詳細にシステムプロンプトに追加
                    # base_profileがある場合はそこから、なければフラット化された構造から取得
                    base_profile = persona.get('base_profile', {})
                    business_type = base_profile.get('business_type') or persona.get('business_type')
                    location = base_profile.get('location') or persona.get('location')
                    business_detail = base_profile.get('business_detail') or persona.get('business_detail')
                    current_video_status = base_profile.get('current_video_status') or persona.get('current_video_status')

                    if business_type:
                        persona_txt.append(f"業種: {business_type}")
                    if location:
                        persona_txt.append(f"場所: {location}")
                    if business_detail:
                        persona_txt.append(f"事業詳細: {business_detail}")
                    if current_video_status:
                        persona_txt.append(f"現在の動画制作状況: {current_video_status}")

                    # SNSアカウント情報
                    sns_accounts = base_profile.get('sns_accounts') or persona.get('sns_accounts')
                    if sns_accounts and isinstance(sns_accounts, dict):
                        sns_list = []
                        for platform, info in sns_accounts.items():
                            if info and info != "なし":
                                sns_list.append(f"{platform.capitalize()}: {info}")
                        if sns_list:
                            persona_txt.append("SNSアカウント:")
                            for sns_info in sns_list:
                                persona_txt.append(f"  - {sns_info}")

                    # ペインポイント
                    pain_points = base_profile.get('pain_points') or persona.get('pain_points')
                    if pain_points and isinstance(pain_points, list):
                        persona_txt.append("ペインポイント:")
                        for pain in pain_points[:5]:  # 最大5件表示
                            persona_txt.append(f"  • {pain}")

                    # 予算感
                    budget_sense = base_profile.get('budget_sense') or persona.get('budget_sense')
                    if budget_sense:
                        persona_txt.append(f"予算感: {budget_sense}")

                    # シーン別の状況設定
                    if 'tone' in persona:
                        persona_txt.append(f"トーン・態度: {persona['tone']}")
                    if 'relationship' in persona:
                        role_label = "ディレクターとの関係性" if is_director else "営業との関係性"
                        persona_txt.append(f"{role_label}: {persona['relationship']}")
                    if 'knowledge_level' in persona:
                        persona_txt.append(f"知識レベル: {persona['knowledge_level']}")
                    if 'decision_power' in persona:
                        persona_txt.append(f"意思決定権: {persona['decision_power']}")

                    # 典型的な質問（シーン別）
                    if 'typical_questions' in persona:
                        typical_questions = persona['typical_questions']
                        if typical_questions and isinstance(typical_questions, list):
                            persona_txt.append("このシーンで顧客がよくする質問:")
                            for question in typical_questions[:3]:  # 最大3件表示
                                persona_txt.append(f"  • {question}")

                    # 懸念事項（シーン別）
                    if 'concerns' in persona:
                        concerns = persona['concerns']
                        if concerns and isinstance(concerns, list):
                            persona_txt.append("このシーンでの懸念事項:")
                            for concern in concerns[:3]:  # 最大3件表示
                                persona_txt.append(f"  • {concern}")

                    # 会話例（example_dialogues）- 自然な会話のスタイルを学習
                    if 'example_dialogues' in persona:
                        example_dialogues = persona['example_dialogues']
                        if example_dialogues and isinstance(example_dialogues, list):
                            persona_txt.append("\n会話スタイルの参考例（この表現スタイルを真似てください）:")
                            for example in example_dialogues[:3]:  # 最大3件表示
                                persona_txt.append(f"  • {example}")

                    if persona_txt:
                        system_prompt += "\n\n【シナリオ設定】\n- " + "\n- ".join(persona_txt)
                    if guidelines:
                        system_prompt += "\n\n【返答ガイドライン】\n- " + "\n- ".join(guidelines)

                    # 難易度レベルの指示を追加
                    system_prompt += get_difficulty_instructions(difficulty)

                    # デバッグ: プロンプトに含まれるペルソナ情報をログ出力
                    logger.info(f"[プロンプト生成] ペルソナ情報をシステムプロンプトに追加:")
                    for txt in persona_txt[:10]:  # 最初の10行のみ
                        logger.info(f"  {txt}")

                elif not is_first_message:
                    # 🎯 会話継続時も基本ペルソナ情報を含める（一貫性のため）
                    if persona:
                        base_profile = persona.get('base_profile', {})
                        business_type = base_profile.get('business_type') or persona.get('business_type')
                        business_detail = base_profile.get('business_detail') or persona.get('business_detail')
                        pain_points = base_profile.get('pain_points') or persona.get('pain_points')
                        budget_sense = base_profile.get('budget_sense') or persona.get('budget_sense')

                        # 🚨 重要: 役割を明確に再確認（AIが営業役に切り替わるのを防ぐ）
                        system_prompt += "\n\n🚨 【役割の再確認】"
                        system_prompt += "\n**あなたは顧客（経営者・マネージャー）です。絶対に営業担当者になってはいけません。**"
                        system_prompt += "\n- あなたはショート動画制作サービスを依頼する側（クライアント）"
                        system_prompt += "\n- たとえ「人材紹介会社」「広告代理店」などのサービス業でも、今回はサービスを受ける側"
                        system_prompt += "\n- 営業から提案を受ける立場"
                        system_prompt += "\n- 質問に答える（質問をたくさんしない）"
                        system_prompt += "\n- 短く簡潔に応答する（1-2文まで）"

                        system_prompt += "\n\n【あなたの設定（必ず守る）】\n"
                        if business_type:
                            system_prompt += f"業種: {business_type}\n"
                        if business_detail:
                            system_prompt += f"事業: {business_detail}\n"
                        if pain_points and isinstance(pain_points, list):
                            system_prompt += f"課題: {', '.join(pain_points[:3])}\n"
                        if budget_sense:
                            system_prompt += f"予算感: {budget_sense}\n"

                    conversation_turn = len(conversation_history) // 2
                    system_prompt += "\n【態度】"
                    if conversation_turn <= 2:
                        system_prompt += "警戒的に応答"
                    elif conversation_turn <= 5:
                        system_prompt += "徐々に心を開く"
                    elif conversation_turn <= 8:
                        system_prompt += "積極的に質問"
                    else:
                        system_prompt += "前向きに検討"

                messages = [{"role": "system", "content": system_prompt}]

                # 🎯 文脈理解改善: 会話履歴（応答速度とのバランス：20→15件）
                # テンポの良い会話のため、トークン数を削減
                for msg in conversation_history[-15:]:  # 最新15件まで（速度重視）
                    if msg['speaker'] == '営業':
                        messages.append({"role": "user", "content": msg['text']})
                    elif msg['speaker'] == '顧客':
                        messages.append({"role": "assistant", "content": msg['text']})

                # RAG検索（過去の音声データから類似パターンを検索）
                rag_context = ""
                if RAG_INDEX and RAG_METADATA and len(RAG_METADATA) > 0:
                    try:
                        # 🎯 質問タイプの分類（トピック抽出）
                        def extract_question_topics(message: str) -> list:
                            """営業の質問からトピックを抽出"""
                            topics = []
                            topic_keywords = {
                                '予算': ['予算', '費用', '価格', '金額', 'コスト', '料金', '値段', '円', '万円'],
                                '期間': ['期間', 'いつ', 'スケジュール', '納期', '時間', 'タイミング', '今すぐ', 'すぐに'],
                                '事例': ['事例', '実績', '他社', '例', 'ケース', '成功例', '導入企業'],
                                '機能': ['機能', 'サービス', 'プラン', 'できる', '内容', '仕組み', 'システム'],
                                '課題': ['課題', '悩み', '困って', '問題', '不安', '心配', '懸念'],
                                'SNS': ['SNS', 'インスタ', 'Instagram', 'TikTok', 'Twitter', 'Facebook', 'リール', 'ショート動画'],
                                '動画': ['動画', 'ビデオ', '映像', 'コンテンツ', '制作', '本数', '投稿'],
                                '効果': ['効果', '成果', '結果', '実績', '数字', '反応', 'フォロワー', '再生数'],
                            }
                            for topic, keywords in topic_keywords.items():
                                if any(kw in message for kw in keywords):
                                    topics.append(topic)
                            return topics

                        # 営業メッセージからトピックを抽出
                        current_topics = extract_question_topics(user_message)

                        # 営業の発言と直近の会話履歴から検索クエリを構築
                        # 直近5往復の会話も含めて検索精度を向上
                        search_query = user_message
                        if conversation_history:
                            recent_context = " ".join([msg.get('text', '') for msg in conversation_history[-5:]])
                            if recent_context:
                                search_query = f"{recent_context} {user_message}"

                        # トピックキーワードを検索クエリに追加（重み付け）
                        if current_topics:
                            search_query += f"\n重要トピック: {', '.join(current_topics)}"
                            logger.debug(f"[RAG文脈強化] 検出トピック: {', '.join(current_topics)}")

                        # 類似パターンを検索（シナリオIDでフィルタリング、応答速度重視で削減：15→5）
                        rag_results = search_rag_patterns(search_query, top_k=5, scenario_id=scenario_id)
                        if rag_results:
                            rag_patterns = []
                            pattern_count = 0
                            similarity_threshold = 0.35  # 🎯 類似度閾値（高品質保証：0.5→0.35に厳格化）

                            for result in rag_results:
                                # 類似度チェック（距離が小さいほど類似度が高い：L2距離）
                                similarity = result.get('similarity', 999)
                                if similarity > similarity_threshold:
                                    logger.debug(f"[RAG除外] 類似度が低いパターンをスキップ（距離: {similarity:.3f}）")
                                    continue

                                pattern_text = result.get('text', '')
                                pattern_type = result.get('type', '')
                                if pattern_text:
                                    # パターンタイプに応じた説明を追加
                                    type_label = {
                                        'good_question': '良い質問例',
                                        'objection_handling': '異論処理例',
                                        'closing': 'クロージング例'
                                    }.get(pattern_type, '実例')
                                    # 300文字まで（詳細な応答パターン）
                                    rag_patterns.append(f"- [{type_label}] {pattern_text[:300]}")
                                    pattern_count += 1
                                    logger.debug(f"[RAG採用] パターン{pattern_count} (類似度距離: {similarity:.3f})")
                                    if pattern_count >= 3:  # 応答速度重視で削減（7→3）
                                        break

                            if rag_patterns:
                                rag_context = "\n\n【過去の実例パターン（実際のロープレから抽出）】\n⚠️ 重要: 以下はあくまで会話の「トーン」や「応答スタイル」の参考例です。\n⚠️ 業種や事業内容は【シナリオ設定】で指定されたペルソナ情報に必ず従ってください。\n⚠️ 実例パターンに含まれる業種（クリーニング、音楽など）は無視し、必ずペルソナの業種で応答してください。\n\n参考例：\n" + "\n".join(rag_patterns)
                                # system_promptに追加
                                system_prompt += rag_context
                                messages[0] = {"role": "system", "content": system_prompt}
                                logger.debug(f"[RAG検索] {len(rag_results)}件の類似パターンを検出")
                            else:
                                logger.debug("[RAG検索] 類似パターンが見つかりませんでした")
                    except Exception as e:
                        logger.error(f"RAG検索エラー（フォールバック）: {e}")
                        # RAG検索に失敗しても続行（通常の応答生成にフォールバック）
                
                # 🎯 Few-shot（シナリオのutterancesを先頭に織り込む）- 最優先で学習
                # シナリオ固有の会話パターンを学習させるため、RAG検索よりも優先
                if scenario_obj:
                    few = scenario_obj.get('utterances') or []
                    # 過剰にならないよう最大5往復（10発話）に拡大（8→10）
                    for u in few[:10]:
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
                    model="gpt-4o-mini",    # 高速モデル（会話のテンポ重視）
                    messages=messages,
                    max_tokens=150,         # 会話継続性: 長めの回答でも完結できるよう150に増量
                    temperature=0.5,        # テンポ重視: 0.6→0.5（決定速度向上）
                    presence_penalty=0.3,   # 新しいトピックを促進
                    frequency_penalty=0.3   # 繰り返しを減らす
                )
                ai_response = response.choices[0].message.content.strip()

            except Exception as e:
                logger.error(f"GPT-4 API エラー: {e}")
                # フォールバック: モック応答
                ai_response = get_mock_response(user_message)
        else:
            # テストモード: モック応答
            ai_response = get_mock_response(user_message)

        response_data = {
            'success': True,
            'response': ai_response,
            'timestamp': datetime.now().isoformat()
        }

        # 新規会話の場合、ペルソナ情報を返す（フロントエンドで保存するため）
        if is_first_message and persona:
            response_data['persona'] = persona

        return jsonify(response_data)

    except ValueError as e:
        # 入力値エラー（不正なJSON、不正なパラメータなど）
        logger.error(f"チャット応答 - 入力値が不正: {e}")
        return jsonify({
            'success': False,
            'error': 'メッセージの形式が不正です'
        }), 400
    except KeyError as e:
        # 必須フィールドが欠落
        logger.error(f"チャット応答 - 必須フィールドが欠落: {e}")
        return jsonify({
            'success': False,
            'error': 'メッセージに必要な情報が含まれていません'
        }), 400
    except TimeoutError as e:
        # OpenAI APIタイムアウト
        logger.error(f"チャット応答 - タイムアウト: {e}")
        return jsonify({
            'success': False,
            'error': '応答生成がタイムアウトしました。もう一度お試しください'
        }), 500
    except Exception as e:
        # 予期しないエラー
        logger.exception(f"チャット応答 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': 'チャット応答の生成に失敗しました。もう一度お試しください'
        }), 500


@conversations_bp.route('/api/chat-stream', methods=['POST'])
@apply_csrf
@apply_rate_limit("5 per minute")  # GPT-4o-mini+TTS使用（CPU集約的）のためレート制限
def chat_stream():
    """
    ストリーミング対応のチャットエンドポイント
    GPT応答を即座に生成・TTS・送信してリアルタイム性を向上
    """
    # コスト制限チェック
    if require_budget:
        from utils.cost_limiter import cost_limiter
        can_use, error_msg = cost_limiter.can_use_service('gpt_chat')
        if not can_use:
            logger.warning(f"🚫 予算制限によりサービス拒否: gpt_chat")
            return jsonify({
                'success': False,
                'error': error_msg,
                'budget_exceeded': True
            }), 429

    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': '不正なリクエストです'}), 400

        # データサイズのバリデーション
        size_error = validate_json_size(data, max_size_mb=5)
        if size_error:
            return size_error

        # メッセージフィールドのバリデーション
        msg_error = validate_string_field(data, 'message', required=False, max_length=MAX_MESSAGE_LENGTH)
        if msg_error:
            return msg_error

        # 会話履歴のバリデーション
        history_error = validate_list_field(data, 'history', required=False, max_items=MAX_HISTORY_LENGTH)
        if history_error:
            return history_error

        user_message = data.get('message', '')
        conversation_history = data.get('history', [])
        scenario_id = data.get('scenario_id') or DEFAULT_SCENARIO_ID
        conversation_id = data.get('conversation_id')  # 会話IDを取得
        request_persona = data.get('persona')  # フロントエンドから送信されたペルソナ（会話継続時のフォールバック）
        persona_id = data.get('persona_id')  # フロントエンドから送信されたペルソナID（新規会話時）
        difficulty = data.get('difficulty', 'intermediate')  # 難易度レベル（beginner/intermediate/advanced）
        logger.info(f"[リクエスト受信] conversation_id={conversation_id}, request_persona={'あり' if request_persona else 'なし'}, persona_id={persona_id if persona_id else 'なし'}, difficulty={difficulty}")
        if request_persona:
            logger.info(f"[リクエスト受信] request_persona.voice_name={request_persona.get('voice_name')}, speaking_rate={request_persona.get('speaking_rate')}")

        # 会話履歴の長さ制限（既にバリデーション済みだが念のため）
        if len(conversation_history) > MAX_HISTORY_LENGTH:
            logger.warning(f"会話履歴超過: {len(conversation_history)}件 (最大{MAX_HISTORY_LENGTH}件)")
            conversation_history = conversation_history[-MAX_HISTORY_LENGTH:]
        scenario_obj = load_scenario_object(scenario_id)

        def generate():
            """SSE (Server-Sent Events) でストリーミング送信（TTS並列生成対応）"""
            import time  # ⏱️ パフォーマンス計測用
            print("[DEBUG-GENERATE] generate()関数が呼ばれました", flush=True)
            try:
                # TTS生成用スレッドプール（最大6並列でTTS生成、精度への影響なし）
                executor = ThreadPoolExecutor(max_workers=6)
                tts_futures = {}  # {chunk_index: Future}
                print("[DEBUG-GENERATE] ThreadPoolExecutor初期化完了", flush=True)

                def generate_tts_task(chunk_text, chunk_index, persona_info=None, is_first=False, current_scenario_id=None):
                    """TTS生成タスク（スレッドプールで実行、リトライ対応）"""
                    import time
                    from blueprints.media import select_voice_for_persona, normalize_text_for_japanese_tts
                    tts_start = time.time()

                    # ペルソナに応じた音声と話速を選択
                    persona_type = None
                    selected_voice = None
                    selected_speed = None

                    if persona_info:
                        logger.debug(f"[TTS音声選択/チャンク{chunk_index}] persona_info keys: {list(persona_info.keys())}")
                        # 🎯 優先順位1: ペルソナに保存された音声設定を使用（会話内で一貫性を保つ）
                        if 'voice_name' in persona_info and 'speaking_rate' in persona_info:
                            selected_voice = persona_info['voice_name']
                            selected_speed = persona_info['speaking_rate']
                            logger.info(f"[音声選択/チャンク{chunk_index}] ペルソナから直接取得: voice={selected_voice}, speed={selected_speed}")
                        else:
                            # 🎯 優先順位2: ペルソナ構造から音声タイプを推測（初回のみ）
                            persona_type = get_persona_type_from_profile(persona_info)
                            persona_name = persona_info.get('persona_name', '')
                            base_profile = persona_info.get('base_profile', {})
                            business_type = base_profile.get('business_type', '')
                            logger.info(f"[音声選択] ペルソナ: {persona_name} → タイプ: {persona_type}, 業種: {business_type}")

                    # 音声と話速を選択（まだ決まっていない場合のみ）
                    if not selected_voice or not selected_speed:
                        selected_voice, selected_speed = select_voice_for_persona(
                            persona_type=persona_type or 'mid_manager',
                            scenario_id=None
                        )

                    # リトライ設定（最大3回、指数バックオフ）
                    max_retries = 3
                    retry_delay = 0.1  # 初期遅延100ms

                    # テキストを正規化（英語略語をカタカナ読みに変換）
                    normalized_chunk_text = normalize_text_for_japanese_tts(chunk_text)

                    # デバッグ: TTS送信テキストをログ出力（本番確認のため一時的にINFO）
                    if chunk_text != normalized_chunk_text:
                        print(f"[DEBUG-TTS] チャンク{chunk_index}正規化: '{chunk_text}' → '{normalized_chunk_text}'", flush=True)
                        logger.info(f"[TTS正規化] チャンク{chunk_index}: '{chunk_text}' → '{normalized_chunk_text}'")
                    else:
                        print(f"[DEBUG-TTS] チャンク{chunk_index}送信: '{normalized_chunk_text}'", flush=True)
                        logger.info(f"[TTS送信] チャンク{chunk_index}: '{normalized_chunk_text}'")

                    for attempt in range(max_retries):
                        try:
                            # Google Cloud Text-to-Speech を使用
                            from google.cloud import texttospeech
                            import os
                            import json as json_module

                            # 環境変数から認証情報を取得
                            credentials_json = os.getenv('GOOGLE_CLOUD_TTS_CREDENTIALS')
                            credentials_path = None
                            if credentials_json:
                                # JSONを辞書としてパースしてから一時ファイルに書き込む
                                import tempfile
                                print(f"[DEBUG-GOOGLE-TTS] 環境変数の最初の200文字: {credentials_json[:200]}", flush=True)
                                print(f"[DEBUG-GOOGLE-TTS] 環境変数の109文字目付近: {repr(credentials_json[100:120])}", flush=True)
                                credentials_dict = json_module.loads(credentials_json)
                                with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as f:
                                    json_module.dump(credentials_dict, f, indent=2)
                                    credentials_path = f.name
                                os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credentials_path

                            client = texttospeech.TextToSpeechClient()

                            # 音声パラメータの設定
                            synthesis_input = texttospeech.SynthesisInput(text=normalized_chunk_text)

                            # 日本語の自然な音声を選択
                            # selected_voice にはペルソナに応じた音声名が入っている
                            # (ja-JP-Neural2-B/C: 女性声のみ)
                            # 性別指定は不要（音声名で自動判定される）
                            voice = texttospeech.VoiceSelectionParams(
                                language_code="ja-JP",
                                name=selected_voice  # ペルソナに応じた音声
                            )

                            # 音声設定
                            audio_config = texttospeech.AudioConfig(
                                audio_encoding=texttospeech.AudioEncoding.MP3,
                                speaking_rate=selected_speed,  # 話速
                                pitch=0.0,  # ピッチ（標準）
                                volume_gain_db=0.0  # 音量
                            )

                            # TTS生成
                            response = client.synthesize_speech(
                                input=synthesis_input,
                                voice=voice,
                                audio_config=audio_config
                            )

                            audio_data = response.audio_content
                            audio_base64 = base64.b64encode(audio_data).decode('utf-8')

                            # 一時ファイルを削除
                            if credentials_json and os.path.exists(credentials_path):
                                os.remove(credentials_path)

                            # TTS生成時間を計測
                            tts_duration = (time.time() - tts_start) * 1000  # ms
                            retry_info = f" (リトライ{attempt}回)" if attempt > 0 else ""
                            logger.debug(f"[TTS計測] チャンク{chunk_index}: {tts_duration:.0f}ms ({len(chunk_text)}文字, voice={selected_voice}, speed={selected_speed}){retry_info}")

                            return {'audio': audio_base64, 'text': chunk_text, 'chunk': chunk_index}
                        except Exception as e:
                            if attempt < max_retries - 1:
                                logger.debug(f"[TTS リトライ] チャンク{chunk_index} 試行{attempt + 1}/{max_retries}: {e}")
                                time.sleep(retry_delay)
                                retry_delay *= 2  # 指数バックオフ（100ms → 200ms → 400ms）
                            else:
                                logger.error(f"[TTS 最終エラー] チャンク{chunk_index}: {e} （{max_retries}回試行後）")
                                return None

                if not openai_api_key or not openai_client:
                    yield f"data: {json.dumps({'error': 'OpenAI API未設定'})}\n\n"
                    return

                # システムプロンプト構築（共有ペルソナを使用）
                system_prompt = SALES_ROLEPLAY_PROMPT

                # ペルソナ選択ロジック
                is_first_message = len(conversation_history) == 0
                persona = None

                if is_first_message:
                    # 会話開始時: persona_idが指定されている場合はそのペルソナを使用、なければランダム選択
                    if persona_id:
                        persona = select_persona_by_id(persona_id, scenario_id)
                        if persona:
                            base_profile = persona.get('base_profile', {})
                            logger.info(f"[ペルソナ選択/ストリーミング] 新規会話: ID指定選択")
                            logger.info(f"  - ペルソナ名: {persona.get('persona_name', 'Unknown')}")
                            logger.info(f"  - ペルソナID: {persona_id}")
                            logger.info(f"  - 業種: {base_profile.get('business_type', 'Unknown')}")
                            logger.info(f"  - 地域: {base_profile.get('location', 'Unknown')}")
                            logger.info(f"  - 予算感: {base_profile.get('budget_sense', 'Unknown')}")
                        else:
                            logger.warning(f"[ペルソナ選択/ストリーミング] ペルソナが見つかりません (ID: {persona_id})")
                    else:
                        persona = select_random_persona_for_scene(scenario_id)
                        if persona:
                            base_profile = persona.get('base_profile', {})
                            logger.info(f"[ペルソナ選択/ストリーミング] 新規会話: ランダム選択")
                            logger.info(f"  - ペルソナ名: {persona.get('persona_name', 'Unknown')}")
                            logger.info(f"  - 業種: {base_profile.get('business_type', 'Unknown')}")

                    # 音声設定をpersonaに追加（会話内で一貫性を保つため）
                    if persona:
                        from blueprints.media import select_voice_for_persona

                        # ペルソナ構造から音声タイプを判定
                        persona_type = get_persona_type_from_profile(persona)
                        persona_name = persona.get('persona_name', '')
                        base_profile = persona.get('base_profile', {})
                        business_type = base_profile.get('business_type', '')

                        # 音声と話速を選択してpersonaに保存
                        voice_name, speaking_rate = select_voice_for_persona(
                            persona_type=persona_type,
                            scenario_id=None
                        )
                        persona['voice_name'] = voice_name
                        persona['speaking_rate'] = speaking_rate
                        logger.info(f"[音声設定保存] ペルソナに音声設定を追加: voice={voice_name}, speed={speaking_rate}, type={persona_type}")
                elif conversation_id and supabase_client:
                    # 会話継続中: DBから既存のペルソナを取得
                    try:
                        result = supabase_client.table('conversations').select('persona').eq('id', conversation_id).limit(1).execute()
                        if result.data and result.data[0].get('persona'):
                            persona = result.data[0]['persona']
                            logger.info(f"[ペルソナ選択/ストリーミング] 会話継続: DBから取得 - {persona.get('name', 'Unknown')}")
                        else:
                            logger.warning(f"[ペルソナ選択/ストリーミング] 会話継続: DBにペルソナなし (conversation_id={conversation_id})")
                            # フォールバック: フロントエンドから送信されたpersonaを使用
                            if request_persona:
                                persona = request_persona
                                logger.info(f"[ペルソナ選択/ストリーミング] フロントエンドから取得（フォールバック） - {persona.get('name', 'Unknown')}")
                    except Exception as e:
                        logger.error(f"[ペルソナ取得エラー/ストリーミング] conversation_id={conversation_id}: {e}")
                        # フォールバック: フロントエンドから送信されたpersonaを使用
                        if request_persona:
                            persona = request_persona
                            logger.info(f"[ペルソナ選択/ストリーミング] フロントエンドから取得（エラー時フォールバック） - {persona.get('name', 'Unknown')}")
                else:
                    # conversation_idがない会話継続: フロントエンドから送信されたpersonaを使用
                    if request_persona:
                        persona = request_persona
                        logger.info(f"[ペルソナ選択/ストリーミング] 会話継続: フロントエンドから取得 - {persona.get('name', 'Unknown')}")
                        logger.debug(f"[ペルソナ選択/ストリーミング] persona keys: {list(persona.keys())}, voice_name: {persona.get('voice_name')}, speaking_rate: {persona.get('speaking_rate')}")
                    else:
                        logger.warning("[ペルソナ選択/ストリーミング] 会話継続だがconversation_id・personaなし: ペルソナなしで継続")

                # シナリオのguidelinesを取得
                guidelines = scenario_obj.get('guidelines', []) if scenario_obj else []
                is_director = scenario_obj and scenario_obj.get('category') == 'director'
                persona_txt = []

                # 会話開始時のみ、詳細なペルソナ情報をシステムプロンプトに追加
                if persona and is_first_message:
                    # ペルソナ情報を詳細にシステムプロンプトに追加
                    # base_profileがある場合はそこから、なければフラット化された構造から取得
                    base_profile = persona.get('base_profile', {})
                    business_type = base_profile.get('business_type') or persona.get('business_type')
                    location = base_profile.get('location') or persona.get('location')
                    business_detail = base_profile.get('business_detail') or persona.get('business_detail')
                    current_video_status = base_profile.get('current_video_status') or persona.get('current_video_status')

                    if business_type:
                        persona_txt.append(f"業種: {business_type}")
                    if location:
                        persona_txt.append(f"場所: {location}")
                    if business_detail:
                        persona_txt.append(f"事業詳細: {business_detail}")
                    if current_video_status:
                        persona_txt.append(f"現在の動画制作状況: {current_video_status}")

                    # SNSアカウント情報
                    sns_accounts = base_profile.get('sns_accounts') or persona.get('sns_accounts')
                    if sns_accounts and isinstance(sns_accounts, dict):
                        sns_list = []
                        for platform, info in sns_accounts.items():
                            if info and info != "なし":
                                sns_list.append(f"{platform.capitalize()}: {info}")
                        if sns_list:
                            persona_txt.append("SNSアカウント:")
                            for sns_info in sns_list:
                                persona_txt.append(f"  - {sns_info}")

                    # ペインポイント
                    pain_points = base_profile.get('pain_points') or persona.get('pain_points')
                    if pain_points and isinstance(pain_points, list):
                        persona_txt.append("ペインポイント:")
                        for pain in pain_points[:5]:  # 最大5件表示
                            persona_txt.append(f"  • {pain}")

                    # 予算感
                    budget_sense = base_profile.get('budget_sense') or persona.get('budget_sense')
                    if budget_sense:
                        persona_txt.append(f"予算感: {budget_sense}")

                    # シーン別の状況設定
                    if 'tone' in persona:
                        persona_txt.append(f"トーン・態度: {persona['tone']}")
                    if 'relationship' in persona:
                        role_label = "ディレクターとの関係性" if is_director else "営業との関係性"
                        persona_txt.append(f"{role_label}: {persona['relationship']}")
                    if 'knowledge_level' in persona:
                        persona_txt.append(f"知識レベル: {persona['knowledge_level']}")
                    if 'decision_power' in persona:
                        persona_txt.append(f"意思決定権: {persona['decision_power']}")

                    # 典型的な質問（シーン別）
                    if 'typical_questions' in persona:
                        typical_questions = persona['typical_questions']
                        if typical_questions and isinstance(typical_questions, list):
                            persona_txt.append("このシーンで顧客がよくする質問:")
                            for question in typical_questions[:3]:  # 最大3件表示
                                persona_txt.append(f"  • {question}")

                    # 懸念事項（シーン別）
                    if 'concerns' in persona:
                        concerns = persona['concerns']
                        if concerns and isinstance(concerns, list):
                            persona_txt.append("このシーンでの懸念事項:")
                            for concern in concerns[:3]:  # 最大3件表示
                                persona_txt.append(f"  • {concern}")

                    # 会話例（example_dialogues）- 自然な会話のスタイルを学習
                    if 'example_dialogues' in persona:
                        example_dialogues = persona['example_dialogues']
                        if example_dialogues and isinstance(example_dialogues, list):
                            persona_txt.append("\n会話スタイルの参考例（この表現スタイルを真似てください）:")
                            for example in example_dialogues[:3]:  # 最大3件表示
                                persona_txt.append(f"  • {example}")

                    if persona_txt:
                        system_prompt += "\n\n【シナリオ設定】\n- " + "\n- ".join(persona_txt)
                    if guidelines:
                        system_prompt += "\n\n【返答ガイドライン】\n- " + "\n- ".join(guidelines)

                    # 難易度レベルの指示を追加
                    system_prompt += get_difficulty_instructions(difficulty)

                    # デバッグ: プロンプトに含まれるペルソナ情報をログ出力
                    logger.info(f"[プロンプト生成] ペルソナ情報をシステムプロンプトに追加:")
                    for txt in persona_txt[:10]:  # 最初の10行のみ
                        logger.info(f"  {txt}")

                elif not is_first_message:
                    # 🎯 会話継続時も基本ペルソナ情報を含める（一貫性のため）
                    if persona:
                        base_profile = persona.get('base_profile', {})
                        business_type = base_profile.get('business_type') or persona.get('business_type')
                        business_detail = base_profile.get('business_detail') or persona.get('business_detail')
                        pain_points = base_profile.get('pain_points') or persona.get('pain_points')
                        budget_sense = base_profile.get('budget_sense') or persona.get('budget_sense')

                        # 🚨 重要: 役割を明確に再確認（AIが営業役に切り替わるのを防ぐ）
                        system_prompt += "\n\n🚨 【役割の再確認】"
                        system_prompt += "\n**あなたは顧客（経営者・マネージャー）です。絶対に営業担当者になってはいけません。**"
                        system_prompt += "\n- あなたはショート動画制作サービスを依頼する側（クライアント）"
                        system_prompt += "\n- たとえ「人材紹介会社」「広告代理店」などのサービス業でも、今回はサービスを受ける側"
                        system_prompt += "\n- 営業から提案を受ける立場"
                        system_prompt += "\n- 質問に答える（質問をたくさんしない）"
                        system_prompt += "\n- 短く簡潔に応答する（1-2文まで）"

                        system_prompt += "\n\n【あなたの設定（必ず守る）】\n"
                        if business_type:
                            system_prompt += f"業種: {business_type}\n"
                        if business_detail:
                            system_prompt += f"事業: {business_detail}\n"
                        if pain_points and isinstance(pain_points, list):
                            system_prompt += f"課題: {', '.join(pain_points[:3])}\n"
                        if budget_sense:
                            system_prompt += f"予算感: {budget_sense}\n"

                    conversation_turn = len(conversation_history) // 2
                    system_prompt += "\n【態度】"
                    if conversation_turn <= 2:
                        system_prompt += "警戒的に応答"
                    elif conversation_turn <= 5:
                        system_prompt += "徐々に心を開く"
                    elif conversation_turn <= 8:
                        system_prompt += "積極的に質問"
                    else:
                        system_prompt += "前向きに検討"

                # RAG検索: 実際のロープレデータから類似パターンを取得（リアルな応答のため）
                perf_rag_start = time.time()
                rag_used = False
                try:
                    if RAG_INDEX and RAG_METADATA:
                        rag_used = True
                        # 🎯 質問タイプの分類（トピック抽出）
                        def extract_question_topics(message: str) -> list:
                            """営業の質問からトピックを抽出"""
                            topics = []
                            topic_keywords = {
                                '予算': ['予算', '費用', '価格', '金額', 'コスト', '料金', '値段', '円', '万円'],
                                '期間': ['期間', 'いつ', 'スケジュール', '納期', '時間', 'タイミング', '今すぐ', 'すぐに'],
                                '事例': ['事例', '実績', '他社', '例', 'ケース', '成功例', '導入企業'],
                                '機能': ['機能', 'サービス', 'プラン', 'できる', '内容', '仕組み', 'システム'],
                                '課題': ['課題', '悩み', '困って', '問題', '不安', '心配', '懸念'],
                                'SNS': ['SNS', 'インスタ', 'Instagram', 'TikTok', 'Twitter', 'Facebook', 'リール', 'ショート動画'],
                                '動画': ['動画', 'ビデオ', '映像', 'コンテンツ', '制作', '本数', '投稿'],
                                '効果': ['効果', '成果', '結果', '実績', '数字', '反応', 'フォロワー', '再生数'],
                            }
                            for topic, keywords in topic_keywords.items():
                                if any(kw in message for kw in keywords):
                                    topics.append(topic)
                            return topics

                        # 営業メッセージからトピックを抽出
                        current_topics = extract_question_topics(user_message)

                        # 検索クエリ: ユーザーメッセージ + 直近の会話（文脈精度向上）+ トピック強調
                        recent_context = []
                        for msg in conversation_history[-4:]:  # 直近4件（会話の流れを把握）
                            recent_context.append(f"{msg['speaker']}: {msg['text']}")

                        # トピックキーワードを検索クエリに追加（重み付け）
                        topic_emphasis = ""
                        if current_topics:
                            topic_emphasis = f"\n重要トピック: {', '.join(current_topics)}"
                            logger.debug(f"[RAG文脈強化] 検出トピック: {', '.join(current_topics)}")

                        search_query = "\n".join(recent_context + [f"営業: {user_message}"]) + topic_emphasis

                        # top_k=3（応答速度重視で削減：5→3、精度への影響は最小限）
                        rag_results = search_rag_patterns(search_query, top_k=3, scenario_id=scenario_id)
                        if rag_results:
                            rag_patterns = []
                            pattern_count = 0
                            similarity_threshold = 0.35  # 🎯 類似度閾値（高品質保証：0.5→0.35に厳格化）

                            for result in rag_results:
                                # 類似度チェック（距離が小さいほど類似度が高い：L2距離）
                                similarity = result.get('similarity', 999)
                                if similarity > similarity_threshold:
                                    logger.debug(f"[RAG除外] 類似度が低いパターンをスキップ（距離: {similarity:.3f}）")
                                    continue

                                pattern_text = result.get('text', '')
                                if pattern_text and len(pattern_text) < 500:  # より詳細なパターンを許容
                                    # 顧客側の発言のみを抽出（営業側の発言を除外）
                                    customer_lines = []
                                    for line in pattern_text.split('\n'):
                                        if line.strip().startswith('顧客:'):
                                            customer_lines.append(line.strip())

                                    if customer_lines:
                                        customer_only_text = '\n'.join(customer_lines)
                                        rag_patterns.append(f"- {customer_only_text[:250]}")  # 250文字まで（速度重視、リアル感は維持）
                                        pattern_count += 1
                                        logger.debug(f"[RAG採用] パターン{pattern_count} (類似度距離: {similarity:.3f})")
                                        if pattern_count >= 2:  # 応答速度重視で削減（3→2、最も類似度が高い2件のみ）
                                            break

                            if rag_patterns:
                                rag_context = "\n\n【⭐ 重要：実際のロープレパターン（参考例）】\n"
                                rag_context += "⚠️ 以下は口調・トーンの参考例です。業種はペルソナ設定に従ってください。\n\n"
                                rag_context += "参考例（口調のみ）：\n"
                                rag_context += "\n".join(rag_patterns)
                                rag_context += "\n\n応答時：フィラーや間を使い、ペルソナの業種・課題で応答すること。"
                                system_prompt += rag_context
                                logger.debug(f"[RAG強化] {len(rag_patterns)}個の顧客応答パターンを参照（口調・表現を積極活用）")
                except Exception as e:
                    logger.debug(f"[RAG] 検索エラー（続行）: {e}")
                    # エラーでも続行

                # ⏱️ パフォーマンス計測: RAG検索完了
                if rag_used:
                    perf_rag_end = time.time()
                    perf_rag_time = (perf_rag_end - perf_rag_start) * 1000
                    logger.info(f"⏱️ [計測] RAG検索処理: {perf_rag_time:.0f}ms")
                    print(f"[PERF] RAG検索処理: {perf_rag_time:.0f}ms", flush=True)

                # メッセージ履歴構築（直近10件：会話の一貫性を保つ）
                logger.debug(f"[会話履歴デバッグ] 受信した履歴件数: {len(conversation_history)}")
                for i, msg in enumerate(conversation_history[-10:]):
                    logger.debug(f"  履歴[{i}] {msg.get('speaker', '不明')}: {msg.get('text', '')[:50]}...")

                messages = [{"role": "system", "content": system_prompt}]

                # 🎯 超高速化: 会話履歴を最小限に（6→4件、テンポ最優先）
                for msg in conversation_history[-4:]:  # 最新4件まで（テンポ最優先、直近の文脈で十分）
                    if msg['speaker'] == '営業':
                        messages.append({"role": "user", "content": msg['text']})
                    elif msg['speaker'] == '顧客':
                        messages.append({"role": "assistant", "content": msg['text']})

                messages.append({"role": "user", "content": user_message})
                logger.debug(f"[会話履歴デバッグ] GPTに送るメッセージ数: {len(messages)} (system込み)")

                # ⏱️ パフォーマンス計測: GPT呼び出し開始
                perf_gpt_start = time.time()

                print("[DEBUG-GENERATE] GPT-4o-mini呼び出し開始（max_tokens=150、最適化設定）", flush=True)
                logger.info("[ストリーミング開始] GPT-4o-mini応答生成開始（max_tokens=150、最適化設定）")
                response = openai_client.chat.completions.create(
                    model="gpt-4o-mini",    # 高速モデル（会話のテンポ重視）
                    messages=messages,
                    max_tokens=150,         # 最適化設定: 長めの回答でも完結できるよう150に増量
                    temperature=0.2,        # 最適化設定: 決定速度重視
                    presence_penalty=0.2,   # 新しいトピックを促進
                    frequency_penalty=0.2,  # 繰り返しを減らす
                    stream=True  # ストリーミング有効化
                )

                # ⏱️ パフォーマンス計測: GPT API呼び出し完了（接続確立）
                perf_gpt_connected = time.time()
                perf_connection_time = (perf_gpt_connected - perf_gpt_start) * 1000
                logger.info(f"⏱️ [計測] GPT接続確立: {perf_connection_time:.0f}ms")
                print(f"[PERF] GPT接続確立: {perf_connection_time:.0f}ms", flush=True)

                print("[DEBUG-GENERATE] GPT-4o-mini応答オブジェクト取得完了", flush=True)

                # チャンクバッファ
                text_buffer = ""
                chunk_count = 0
                first_chunk_sent = False  # 最初のチャンクを送信したかフラグ

                # ストリーミングレスポンスを処理（TTS並列生成）
                sentence_count = 0  # 文数カウント
                next_yield_index = 1  # 次にyieldすべきチャンクのインデックス

                print("[DEBUG-GENERATE] GPTレスポンス受信ループ開始", flush=True)
                logger.info("[ストリーミング] GPTレスポンス受信開始")
                token_count = 0  # デバッグ用トークンカウント
                perf_first_token_time = None  # 最初のトークン受信時刻
                perf_first_chunk_sent_time = None  # 最初のチャンク送信時刻
                for chunk in response:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        text_buffer += content
                        token_count += 1

                        # ⏱️ パフォーマンス計測: 最初のトークン受信（TTFT: Time To First Token）
                        if token_count == 1:
                            perf_first_token_time = time.time()
                            perf_ttft = (perf_first_token_time - perf_gpt_start) * 1000
                            logger.info(f"⏱️ [計測] GPT最初のトークン受信（TTFT）: {perf_ttft:.0f}ms")
                            print(f"[PERF] GPT最初のトークン受信（TTFT）: {perf_ttft:.0f}ms", flush=True)

                        # 句点（。）でのみ分割（音声品質向上のため）
                        should_send = False

                        if '。' in text_buffer and len(text_buffer) >= 3:
                            # 句点があり、3文字以上なら送信
                            should_send = True

                        if should_send:
                            # 句点の位置で切る
                            pos = text_buffer.rfind('。')
                            if pos >= 0:
                                chunk_text = text_buffer[:pos+1].strip()
                                chunk_count += 1
                                print(f"[DEBUG-GENERATE] チャンク{chunk_count}分割: '{chunk_text}'", flush=True)
                                logger.info(f"[チャンク{chunk_count}] {chunk_text} （句点で分割・TTS並列生成開始）")

                                # TTS生成を並列実行（ブロックしない）
                                future = executor.submit(generate_tts_task, chunk_text, chunk_count, persona, is_first_message, scenario_id)
                                tts_futures[chunk_count] = future

                                text_buffer = text_buffer[pos+1:].strip()
                                first_chunk_sent = True

                    # 完成したTTSから順序通りにyield（GPTストリーム受信と並列実行）
                    while next_yield_index in tts_futures:
                        future = tts_futures[next_yield_index]
                        if future.done():
                            result = future.result()
                            if result:
                                # ⏱️ パフォーマンス計測: チャンク送信時刻
                                perf_chunk_sent_time = time.time()
                                if perf_first_chunk_sent_time is None:
                                    perf_first_chunk_sent_time = perf_chunk_sent_time
                                    perf_time_to_first_audio = (perf_first_chunk_sent_time - perf_gpt_start) * 1000
                                    logger.info(f"⏱️ [計測] 最初の音声チャンク送信: {perf_time_to_first_audio:.0f}ms")
                                    print(f"[PERF] 最初の音声チャンク送信: {perf_time_to_first_audio:.0f}ms", flush=True)

                                yield f"data: {json.dumps(result)}\n\n"
                                if not first_chunk_sent:
                                    first_chunk_sent = True
                                logger.debug(f"[チャンク{next_yield_index}] 送信完了（並列生成）")
                            del tts_futures[next_yield_index]
                            next_yield_index += 1
                        else:
                            break  # まだ完成していないのでループを抜ける

                # 残りのテキストを処理
                if text_buffer.strip():
                    chunk_count += 1
                    print(f"[DEBUG-GENERATE] 最終チャンク{chunk_count}処理: '{text_buffer.strip()}'", flush=True)
                    logger.info(f"[最終チャンク{chunk_count}] {text_buffer} （TTS並列生成開始）")
                    future = executor.submit(generate_tts_task, text_buffer.strip(), chunk_count, persona, is_first_message, scenario_id)
                    tts_futures[chunk_count] = future
                    text_buffer = ""  # バッファをクリア

                # 全てのTTS生成完了を待ち、順序通りにyield
                while next_yield_index <= chunk_count:
                    if next_yield_index in tts_futures:
                        future = tts_futures[next_yield_index]
                        result = future.result()  # 完了を待つ
                        if result:
                            if next_yield_index == chunk_count:
                                result['final'] = True  # 最終チャンクマーク
                                # 新規会話の場合、最終チャンクでペルソナ情報を送信
                                if is_first_message and persona:
                                    result['persona'] = persona
                                    logger.info(f"[ペルソナ送信] 新規会話のペルソナ情報を最終チャンクに含めて送信")
                            yield f"data: {json.dumps(result)}\n\n"
                            logger.debug(f"[チャンク{next_yield_index}] 送信完了（最終処理）")
                        del tts_futures[next_yield_index]
                    next_yield_index += 1

                # ⏱️ パフォーマンス計測: 全体の処理完了
                perf_total_end = time.time()
                perf_total_time = (perf_total_end - perf_gpt_start) * 1000
                logger.info(f"⏱️ [計測サマリー] 全体処理時間: {perf_total_time:.0f}ms | チャンク数: {chunk_count} | トークン数: {token_count}")
                print(f"[PERF] === 計測サマリー ===", flush=True)
                print(f"[PERF] 1. GPT接続確立: {perf_connection_time:.0f}ms", flush=True)
                if perf_first_token_time:
                    print(f"[PERF] 2. GPT最初のトークン受信（TTFT）: {(perf_first_token_time - perf_gpt_start) * 1000:.0f}ms", flush=True)
                if perf_first_chunk_sent_time:
                    print(f"[PERF] 3. 最初の音声チャンク送信: {(perf_first_chunk_sent_time - perf_gpt_start) * 1000:.0f}ms", flush=True)
                print(f"[PERF] 4. 全体処理時間: {perf_total_time:.0f}ms", flush=True)
                print(f"[PERF] ==================", flush=True)

                # スレッドプールをクリーンアップ
                executor.shutdown(wait=False)

                print(f"[DEBUG-GENERATE] ストリーミング完了: token_count={token_count}, chunk_count={chunk_count}, 最終バッファ='{text_buffer}'", flush=True)
                logger.info(f"[ストリーミング完了] 受信トークン数: {token_count}, 合計{chunk_count}チャンク送信、最終バッファ: '{text_buffer}'")

            except ValueError as e:
                # 入力値エラー（JSON解析、不正な値など）
                logger.error(f"チャットストリーム - 入力値が不正: {e}")
                yield f"data: {json.dumps({'error': 'メッセージの形式が不正です'})}\n\n"
            except TimeoutError as e:
                # OpenAI APIタイムアウト
                logger.error(f"チャットストリーム - タイムアウト: {e}")
                yield f"data: {json.dumps({'error': '応答生成がタイムアウトしました。もう一度お試しください'})}\n\n"
            except RateLimitError as e:
                # OpenAI APIクォータ超過
                logger.error(f"チャットストリーム - クォータ超過: {e}")
                # insufficient_quotaの場合は専用メッセージ
                error_str = str(e)
                if 'insufficient_quota' in error_str or 'exceeded your current quota' in error_str:
                    yield f"data: {json.dumps({'error': '月額利用料の上限に達しましたので、担当にご連絡ください'})}\n\n"
                else:
                    yield f"data: {json.dumps({'error': 'APIの利用制限に達しました。しばらく待ってから再度お試しください'})}\n\n"
            except Exception as e:
                # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
                logger.exception(f"チャットストリーム - 予期しないエラー: {type(e).__name__}: {e}")
                yield f"data: {json.dumps({'error': '応答生成中にエラーが発生しました。もう一度お試しください'})}\n\n"

        # 使用量を記録（ストリーミング開始時点で記録）
        if require_budget:
            from utils.cost_limiter import cost_limiter
            cost_limiter.record_usage('gpt_chat')

        return Response(generate(), mimetype='text/event-stream', headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        })

    except ValueError as e:
        # リクエストデータの入力値エラー
        logger.error(f"チャットストリーム初期化 - 入力値が不正: {e}")
        return jsonify({'success': False, 'error': 'リクエストの形式が不正です'}), 400
    except Exception as e:
        # エンドポイント全体での予期しないエラー
        logger.error(f"チャットストリーム初期化 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({'success': False, 'error': 'サーバーエラーが発生しました。もう一度お試しください'}), 500


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

@conversations_bp.route('/api/evaluate', methods=['POST'])
@apply_csrf
@apply_rate_limit("3 per minute")  # GPT-4評価生成（コスト高）のためレート制限
def evaluate_conversation():
    logger.info("="*80)
    logger.info("[エンドポイント] /api/evaluate が呼ばれました")
    logger.info("="*80)
    try:
        data = request.get_json()
        conversation = data.get('conversation', [])
        scenario_id = data.get('scenario_id')  # シナリオIDを取得

        # デバッグ: 受信したデータをログ出力（強制的に標準出力にも出力）
        debug_msg = f"[エンドポイント] 受信データ: conversation length={len(conversation)}, scenario_id={scenario_id}"
        logger.info(debug_msg)
        print(debug_msg, flush=True)  # 強制出力

        if len(conversation) == 0:
            error_msg = "[エンドポイント] ⚠️ 会話データが空です！"
            logger.error(error_msg)
            print(error_msg, flush=True)  # 強制出力
        else:
            first_msg = f"[エンドポイント] 最初のメッセージ: {conversation[0]}"
            last_msg = f"[エンドポイント] 最後のメッセージ: {conversation[-1]}"
            logger.info(first_msg)
            logger.info(last_msg)
            print(first_msg, flush=True)  # 強制出力
            print(last_msg, flush=True)  # 強制出力

        # 入力値検証
        if len(conversation) > MAX_HISTORY_LENGTH:
            logger.warning(f"評価対象会話が長すぎます: {len(conversation)}件 (最大{MAX_HISTORY_LENGTH}件)")
            return jsonify({
                'success': False,
                'error': f'会話が長すぎます（最大{MAX_HISTORY_LENGTH}件）'
            }), 400

        # 会話データのspeaker一覧を取得
        all_speakers = [msg.get('speaker', 'UNKNOWN') for msg in conversation]
        unique_speakers = list(set(all_speakers))
        logger.info(f"[エンドポイント] 会話データに含まれるspeaker一覧: {unique_speakers}")
        logger.info(f"[エンドポイント] 全speaker: {all_speakers}")
        print(f"[エンドポイント] 会話データに含まれるspeaker一覧: {unique_speakers}", flush=True)

        # シナリオIDからの判定とデータからの判定を組み合わせる
        is_director_scenario_from_id = scenario_id and (scenario_id.startswith('director_') or 'director' in scenario_id)

        # データから実際のユーザーspeaker名を推定（'ディレクター'または'営業'）
        # まず候補のspeaker名でカウントを取る
        director_count = sum(1 for msg in conversation if msg.get('speaker') == 'ディレクター')
        sales_count = sum(1 for msg in conversation if msg.get('speaker') == '営業')

        # データから判定：どちらのspeakerが多いか
        actual_user_speaker = None
        if director_count > 0 and sales_count == 0:
            actual_user_speaker = 'ディレクター'
        elif sales_count > 0 and director_count == 0:
            actual_user_speaker = '営業'
        elif director_count > 0 or sales_count > 0:
            # 両方ある場合は多い方を採用
            actual_user_speaker = 'ディレクター' if director_count >= sales_count else '営業'

        # シナリオIDからの判定とデータからの判定を統合
        if actual_user_speaker:
            # データから判定できた場合は、それを優先（より確実）
            expected_speaker = actual_user_speaker
            is_director_scenario = (expected_speaker == 'ディレクター')
            logger.info(f"[エンドポイント] データからspeakerを判定: '{expected_speaker}' (ディレクター: {director_count}件, 営業: {sales_count}件)")
        else:
            # データから判定できない場合は、シナリオIDから判定
            expected_speaker = 'ディレクター' if is_director_scenario_from_id else '営業'
            is_director_scenario = is_director_scenario_from_id
            logger.info(f"[エンドポイント] シナリオIDからspeakerを判定: '{expected_speaker}' (scenario_id={scenario_id})")

        user_utterances = [msg['text'] for msg in conversation if msg['speaker'] == expected_speaker]

        logger.info(f"[エンドポイント] 最終判定: scenario_id={scenario_id}, is_director={is_director_scenario}, expected_speaker={expected_speaker}")
        logger.info(f"[エンドポイント] 期待されるspeaker: '{expected_speaker}', 見つかった発言数: {len(user_utterances)}")

        if not user_utterances:
            # より詳細なエラーメッセージを返す
            error_msg = f'{expected_speaker}の発言が見つかりません。'
            error_msg += f' 会話データに含まれるspeaker: {unique_speakers}'
            error_msg += f' (scenario_id={scenario_id}, is_director={is_director_scenario})'
            logger.error(f"[エンドポイント] {error_msg}")

            # ユーザーにわかりやすいエラーメッセージを返す
            user_error_msg = f'{expected_speaker}の発言が見つかりません'
            if director_count == 0 and sales_count == 0:
                # どちらも見つからない場合は、会話データの形式が不正
                user_error_msg = '会話データの形式が不正です。ページを再読み込みしてください。'
                logger.error(f"[エンドポイント] ⚠️ 会話データに'ディレクター'も'営業'も含まれていません。unique_speakers={unique_speakers}")

            return jsonify({
                'success': False,
                'error': user_error_msg
            }), 400

        # 講評生成（Week 5改善版: シナリオ別Few-shot対応）
        # 会話全体を渡して文脈を評価
        logger.info(f"[エンドポイント] generate_evaluation_with_gpt4を呼び出し（会話全体: {len(conversation)}件、{expected_speaker}発言数: {len(user_utterances)}）")
        evaluation = generate_evaluation_with_gpt4(conversation, scenario_id)
        logger.info(f"[エンドポイント] generate_evaluation_with_gpt4から戻りました。evaluationタイプ: {type(evaluation)}")
        logger.info(f"[エンドポイント] evaluationキー: {list(evaluation.keys()) if isinstance(evaluation, dict) else 'N/A'}")

        # デバッグログ: 評価結果を出力
        logger.debug("\n" + "="*80)
        logger.debug("[評価結果デバッグ]")
        logger.debug(f"overall: {evaluation.get('overall', 'N/A')}")
        logger.debug(f"strengths: {evaluation.get('strengths', 'N/A')}")
        logger.debug(f"improvements: {evaluation.get('improvements', 'N/A')}")
        logger.debug(f"scores: {evaluation.get('scores', 'N/A')}")
        logger.debug("="*80 + "\n")

        return jsonify({
            'success': True,
            'evaluation': evaluation,
            'timestamp': datetime.now().isoformat()
        })

    except ValueError as e:
        # 入力値エラー（不正なJSON、空の会話など）
        logger.error(f"評価生成 - 入力値が不正: {e}")
        return jsonify({
            'success': False,
            'error': '会話データの形式が不正です'
        }), 400
    except KeyError as e:
        # 必要なフィールドが欠落
        logger.error(f"評価生成 - 必須フィールドが欠落: {e}")
        return jsonify({
            'success': False,
            'error': '会話データに必要な情報が含まれていません'
        }), 400
    except TimeoutError as e:
        # GPT-4 APIタイムアウト
        logger.error(f"評価生成 - タイムアウト: {e}")
        return jsonify({
            'success': False,
            'error': '評価生成がタイムアウトしました。もう一度お試しください'
        }), 500
    except Exception as e:
        # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
        import traceback
        logger.error(f"評価生成 - 予期しないエラー: {type(e).__name__}: {e}")
        logger.error(f"評価生成 - スタックトレース:\n{traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': '評価生成中にエラーが発生しました。もう一度お試しください'
        }), 500

def generate_evaluation_with_gpt4(conversation, scenario_id=None):
    """GPT-4を使用した営業スキル評価（Week 5改善版: シナリオ別Few-shot対応、会話全体を評価）"""
    logger.info("[評価生成] ========== generate_evaluation_with_gpt4 開始 ==========")

    # シナリオ情報を先に読み込み、user_utterancesを定義
    scenario_obj = None
    if scenario_id:
        scenario_obj = load_scenario_object(scenario_id)
        if scenario_obj is None:
            logger.warning(f"[評価生成] ⚠️ シナリオオブジェクトの読み込みに失敗: scenario_id={scenario_id}")
        else:
            logger.debug(f"[評価生成] ✅ シナリオオブジェクト読み込み成功: scenario_id={scenario_id}, category={scenario_obj.get('category')}")

    # シナリオのcategoryフィールドに基づいてディレクター向けか営業向けかを判定
    is_director = scenario_obj and scenario_obj.get('category') == 'director'
    user_speaker = 'ディレクター' if is_director else '営業'
    user_utterances = [msg['text'] for msg in conversation if msg['speaker'] == user_speaker]

    logger.info(f"[評価生成] シナリオ判定: scenario_id={scenario_id}, is_director={is_director}, user_speaker={user_speaker}, 発言数={len(user_utterances)}")

    try:
        # 会話全体をフォーマット
        conversation_text = "\n".join([
            f"{msg['speaker']}: {msg['text']}"
            for msg in conversation
        ])

        # シナリオ情報とFew-shotサンプルを読み込む
        scenario_context = ""
        few_shot_examples = ""

        if scenario_id:
            # シナリオ情報を使用（既に関数先頭で読み込み済み）
            logger.info(f"[評価生成] シナリオID: {scenario_id}, ロード結果: {scenario_obj is not None}")
            if scenario_obj:
                logger.info(f"[評価生成] シナリオタイトル: {scenario_obj.get('title', 'N/A')}, カテゴリ: {scenario_obj.get('category', 'N/A')}")
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
                    role_label = "ディレクター" if is_director else "営業"
                    few_shot_examples += f"{role_label}の発言: " + " → ".join(good_ex['conversation'][::2][:3]) + "...\n"

                    # ディレクター/営業に応じてスコアキーを使い分け
                    scores = good_ex['evaluation']['scores']
                    if is_director:
                        few_shot_examples += f"評価スコア: ヒアリング力={scores.get('hearing', 0)}, "
                        few_shot_examples += f"企画提案力={scores.get('planning', 0)}, "
                        few_shot_examples += f"コミュニケーション力={scores.get('communication', 0)}, "
                        few_shot_examples += f"プロジェクト管理力={scores.get('project_management', 0)}\n"
                    else:
                        few_shot_examples += f"評価スコア: 質問力={scores.get('questioning_skill', 0)}, "
                        few_shot_examples += f"傾聴力={scores.get('listening_skill', 0)}, "
                        few_shot_examples += f"提案力={scores.get('proposal_skill', 0)}, "
                        few_shot_examples += f"クロージング={scores.get('closing_skill', 0)}\n"
                    few_shot_examples += f"評価理由: {good_ex['evaluation']['strengths'][0]}\n"

                if poor_examples:
                    poor_ex = poor_examples[0]  # 最初の悪い例を使用
                    few_shot_examples += "\n【評価サンプル2：改善が必要な例】\n"
                    role_label = "ディレクター" if is_director else "営業"
                    few_shot_examples += f"{role_label}の発言: " + " → ".join(poor_ex['conversation'][::2][:3]) + "...\n"

                    # ディレクター/営業に応じてスコアキーを使い分け
                    scores = poor_ex['evaluation']['scores']
                    if is_director:
                        few_shot_examples += f"評価スコア: ヒアリング力={scores.get('hearing', 0)}, "
                        few_shot_examples += f"企画提案力={scores.get('planning', 0)}, "
                        few_shot_examples += f"コミュニケーション力={scores.get('communication', 0)}, "
                        few_shot_examples += f"プロジェクト管理力={scores.get('project_management', 0)}\n"
                    else:
                        few_shot_examples += f"評価スコア: 質問力={scores.get('questioning_skill', 0)}, "
                        few_shot_examples += f"傾聴力={scores.get('listening_skill', 0)}, "
                        few_shot_examples += f"提案力={scores.get('proposal_skill', 0)}, "
                        few_shot_examples += f"クロージング={scores.get('closing_skill', 0)}\n"
                    few_shot_examples += f"評価理由: {poor_ex['evaluation']['improvements'][0]}\n"

        # user_textを生成（会話全体のログ用）
        user_text = " ".join(user_utterances)
        logger.info(f"[評価生成] 会話履歴の詳細: {conversation}")

        # Rubricから評価基準を構築（シナリオに応じて切り替え）
        rubric_description = ""
        if RUBRIC_DATA and 'evaluation_criteria' in RUBRIC_DATA:
            criteria_list = []
            if is_director:
                # ディレクター向けの4項目を抽出
                target_ids = ['hearing_skill', 'planning_skill', 'director_communication_skill', 'project_management_skill']
            else:
                # 営業向けの4項目を抽出
                target_ids = ['questioning_skill', 'listening_skill', 'proposal_skill', 'closing_skill']

            for criterion in RUBRIC_DATA['evaluation_criteria']:
                criterion_id = criterion.get('id', '')
                if criterion_id in target_ids:
                    name = criterion.get('name', '')
                    desc = criterion.get('description', '')
                    criteria_list.append(f"- {name}: {desc}")
            rubric_description = "\n".join(criteria_list)
        else:
            # フォールバック: 簡易版
            if is_director:
                rubric_description = """- ヒアリング力: 制作要件を丁寧に聞き出し、情報を整理する能力
- 企画提案力: クライアントの課題に対する具体的な解決策・方向性の提示
- コミュニケーション力: 分かりやすい説明、共感、信頼関係の構築
- プロジェクト管理力: 納期・予算・工程の確認と調整能力"""
            else:
                rubric_description = """- 質問力: 顧客のニーズ・課題を適切に引き出す質問
- 傾聴力: 相手の発言を理解し、適切に受容・共感
- 提案力: 顧客の課題に対する具体的な解決策を提示
- クロージング力: 次のアクション・決定を促す適切なクロージング"""

        # GPT-4で評価を生成（Few-shot対応・具体的な講評生成・会話全体を評価）
        # ディレクター向けと営業向けでプロンプトを切り替え
        if is_director:
            role_name = "ディレクター"
            evaluation_prompt = f"""
        あなたはショート動画制作のプロフェッショナルディレクター育成コーチです。以下の会話全体（ディレクターとクライアントのやり取り）を分析して、具体的で実践的な評価を提供してください。

        {scenario_context}
        【会話全体】
        {conversation_text}

        【評価項目】（5点満点で評価）
        {rubric_description}"""
        else:
            role_name = "営業"
            evaluation_prompt = f"""
        あなたはショート動画制作営業のプロフェッショナルコーチです。以下の会話全体（営業と顧客のやり取り）を分析して、具体的で実践的な評価を提供してください。

        {scenario_context}
        【会話全体】
        {conversation_text}

        【評価項目】（5点満点で評価）
        {rubric_description}"""

        evaluation_prompt += f"""

        【点数基準】（必ず1, 2, 3, 4, 5のいずれかの整数で評価してください）
        5点: 非常に優れている（プロレベル、完璧に近い、模範的な営業トーク）
        4点: 優れている（実践的なスキルが十分にある、ベテランレベル）
        3点: 平均的（基本スキルはあるが、明確な改善点が複数ある）
        2点: 要改善（基本スキルが不足、営業としての最低限のレベルに達していない）
        1点: 大幅な改善が必要（スキルがほとんど発揮されていない、練習が必要）

        【重要な評価方針】
        - スコア基準に従って公正に評価してください
        - 挨拶だけで終わった会話、具体的な提案がない会話は1-2点です
        - 基本的な質問しかできていない場合は2-3点です
        - 4-5点は本当に優秀なトークのみに付与してください
        - **必ず良かった点を3つ以上見つけてください**（小さな良い点でも評価）

        重要：スコアは必ず1から5の整数のみを使用してください。6以上の数値や小数点は使用しないでください。

        {few_shot_examples}

        【重要な評価指針】
        1. **良かった点（strengths）は必須**: 最低3項目、最大5項目を具体的な発言を引用して記載
           - 小さな良い点でも評価する（挨拶、言葉遣い、質問の仕方など）
           - 例: 「『どのような課題をお持ちですか？』というオープンクエスチョンで、顧客のニーズを幅広く聞き出せています」

        2. **改善点（improvements）も必須**: 最低3項目、最大5項目を具体的な発言を引用し、どう改善すべきか明示
           - 例: 「『うちのサービスは月5万円です』と価格を先に提示していますが、まず顧客の予算感をヒアリングしてから提案すると効果的です」

        3. **会話の流れ**を時系列で分析する（挨拶→ヒアリング→提案→クロージング）

        4. **バランスの取れた評価**: 良い点と改善点の両方を必ず含める

        上記の指針に従って、以下のJSON形式で評価を出力してください："""

        # JSON出力フォーマットをディレクター向けと営業向けで切り替え
        if is_director:
            evaluation_prompt += """
        {{
            "scores": {{
                "hearing": 数値（1-5の整数のみ）,
                "planning": 数値（1-5の整数のみ）,
                "communication": 数値（1-5の整数のみ）,
                "project_management": 数値（1-5の整数のみ）
            }},
            "strengths": [
                "【ヒアリング力】具体的な発言を引用した良かった点",
                "【企画提案力】具体的な発言を引用した良かった点",
                "【コミュニケーション力】具体的な発言を引用した良かった点"
            ],
            "improvements": [
                "【ヒアリング力】具体的な発言を引用した改善点と改善方法",
                "【企画提案力】具体的な発言を引用した改善点と改善方法",
                "【コミュニケーション力】具体的な発言を引用した改善点と改善方法"
            ],
            "overall": "総合評価（全体の印象、優れていた点の総括、改善すべき点の総括、次回への具体的なアドバイス。150-300文字程度で詳しく記載）",
            "detailedFeedback": {{
                "hearing": {{
                    "rationale": "ヒアリング力のスコアをこの点数にした理由。必ず「5点満点中X点」という表現を含めてください。",
                    "examples": ["ディレクターが実際に言った具体的な質問やヒアリング発言（実質的な内容を含むもの、フィラーのみは不可）", "別の具体的なヒアリング発言"]
                }},
                "planning": {{
                    "rationale": "企画提案力のスコアをこの点数にした理由。必ず「5点満点中X点」という表現を含めてください。",
                    "examples": ["ディレクターが実際に言った具体的な企画提案の発言（実質的な内容を含むもの）", "別の具体的な提案発言"]
                }},
                "communication": {{
                    "rationale": "コミュニケーション力のスコアをこの点数にした理由。必ず「5点満点中X点」という表現を含めてください。",
                    "examples": ["ディレクターが実際に言った具体的なコミュニケーション発言（実質的な内容を含むもの）", "別の具体的なコミュニケーション発言"]
                }},
                "project_management": {{
                    "rationale": "プロジェクト管理力のスコアをこの点数にした理由。必ず「5点満点中X点」という表現を含めてください。",
                    "examples": ["ディレクターが実際に言った具体的なプロジェクト管理の発言（納期・予算・工程に関する実質的な内容）"]
                }}
            }},
            "actionPlan": [
                "次回のロープレで実践すべき具体的なアクション1（40-70文字程度で詳しく）",
                "次回のロープレで実践すべき具体的なアクション2（40-70文字程度で詳しく）",
                "次回のロープレで実践すべき具体的なアクション3（40-70文字程度で詳しく）",
                "次回のロープレで実践すべき具体的なアクション4（40-70文字程度で詳しく）"
            ],
            "analysis": {{
                "hearing_count": 数値,
                "planning_count": 数値,
                "communication_count": 数値,
                "project_management_count": 数値,
                "conversation_flow": "会話の流れの分析（挨拶→要件ヒアリング→方向性提示→工程確認のどの段階まで進んだか）"
            }}
        }}"""
        else:
            evaluation_prompt += """
        {{
            "scores": {{
                "questioning": 数値（1-5の整数のみ）,
                "listening": 数値（1-5の整数のみ）,
                "proposing": 数値（1-5の整数のみ）,
                "closing": 数値（1-5の整数のみ）
            }},
            "strengths": [
                "【質問力】具体的な発言を引用した良かった点",
                "【傾聴力】具体的な発言を引用した良かった点",
                "【提案力】具体的な発言を引用した良かった点"
            ],
            "improvements": [
                "【質問力】具体的な発言を引用した改善点と改善方法",
                "【傾聴力】具体的な発言を引用した改善点と改善方法",
                "【提案力】具体的な発言を引用した改善点と改善方法"
            ],
            "overall": "総合評価（全体の印象、優れていた点の総括、改善すべき点の総括、次回への具体的なアドバイス。150-300文字程度で詳しく記載）",
            "detailedFeedback": {{
                "questioning": {{
                    "rationale": "質問力のスコアをこの点数にした理由。必ず「5点満点中X点」という表現を含めてください。",
                    "examples": ["営業が実際に言った具体的な質問（実質的な内容を含むもの、フィラーのみは不可。例：「現在の課題は何ですか？」）", "別の具体的な質問"]
                }},
                "listening": {{
                    "rationale": "傾聴力のスコアをこの点数にした理由。必ず「5点満点中X点」という表現を含めてください。",
                    "examples": ["営業が実際に言った具体的な傾聴の発言（実質的な内容を含むもの。例：「なるほど、〇〇ということですね」）", "別の具体的な傾聴発言"]
                }},
                "proposing": {{
                    "rationale": "提案力のスコアをこの点数にした理由。必ず「5点満点中X点」という表現を含めてください。",
                    "examples": ["営業が実際に言った具体的な提案の発言（実質的な内容を含むもの。例：「月10本のショート動画制作をお手伝いできます」）", "別の具体的な提案発言"]
                }},
                "closing": {{
                    "rationale": "クロージング力のスコアをこの点数にした理由。必ず「5点満点中X点」という表現を含めてください。",
                    "examples": ["営業が実際に言った具体的なクロージング発言（実質的な内容を含むもの。例：「次回、具体的なプランをご提案させていただけますか？」）"]
                }}
            }},
            "actionPlan": [
                "次回のロープレで実践すべき具体的なアクション1（40-70文字程度で詳しく）",
                "次回のロープレで実践すべき具体的なアクション2（40-70文字程度で詳しく）",
                "次回のロープレで実践すべき具体的なアクション3（40-70文字程度で詳しく）",
                "次回のロープレで実践すべき具体的なアクション4（40-70文字程度で詳しく）"
            ],
            "analysis": {{
                "questions_count": 数値,
                "listening_responses_count": 数値,
                "proposals_count": 数値,
                "closings_count": 数値,
                "conversation_flow": "会話の流れの分析（挨拶→ヒアリング→提案→クロージングのどの段階まで進んだか）"
            }}
        }}"""

        evaluation_prompt += """

        【必須事項】
        - **strengths（良かった点）**: 必ず4〜6項目を記載してください（空欄は絶対に不可）
          - 挨拶、言葉遣い、質問の仕方、声のトーン、会話の流れなど、多角的に評価
          - 各項目60-120文字程度で詳しく記載
          - 具体的な発言を引用し、「なぜ良いか」「どのような効果があるか」を詳しく明記
        - **improvements（改善点）**: 必ず4〜6項目を記載
          - 各項目60-120文字程度で詳しく記載
          - 具体的な発言を引用し、「なぜ改善が必要か」「どう改善すべきか」「改善するとどんな効果があるか」を詳しく明記
        - **examples（detailedFeedbackの具体例）の定義**:
          - ❌ 不適切な例: 「えーそうですねまず」「はい」「なるほど」などフィラーのみの発言
          - ✅ 適切な例: 実質的な内容を含む発言（質問の内容、提案の内容、具体的な応答など）
          - 必ず会話から実際に発言された内容を引用すること
          - 各スキルを示す代表的な発言を選ぶこと
        - 評価は実践的で、次回のロープレで即実行できる内容にする
        - strengthsとimprovementsの両方が必須です。どちらかが空の場合は無効な評価とみなされます
        """
        
        # システムメッセージもディレクター/営業で切り替え
        if is_director:
            system_message = """【最重要指示】あなたの出力は必ず有効なJSON形式のみとしてください。説明文や前置きは一切不要です。

あなたはショート動画制作ディレクターのプロフェッショナルコーチです。
10年以上のディレクター経験を持ち、1000件以上のロープレを評価してきました。
ディレクターの発言を詳細に分析し、具体的な発言を引用しながら、実践的で的確な評価を提供してください。

【評価の詳細度】
- このロールプレイは30分程度の長時間のものです
- 各項目の分析は60-120文字程度で詳しく記載してください
- rationaleは80-120文字程度で、良かった点と改善点の両方に触れながら詳細に分析してください
- 具体的な発言を多く引用し、なぜその発言が良い/改善が必要かを詳しく説明してください

【必須】良かった点（strengths）を必ず4-6個見つけて記載してください。小さな良い点でも評価対象です。"""
        else:
            system_message = """【最重要指示】あなたの出力は必ず有効なJSON形式のみとしてください。説明文や前置きは一切不要です。

あなたはショート動画制作営業のプロフェッショナルコーチです。
10年以上の営業経験を持ち、1000件以上のロープレを評価してきました。
営業の発言を詳細に分析し、具体的な発言を引用しながら、実践的で的確な評価を提供してください。

【評価の詳細度】
- このロールプレイは30分程度の長時間のものです
- 各項目の分析は60-120文字程度で詳しく記載してください
- rationaleは80-120文字程度で、良かった点と改善点の両方に触れながら詳細に分析してください
- 具体的な発言を多く引用し、なぜその発言が良い/改善が必要かを詳しく説明してください

【必須】良かった点（strengths）を必ず4-6個見つけて記載してください。小さな良い点でも評価対象です。"""

        logger.debug(f"[評価生成] GPT-4呼び出し開始（ディレクター: {is_director}, 会話文字数: {len(conversation_text)}）")
        logger.debug(f"[評価生成] 会話データ:\n{conversation_text}")
        logger.debug(f"[評価生成] プロンプト文字数: {len(evaluation_prompt)}")

        try:
            response = openai_client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": system_message},
                    {"role": "user", "content": evaluation_prompt}
                ],
                max_tokens=3500,  # 30分のロールプレイに対応した詳細な講評（安定性とコストのバランスを考慮）
                temperature=0.3
            )
            logger.debug(f"[評価生成] ✅ GPT-4からのレスポンスを受信")
        except Exception as api_error:
            logger.error(f"[評価生成] ❌ OpenAI API呼び出しエラー: {type(api_error).__name__}: {api_error}")
            raise

        # JSONレスポンスを解析
        evaluation_text = response.choices[0].message.content.strip()
        logger.debug(f"[評価生成] レスポンステキスト長: {len(evaluation_text)}文字")

        # JSONの開始と終了を検索
        start_idx = evaluation_text.find('{')
        end_idx = evaluation_text.rfind('}') + 1

        if start_idx != -1 and end_idx != -1:
            json_text = evaluation_text[start_idx:end_idx]
            logger.debug(f"[評価生成] JSON抽出成功: start_idx={start_idx}, end_idx={end_idx}, json長={len(json_text)}文字")
            try:
                evaluation = json.loads(json_text)
                logger.debug(f"[評価生成] ✅ JSON解析成功")
            except json.JSONDecodeError as json_error:
                logger.error(f"[評価生成] ❌ JSON解析エラー: {json_error}")
                logger.error(f"[評価生成] 問題のJSONテキスト（最初の1000文字）:\n{json_text[:1000]}")
                raise ValueError(f"GPT-4のレスポンスのJSON解析に失敗: {json_error}")

            # ディレクター向けのスコアキー名を営業向けにマッピング（フロントエンド互換性）
            if 'scores' in evaluation:
                scores = evaluation['scores']

                # ディレクター向けのキー名を営業向けのキー名に変換
                if 'hearing' in scores:
                    scores['questioning'] = scores.pop('hearing')
                if 'planning' in scores:
                    scores['proposing'] = scores.pop('planning')
                if 'communication' in scores:
                    scores['listening'] = scores.pop('communication')
                if 'project_management' in scores:
                    scores['closing'] = scores.pop('project_management')

            # スコアを1-5点から100点満点に変換（フロントエンド互換性）
            # 重要: detailedFeedbackフォールバック処理の前に変換する
            logger.info(f"[評価生成] evaluationキー一覧: {list(evaluation.keys())}")
            logger.info(f"[評価生成] 'scores' in evaluation: {'scores' in evaluation}")
            if 'scores' in evaluation:
                scores = evaluation['scores']
                logger.info(f"[評価生成] 変換前スコア: {scores}")

                # 各スコアが1-5点スケールか100点満点スケールかを判定
                # 最大値が5以下なら1-5点スケール（20倍）
                # 最大値が20以下なら20点満点スケール（5倍）
                # それ以外は既に100点満点
                max_score = max(
                    scores.get('questioning', 0),
                    scores.get('listening', 0),
                    scores.get('proposing', 0),
                    scores.get('closing', 0)
                )

                if max_score <= 5:
                    # 1-5点スケールの場合、20倍して100点満点に変換
                    logger.info(f"[評価生成] 1-5点スケール検出（最大値: {max_score}） → 20倍で100点満点に変換")
                    scores['questioning'] = scores.get('questioning', 3) * 20
                    scores['listening'] = scores.get('listening', 3) * 20
                    scores['proposing'] = scores.get('proposing', 3) * 20
                    scores['closing'] = scores.get('closing', 3) * 20
                elif max_score <= 20:
                    # 20点満点スケールの場合、5倍して100点満点に変換
                    logger.info(f"[評価生成] 20点満点スケール検出（最大値: {max_score}） → 5倍で100点満点に変換")
                    scores['questioning'] = scores.get('questioning', 15) * 5
                    scores['listening'] = scores.get('listening', 15) * 5
                    scores['proposing'] = scores.get('proposing', 15) * 5
                    scores['closing'] = scores.get('closing', 15) * 5
                else:
                    # 既に100点満点の場合はそのまま使用
                    logger.info(f"[評価生成] 既に100点満点スケール（最大値: {max_score}） → そのまま使用")

                # 各スコアを100点以内に制限（異常値対策）
                scores['questioning'] = min(100, max(0, scores['questioning']))
                scores['listening'] = min(100, max(0, scores['listening']))
                scores['proposing'] = min(100, max(0, scores['proposing']))
                scores['closing'] = min(100, max(0, scores['closing']))

                # totalを計算（4項目の合計、最大400点）
                scores['total'] = scores['questioning'] + scores['listening'] + scores['proposing'] + scores['closing']
                logger.info(f"[評価生成] 変換後スコア（制限適用後）: {scores}")

            # ディレクター向けのdetailedFeedbackキー名を営業向けにマッピング（フロントエンド互換性）
            if 'detailedFeedback' in evaluation:
                feedback = evaluation['detailedFeedback']
                if 'hearing' in feedback:
                    feedback['questioning'] = feedback.pop('hearing')
                if 'planning' in feedback:
                    feedback['proposing'] = feedback.pop('planning')
                if 'communication' in feedback:
                    feedback['listening'] = feedback.pop('communication')
                if 'project_management' in feedback:
                    feedback['closing'] = feedback.pop('project_management')

            # デバッグ: detailedFeedbackの確認
            logger.info(f"[評価生成] detailedFeedback存在確認: {('detailedFeedback' in evaluation)}")
            if 'detailedFeedback' in evaluation:
                logger.info(f"[評価生成] detailedFeedbackキー: {list(evaluation['detailedFeedback'].keys())}")
            else:
                logger.warning("[評価生成] ⚠️ detailedFeedbackが生成されませんでした - フォールバックデータを生成します")
                # detailedFeedbackが欠けている場合、デフォルト値を設定（この時点では既に100点満点に変換済み）
                scores = evaluation.get('scores', {"questioning": 60, "listening": 60, "proposing": 60, "closing": 60})
                evaluation['detailedFeedback'] = {
                    "questioning": {
                        "rationale": f"5点満点中{round(scores.get('questioning', 60) / 20, 1)}点。基本的な質問は行えていますが、より深掘りした質問を心がけましょう。",
                        "examples": ["顧客の課題について質問しています", "ニーズのヒアリングを試みています"]
                    },
                    "listening": {
                        "rationale": f"5点満点中{round(scores.get('listening', 60) / 20, 1)}点。顧客の発言を受けて会話を進めていますが、さらに深く共感を示すことで信頼関係が構築できます。",
                        "examples": ["顧客の回答を聞いています", "会話を継続しています"]
                    },
                    "proposing": {
                        "rationale": f"5点満点中{round(scores.get('proposing', 60) / 20, 1)}点。サービスの説明は行えていますが、顧客の課題に紐づけた提案を意識しましょう。",
                        "examples": ["サービスについて説明しています", "提案を試みています"]
                    },
                    "closing": {
                        "rationale": f"5点満点中{round(scores.get('closing', 60) / 20, 1)}点。次のステップを提示することで、商談を前進させましょう。",
                        "examples": ["会話をまとめようとしています"]
                    }
                }
                logger.info("[評価生成] フォールバックdetailedFeedbackを生成しました")

            # actionPlanのフォールバック処理
            if 'actionPlan' not in evaluation or not evaluation['actionPlan']:
                logger.warning("[評価生成] ⚠️ actionPlanが生成されませんでした - フォールバックデータを生成します")
                evaluation['actionPlan'] = [
                    "顧客の課題を深掘りする質問を増やし、表面的なニーズだけでなく潜在的な課題まで引き出しましょう",
                    "提案時には具体的な事例や数値を示し、顧客の業界や状況に合わせた説得力のある提案を心がけましょう",
                    "顧客の発言を丁寧に受け止め、要約して確認することで、傾聴の姿勢を示しましょう",
                    "次のアクションを明確に提示してクロージングし、具体的な日程や内容を決めて前進させましょう"
                ]
                logger.info("[評価生成] フォールバックactionPlanを生成しました")

            # 基本情報を追加
            evaluation['total_utterances'] = len(user_utterances)

            # overallフィールドの正規化（フロントエンド互換性のため）
            if 'overall' not in evaluation or not evaluation['overall']:
                if 'overall_comment' in evaluation:
                    evaluation['overall'] = evaluation['overall_comment']
                else:
                    evaluation['overall'] = "評価を完了しました。"

            # strengths/improvementsが存在しない、または空の場合
            if 'strengths' not in evaluation or not evaluation['strengths']:
                evaluation['strengths'] = ["評価データを確認中です。"]

            if 'improvements' not in evaluation or not evaluation['improvements']:
                evaluation['improvements'] = ["継続的な練習で更なる向上を目指しましょう。"]

            return evaluation
        else:
            # JSON解析に失敗した場合はエラーを返す
            logger.error("[評価生成] JSON解析失敗 - GPT-4のレスポンスがJSON形式ではありません")
            logger.error(f"[評価生成] レスポンステキスト: {evaluation_text[:500]}")
            raise ValueError("GPT-4のレスポンスがJSON形式ではありません")

    except Exception as e:
        logger.error(f"[評価生成] GPT-4評価エラー: {e}")
        logger.error(f"[評価生成] エラー詳細: {type(e).__name__}")
        import traceback
        logger.error(f"[評価生成] トレースバック:\n{traceback.format_exc()}")
        # エラーを再スロー（フォールバックは使用しない）
        raise


# ========================================
# 録画アップロード・ダウンロード機能
# セッション32: 練習履歴から録画ダウンロード
# ========================================

@conversations_bp.route('/api/conversations/<conversation_id>/recording', methods=['POST'])
@apply_csrf
def upload_recording(conversation_id):
    """
    録画ファイルをSupabase Storageにアップロードし、conversationsテーブルを更新

    リクエスト:
    - multipart/form-data
    - file: 録画ファイル（WebM形式）
    - filename: ファイル名
    - duration: 録画時間（秒）

    レスポンス:
    - success: true/false
    - recording_url: アップロードされたファイルのURL
    """
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Supabaseが設定されていません'}), 500

        # ファイルを取得
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'ファイルがありません'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'ファイルが選択されていません'}), 400

        # ファイル名とメタデータを取得
        filename = request.form.get('filename', file.filename)
        duration = request.form.get('duration', 0)

        # ファイルサイズを取得
        file.seek(0, 2)  # ファイルの最後に移動
        file_size = file.tell()
        file.seek(0)  # ファイルの先頭に戻る

        # ファイルサイズ制限（500MB）
        MAX_FILE_SIZE = 500 * 1024 * 1024
        if file_size > MAX_FILE_SIZE:
            return jsonify({'success': False, 'error': 'ファイルサイズが大きすぎます（最大500MB）'}), 400

        # Supabase Storageにアップロード
        # バケット名: recordings
        # パス: {conversation_id}/{filename}
        storage_path = f"{conversation_id}/{filename}"

        logger.info(f"録画アップロード開始: conversation_id={conversation_id}, filename={filename}, size={file_size}")

        # Supabase Storageにアップロード
        upload_result = supabase_client.storage.from_('recordings').upload(
            path=storage_path,
            file=file.read(),
            file_options={"content-type": "video/webm"}
        )

        # 公開URLを取得
        public_url = supabase_client.storage.from_('recordings').get_public_url(storage_path)

        logger.info(f"録画アップロード成功: url={public_url}")

        # conversationsテーブルを更新
        update_result = supabase_client.table('conversations').update({
            'recording_url': public_url,
            'recording_filename': filename,
            'recording_size_bytes': file_size,
            'recording_duration_seconds': int(duration),
            'has_recording': True
        }).eq('id', conversation_id).execute()

        logger.info(f"会話レコード更新成功: conversation_id={conversation_id}")

        return jsonify({
            'success': True,
            'recording_url': public_url,
            'conversation_id': conversation_id,
            'file_size': file_size,
            'duration': duration
        })

    except Exception as e:
        logger.error(f"録画アップロードエラー: {type(e).__name__}: {e}")
        return jsonify({'success': False, 'error': '録画のアップロードに失敗しました'}), 500


@conversations_bp.route('/api/conversations/<conversation_id>/recording', methods=['GET'])
def get_recording_url(conversation_id):
    """
    録画ファイルのURLを取得

    レスポンス:
    - success: true/false
    - recording_url: 録画ファイルのURL
    - recording_filename: ファイル名
    - recording_size_bytes: ファイルサイズ（バイト）
    - recording_duration_seconds: 録画時間（秒）
    """
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Supabaseが設定されていません'}), 500

        # conversationsテーブルから録画情報を取得
        result = supabase_client.table('conversations').select(
            'recording_url, recording_filename, recording_size_bytes, recording_duration_seconds, has_recording'
        ).eq('id', conversation_id).execute()

        if not result.data or len(result.data) == 0:
            return jsonify({'success': False, 'error': '会話が見つかりません'}), 404

        conversation = result.data[0]

        if not conversation.get('has_recording'):
            return jsonify({'success': False, 'error': '録画がありません'}), 404

        return jsonify({
            'success': True,
            'recording_url': conversation.get('recording_url'),
            'recording_filename': conversation.get('recording_filename'),
            'recording_size_bytes': conversation.get('recording_size_bytes'),
            'recording_duration_seconds': conversation.get('recording_duration_seconds')
        })

    except Exception as e:
        logger.error(f"録画URL取得エラー: {type(e).__name__}: {e}")
        return jsonify({'success': False, 'error': '録画情報の取得に失敗しました'}), 500

# ===== Week 3: データ永続化機能 =====
# （/api/conversations, /api/evaluationsはBlueprint化済み - blueprints/conversations.py参照）

