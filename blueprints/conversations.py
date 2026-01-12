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
load_scenario_object = None
select_random_persona_for_scene = None
RAG_INDEX = None
RAG_METADATA = None
search_rag_patterns = None
load_evaluation_samples = None
RUBRIC_DATA = None
limiter = None  # レート制限機能
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
    global DEFAULT_SCENARIO_ID, SALES_ROLEPLAY_PROMPT
    global load_scenario_object, select_random_persona_for_scene
    global RAG_INDEX, RAG_METADATA, search_rag_patterns
    global load_evaluation_samples, RUBRIC_DATA
    global limiter
    global MAX_MESSAGE_LENGTH, MAX_HISTORY_LENGTH, MAX_EVALUATION_TEXT_LENGTH

    supabase_client = app.config.get('supabase_client')
    openai_client = app.config.get('openai_client')
    openai_api_key = app.config.get('openai_api_key')
    DEFAULT_SCENARIO_ID = app.config.get('DEFAULT_SCENARIO_ID')
    SALES_ROLEPLAY_PROMPT = app.config.get('SALES_ROLEPLAY_PROMPT')
    load_scenario_object = app.config.get('load_scenario_object')
    select_random_persona_for_scene = app.config.get('select_random_persona_for_scene')
    RAG_INDEX = app.config.get('RAG_INDEX')
    RAG_METADATA = app.config.get('RAG_METADATA')
    search_rag_patterns = app.config.get('search_rag_patterns')
    load_evaluation_samples = app.config.get('load_evaluation_samples')
    RUBRIC_DATA = app.config.get('RUBRIC_DATA')
    limiter = app.config.get('limiter')
    validate_integer_param = app.config.get('validate_integer_param')
    validate_required_string = app.config.get('validate_required_string')
    MAX_MESSAGE_LENGTH = app.config.get('MAX_MESSAGE_LENGTH', 2000)
    MAX_HISTORY_LENGTH = app.config.get('MAX_HISTORY_LENGTH', 50)
    MAX_EVALUATION_TEXT_LENGTH = app.config.get('MAX_EVALUATION_TEXT_LENGTH', 10000)


def apply_rate_limit(limit_string):
    """
    レート制限デコレータを条件付きで適用するヘルパー
    limiterが利用可能な場合のみレート制限を適用
    """
    def decorator(func):
        if limiter:
            return limiter.limit(limit_string)(func)
        else:
            # レート制限が無効な場合は警告ログを出力
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"⚠️ レート制限が無効です: {func.__name__} (flask-limiterが未インストール)")
        return func
    return decorator


@conversations_bp.route('/api/conversations', methods=['POST'])
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
@apply_rate_limit("10 per minute")  # GPT-4o-mini使用のためレート制限
def chat():
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        conversation_history = data.get('history', [])
        scenario_id = data.get('scenario_id') or DEFAULT_SCENARIO_ID
        conversation_id = data.get('conversation_id')  # 会話IDを取得

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
            except Exception as e:
                logger.error(f"[ペルソナ取得エラー] conversation_id={conversation_id}: {e}")
        else:
            # conversation_idがない会話継続（後方互換）
            logger.warning("[ペルソナ選択] 会話継続だがconversation_idなし: ペルソナなしで継続")

        # Whisper統一版: GPT-4を使用して対話生成
        if openai_api_key and openai_client:
            try:
                # 会話履歴を構築
                system_prompt = SALES_ROLEPLAY_PROMPT

                # シナリオのguidelinesを取得
                guidelines = scenario_obj.get('guidelines', []) if scenario_obj else []
                persona_txt = []

                # 会話開始時のみ、詳細なペルソナ情報をシステムプロンプトに追加
                if persona and is_first_message:
                    # ペルソナ情報を詳細にシステムプロンプトに追加
                    if 'business_type' in persona:
                        persona_txt.append(f"業種: {persona['business_type']}")
                    if 'location' in persona:
                        persona_txt.append(f"場所: {persona['location']}")
                    if 'business_detail' in persona:
                        persona_txt.append(f"事業詳細: {persona['business_detail']}")
                    if 'current_video_status' in persona:
                        persona_txt.append(f"現在の動画制作状況: {persona['current_video_status']}")

                    # SNSアカウント情報
                    if 'sns_accounts' in persona:
                        sns_accounts = persona['sns_accounts']
                        if isinstance(sns_accounts, dict):
                            sns_list = []
                            for platform, info in sns_accounts.items():
                                if info and info != "なし":
                                    sns_list.append(f"{platform.capitalize()}: {info}")
                            if sns_list:
                                persona_txt.append("SNSアカウント:")
                                for sns_info in sns_list:
                                    persona_txt.append(f"  - {sns_info}")

                    # ペインポイント
                    if 'pain_points' in persona:
                        pain_points = persona['pain_points']
                        if pain_points and isinstance(pain_points, list):
                            persona_txt.append("ペインポイント:")
                            for pain in pain_points[:5]:  # 最大5件表示
                                persona_txt.append(f"  • {pain}")

                    # 予算感
                    if 'budget_sense' in persona:
                        persona_txt.append(f"予算感: {persona['budget_sense']}")

                    # シーン別の状況設定
                    if 'tone' in persona:
                        persona_txt.append(f"トーン・態度: {persona['tone']}")
                    if 'relationship' in persona:
                        persona_txt.append(f"営業との関係性: {persona['relationship']}")
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
                elif not is_first_message:
                    # 🎯 文脈理解改善: 会話ターン数に応じた態度調整
                    conversation_turn = len(conversation_history) // 2  # 往復数を計算

                    # 会話継続中も、ペルソナの重要情報を含める（一貫性を保つため）
                    # 会話履歴から最初のメッセージでどのペルソナが選ばれたかを推測
                    # または、セッション情報からペルソナを取得する必要がある
                    # 暫定的に、会話継続中は一貫性を強調する指示のみ追加
                    system_prompt += "\n\n【重要：会話継続中】\n"
                    system_prompt += "- あなたは既に会話を開始しています\n"
                    system_prompt += "- 必ず過去の会話で話した以下の内容と完全に一貫性を保ってください：\n"
                    system_prompt += "  • 業種・事業内容（変更不可）\n"
                    system_prompt += "  • 現在の動画制作状況（変更不可）\n"
                    system_prompt += "  • 主な課題・ペインポイント（変更不可）\n"
                    system_prompt += "  • SNSアカウント情報（変更不可）\n"
                    system_prompt += "- 【過去の実例パターン】の業種は無視し、あなたが最初に話した設定を使い続けてください\n"
                    system_prompt += "- 例: 「外注している」と言った場合、「外注を検討している」と言ってはいけません\n"
                    system_prompt += "- 例: 「月10本外注中」と言った場合、「本数が増えない」と矛盾することは言わないでください\n"

                    # 🎯 会話進行度に応じた態度変化（段階的な信頼構築）
                    system_prompt += f"\n【会話の進行度: {conversation_turn}往復目】\n"
                    if conversation_turn <= 2:
                        system_prompt += "- 態度: まだ警戒的で慎重（初対面の段階）\n"
                        system_prompt += "- 具体的な情報開示は控えめに\n"
                        system_prompt += "- 営業の質問には簡潔に答える\n"
                    elif conversation_turn <= 5:
                        system_prompt += "- 態度: 少しずつ心を開き始める（信頼構築の段階）\n"
                        system_prompt += "- 営業が良い質問をした場合は、より詳細に答える\n"
                        system_prompt += "- 自社の課題について少しずつ話す\n"
                    elif conversation_turn <= 8:
                        system_prompt += "- 態度: 興味を持ち始め、積極的に質問する（検討段階）\n"
                        system_prompt += "- サービスの具体的な内容や効果について質問する\n"
                        system_prompt += "- 自社の課題と営業の提案の関連性を確認する\n"
                    else:
                        system_prompt += "- 態度: 前向きに検討、具体的な条件を確認（決断段階）\n"
                        system_prompt += "- 予算、期間、サポート体制などの具体的な条件を質問\n"
                        system_prompt += "- 営業の提案が良ければ前向きなサインを出す\n"

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
                    max_tokens=150,         # 会話が途中で切れないように十分な長さを確保
                    temperature=0.6,        # バランス調整: 0.5→0.6（自然さ維持）
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
@apply_rate_limit("5 per minute")  # GPT-4o-mini+TTS使用（CPU集約的）のためレート制限
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
        conversation_id = data.get('conversation_id')  # 会話IDを取得

        # 入力値検証
        if len(user_message) > MAX_MESSAGE_LENGTH:
            logger.warning(f"メッセージ長超過: {len(user_message)}文字 (最大{MAX_MESSAGE_LENGTH}文字)")
            return jsonify({
                'success': False,
                'error': f'メッセージが長すぎます（最大{MAX_MESSAGE_LENGTH}文字）'
            }), 400

        if len(conversation_history) > MAX_HISTORY_LENGTH:
            logger.warning(f"会話履歴超過: {len(conversation_history)}件 (最大{MAX_HISTORY_LENGTH}件)")
            conversation_history = conversation_history[-MAX_HISTORY_LENGTH:]
        scenario_obj = load_scenario_object(scenario_id)

        def generate():
            """SSE (Server-Sent Events) でストリーミング送信（TTS並列生成対応）"""
            print("[DEBUG-GENERATE] generate()関数が呼ばれました", flush=True)
            try:
                # TTS生成用スレッドプール（最大3並列でTTS生成）
                executor = ThreadPoolExecutor(max_workers=3)
                tts_futures = {}  # {chunk_index: Future}
                print("[DEBUG-GENERATE] ThreadPoolExecutor初期化完了", flush=True)

                def generate_tts_task(chunk_text, chunk_index, persona_info=None, is_first=False, current_scenario_id=None):
                    """TTS生成タスク（スレッドプールで実行、リトライ対応）"""
                    import time
                    from blueprints.media import select_voice_for_persona, normalize_text_for_japanese_tts
                    tts_start = time.time()

                    # ペルソナに応じた音声と話速を選択
                    persona_type = None
                    if persona_info:
                        # ペルソナ構造から音声タイプを推測
                        persona_name = persona_info.get('persona_name', '')
                        persona_id = persona_info.get('persona_id', '')

                        # base_profileから業種・年齢等を取得
                        base_profile = persona_info.get('base_profile', {})
                        business_type = base_profile.get('business_type', '')

                        # ペルソナ名やIDから音声タイプを判定
                        if 'IT' in business_type or 'テック' in business_type or 'スタートアップ' in business_type or 'tech' in persona_id:
                            persona_type = 'tech_founder'
                        elif 'クリエイティブ' in business_type or 'デザイン' in business_type or '制作' in business_type or '動画' in business_type or 'creative' in persona_id:
                            persona_type = 'creative_director'
                        elif '美容' in business_type or 'サロン' in business_type or 'beauty' in persona_id:
                            persona_type = 'young_entrepreneur'  # 美容サロン：明るく快活
                        elif '飲食' in business_type or 'レストラン' in business_type or '伝統' in business_type or 'restaurant' in persona_id:
                            persona_type = 'traditional_owner'
                        elif 'EC' in business_type or 'オンライン' in business_type or 'ecommerce' in persona_id:
                            persona_type = 'mid_manager'  # EC：標準的
                        elif '教育' in business_type or 'スクール' in business_type or 'education' in persona_id:
                            persona_type = 'confident'  # 教育：自信家
                        else:
                            persona_type = 'mid_manager'  # デフォルト

                        logger.info(f"[音声選択] ペルソナ: {persona_name} → タイプ: {persona_type}, 業種: {business_type}")

                    # 音声と話速を選択（ペルソナ優先）
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

                            # 日本語の自然な音声を選択（女性声）
                            # selected_voice にはペルソナに応じた音声名が入っている
                            # (ja-JP-Neural2-B/C/D のいずれか)
                            voice = texttospeech.VoiceSelectionParams(
                                language_code="ja-JP",
                                name=selected_voice,  # ペルソナに応じた音声
                                ssml_gender=texttospeech.SsmlVoiceGender.FEMALE
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
                    # 会話開始時: ペルソナをランダムに選択
                    persona = select_random_persona_for_scene(scenario_id)
                    logger.info(f"[ペルソナ選択/ストリーミング] 新規会話: ランダム選択 - {persona.get('name', 'Unknown') if persona else 'None'}")
                elif conversation_id and supabase_client:
                    # 会話継続中: DBから既存のペルソナを取得
                    try:
                        result = supabase_client.table('conversations').select('persona').eq('id', conversation_id).limit(1).execute()
                        if result.data and result.data[0].get('persona'):
                            persona = result.data[0]['persona']
                            logger.info(f"[ペルソナ選択/ストリーミング] 会話継続: DBから取得 - {persona.get('name', 'Unknown')}")
                        else:
                            logger.warning(f"[ペルソナ選択/ストリーミング] 会話継続: DBにペルソナなし (conversation_id={conversation_id})")
                    except Exception as e:
                        logger.error(f"[ペルソナ取得エラー/ストリーミング] conversation_id={conversation_id}: {e}")
                else:
                    # conversation_idがない会話継続（後方互換）
                    logger.warning("[ペルソナ選択/ストリーミング] 会話継続だがconversation_idなし: ペルソナなしで継続")

                # シナリオのguidelinesを取得
                guidelines = scenario_obj.get('guidelines', []) if scenario_obj else []
                persona_txt = []

                # 会話開始時のみ、詳細なペルソナ情報をシステムプロンプトに追加
                if persona and is_first_message:
                    # ペルソナ情報を詳細にシステムプロンプトに追加
                    if 'business_type' in persona:
                        persona_txt.append(f"業種: {persona['business_type']}")
                    if 'location' in persona:
                        persona_txt.append(f"場所: {persona['location']}")
                    if 'business_detail' in persona:
                        persona_txt.append(f"事業詳細: {persona['business_detail']}")
                    if 'current_video_status' in persona:
                        persona_txt.append(f"現在の動画制作状況: {persona['current_video_status']}")

                    # SNSアカウント情報
                    if 'sns_accounts' in persona:
                        sns_accounts = persona['sns_accounts']
                        if isinstance(sns_accounts, dict):
                            sns_list = []
                            for platform, info in sns_accounts.items():
                                if info and info != "なし":
                                    sns_list.append(f"{platform.capitalize()}: {info}")
                            if sns_list:
                                persona_txt.append("SNSアカウント:")
                                for sns_info in sns_list:
                                    persona_txt.append(f"  - {sns_info}")

                    # ペインポイント
                    if 'pain_points' in persona:
                        pain_points = persona['pain_points']
                        if pain_points and isinstance(pain_points, list):
                            persona_txt.append("ペインポイント:")
                            for pain in pain_points[:5]:  # 最大5件表示
                                persona_txt.append(f"  • {pain}")

                    # 予算感
                    if 'budget_sense' in persona:
                        persona_txt.append(f"予算感: {persona['budget_sense']}")

                    # シーン別の状況設定
                    if 'tone' in persona:
                        persona_txt.append(f"トーン・態度: {persona['tone']}")
                    if 'relationship' in persona:
                        persona_txt.append(f"営業との関係性: {persona['relationship']}")
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
                elif not is_first_message:
                    # 🎯 文脈理解改善: 会話ターン数に応じた態度調整
                    conversation_turn = len(conversation_history) // 2  # 往復数を計算

                    # 会話継続中も、ペルソナの重要情報を含める（一貫性を保つため）
                    # 会話履歴から最初のメッセージでどのペルソナが選ばれたかを推測
                    # または、セッション情報からペルソナを取得する必要がある
                    # 暫定的に、会話継続中は一貫性を強調する指示のみ追加
                    system_prompt += "\n\n【重要：会話継続中】\n"
                    system_prompt += "- あなたは既に会話を開始しています\n"
                    system_prompt += "- 必ず過去の会話で話した以下の内容と完全に一貫性を保ってください：\n"
                    system_prompt += "  • 業種・事業内容（変更不可）\n"
                    system_prompt += "  • 現在の動画制作状況（変更不可）\n"
                    system_prompt += "  • 主な課題・ペインポイント（変更不可）\n"
                    system_prompt += "  • SNSアカウント情報（変更不可）\n"
                    system_prompt += "- 【過去の実例パターン】の業種は無視し、あなたが最初に話した設定を使い続けてください\n"
                    system_prompt += "- 例: 「外注している」と言った場合、「外注を検討している」と言ってはいけません\n"
                    system_prompt += "- 例: 「月10本外注中」と言った場合、「本数が増えない」と矛盾することは言わないでください\n"

                    # 🎯 会話進行度に応じた態度変化（段階的な信頼構築）
                    system_prompt += f"\n【会話の進行度: {conversation_turn}往復目】\n"
                    if conversation_turn <= 2:
                        system_prompt += "- 態度: まだ警戒的で慎重（初対面の段階）\n"
                        system_prompt += "- 具体的な情報開示は控えめに\n"
                        system_prompt += "- 営業の質問には簡潔に答える\n"
                    elif conversation_turn <= 5:
                        system_prompt += "- 態度: 少しずつ心を開き始める（信頼構築の段階）\n"
                        system_prompt += "- 営業が良い質問をした場合は、より詳細に答える\n"
                        system_prompt += "- 自社の課題について少しずつ話す\n"
                    elif conversation_turn <= 8:
                        system_prompt += "- 態度: 興味を持ち始め、積極的に質問する（検討段階）\n"
                        system_prompt += "- サービスの具体的な内容や効果について質問する\n"
                        system_prompt += "- 自社の課題と営業の提案の関連性を確認する\n"
                    else:
                        system_prompt += "- 態度: 前向きに検討、具体的な条件を確認（決断段階）\n"
                        system_prompt += "- 予算、期間、サポート体制などの具体的な条件を質問\n"
                        system_prompt += "- 営業の提案が良ければ前向きなサインを出す\n"

                # RAG検索: 実際のロープレデータから類似パターンを取得（リアルな応答のため）
                try:
                    if RAG_INDEX and RAG_METADATA:
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

                        # top_k=5（応答速度重視で削減：15→5）
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
                                if pattern_text and len(pattern_text) < 500:  # より詳細なパターンを許容
                                    # 顧客側の発言のみを抽出（営業側の発言を除外）
                                    customer_lines = []
                                    for line in pattern_text.split('\n'):
                                        if line.strip().startswith('顧客:'):
                                            customer_lines.append(line.strip())

                                    if customer_lines:
                                        customer_only_text = '\n'.join(customer_lines)
                                        rag_patterns.append(f"- {customer_only_text[:300]}")  # 300文字まで（リアル感を保つ）
                                        pattern_count += 1
                                        logger.debug(f"[RAG採用] パターン{pattern_count} (類似度距離: {similarity:.3f})")
                                        if pattern_count >= 3:  # 応答速度重視で削減（7→3）
                                            break

                            if rag_patterns:
                                rag_context = "\n\n【⭐ 重要：実際のロープレパターン（参考例）】\n"
                                rag_context += "⚠️ 重要: 以下はあくまで会話の「トーン」や「応答スタイル」の参考例です。\n"
                                rag_context += "⚠️ 業種や事業内容は【シナリオ設定】で指定されたペルソナ情報に必ず従ってください。\n"
                                rag_context += "⚠️ 実例パターンに含まれる業種（クリーニング、音楽など）は無視し、必ずペルソナの業種で応答してください。\n\n"
                                rag_context += "以下は実際の顧客の応答例です。これらの口調、表現、フィラー（「えーと」「あのー」「そうですね...」など）、間（「...」）を参考にしてください：\n\n"
                                rag_context += "\n".join(rag_patterns)
                                rag_context += "\n\n【応答時の注意】\n"
                                rag_context += "- 上記のパターンと同じような口調・言い回しを参考にすること（業種は除く）\n"
                                rag_context += "- フィラー（「えーと」「あのー」「そうですね...」）を適度に入れること\n"
                                rag_context += "- 間（「...」）を使って考えている様子を表現すること\n"
                                rag_context += "- 必ず【シナリオ設定】のペルソナ情報（業種、事業内容、課題）に基づいて応答すること"
                                system_prompt += rag_context
                                logger.debug(f"[RAG強化] {len(rag_patterns)}個の顧客応答パターンを参照（口調・表現を積極活用）")
                except Exception as e:
                    logger.debug(f"[RAG] 検索エラー（続行）: {e}")
                    # エラーでも続行

                # メッセージ履歴構築（直近10件：会話の一貫性を保つ）
                logger.debug(f"[会話履歴デバッグ] 受信した履歴件数: {len(conversation_history)}")
                for i, msg in enumerate(conversation_history[-10:]):
                    logger.debug(f"  履歴[{i}] {msg.get('speaker', '不明')}: {msg.get('text', '')[:50]}...")

                messages = [{"role": "system", "content": system_prompt}]

                # 🎯 文脈理解改善: 会話履歴（応答速度とのバランス：20→15件）
                for msg in conversation_history[-15:]:  # 最新15件まで（速度重視）
                    if msg['speaker'] == '営業':
                        messages.append({"role": "user", "content": msg['text']})
                    elif msg['speaker'] == '顧客':
                        messages.append({"role": "assistant", "content": msg['text']})

                messages.append({"role": "user", "content": user_message})
                logger.debug(f"[会話履歴デバッグ] GPTに送るメッセージ数: {len(messages)} (system込み)")

                # GPT-4o-miniストリーミング応答（超高速＋自然な会話）
                # 日本語での応答を強制するため、messagesに追加の指示を挿入
                messages.append({
                    "role": "system",
                    "content": "🚨 重要リマインダー: この会話は100%日本語で行ってください。英語は一切使用しないでください。"
                })

                print("[DEBUG-GENERATE] GPT-4o-mini呼び出し開始（max_tokens=150）", flush=True)
                logger.info("[ストリーミング開始] GPT-4o-mini応答生成開始（max_tokens=150）")
                response = openai_client.chat.completions.create(
                    model="gpt-4o-mini",    # 高速モデル（会話のテンポ重視）
                    messages=messages,
                    max_tokens=150,         # 会話が途中で切れないように十分な長さを確保
                    temperature=0.6,        # バランス調整: 0.5→0.6（自然さ維持）
                    presence_penalty=0.3,   # 新しいトピックを促進
                    frequency_penalty=0.3,  # 繰り返しを減らす
                    stream=True  # ストリーミング有効化
                )
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
                for chunk in response:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        text_buffer += content
                        token_count += 1

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
            except Exception as e:
                # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
                logger.exception(f"チャットストリーム - 予期しないエラー: {type(e).__name__}: {e}")
                yield f"data: {json.dumps({'error': '応答生成中にエラーが発生しました。もう一度お試しください'})}\n\n"

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
@apply_rate_limit("3 per minute")  # GPT-4評価生成（コスト高）のためレート制限
def evaluate_conversation():
    try:
        data = request.get_json()
        conversation = data.get('conversation', [])
        scenario_id = data.get('scenario_id')  # シナリオIDを取得

        # 入力値検証
        if len(conversation) > MAX_HISTORY_LENGTH:
            logger.warning(f"評価対象会話が長すぎます: {len(conversation)}件 (最大{MAX_HISTORY_LENGTH}件)")
            return jsonify({
                'success': False,
                'error': f'会話が長すぎます（最大{MAX_HISTORY_LENGTH}件）'
            }), 400

        # 営業の発言のみを抽出
        sales_utterances = [msg['text'] for msg in conversation if msg['speaker'] == '営業']

        if not sales_utterances:
            return jsonify({
                'success': False,
                'error': '営業の発言が見つかりません'
            }), 400

        # 講評生成（Week 5改善版: シナリオ別Few-shot対応）
        evaluation = generate_evaluation_with_gpt4(sales_utterances, scenario_id)

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
        logger.error(f"評価生成 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': '評価生成中にエラーが発生しました。もう一度お試しください'
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

        # GPT-4で評価を生成（Few-shot対応・具体的な講評生成）
        evaluation_prompt = f"""
        あなたはショート動画制作営業のプロフェッショナルコーチです。以下の営業の発言を分析して、具体的で実践的な評価を提供してください。

        {scenario_context}
        【営業の発言】
        {sales_text}

        【評価項目】（5点満点で評価）
        {rubric_description}

        【点数基準】
        5点: 非常に優れている（プロレベル、模範的）
        4点: 優れている（十分なスキル、わずかな改善余地）
        3点: 平均的（基本はできているが、改善の余地あり）
        2点: 要改善（基本スキルが不足、重要な改善点あり）
        1点: 大幅な改善が必要（スキルがほとんど発揮されていない）

        {few_shot_examples}

        【重要な評価指針】
        1. **良かった点**は具体的な発言を引用して評価する
           例: 「『どのような課題をお持ちですか？』というオープンクエスチョンで、顧客のニーズを幅広く聞き出せています」

        2. **改善点**も具体的な発言を引用し、どう改善すべきか明示する
           例: 「『うちのサービスは月5万円です』と価格を先に提示していますが、まず顧客の予算感をヒアリングしてから提案すると効果的です」

        3. **会話の流れ**を時系列で分析する（挨拶→ヒアリング→提案→クロージング）

        4. **評価は厳しく、具体的に**（曖昧な褒め言葉は避ける）

        上記の指針に従って、以下のJSON形式で評価を出力してください：
        {{
            "scores": {{
                "questioning": 数値（1-5）,
                "listening": 数値（1-5）,
                "proposing": 数値（1-5）,
                "closing": 数値（1-5）,
                "total": 数値（4項目の合計）
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
            "overall": "総合評価（全体の印象と次回への具体的なアドバイス。100-200文字程度）",
            "analysis": {{
                "questions_count": 数値,
                "listening_responses_count": 数値,
                "proposals_count": 数値,
                "closings_count": 数値,
                "conversation_flow": "会話の流れの分析（挨拶→ヒアリング→提案→クロージングのどの段階まで進んだか）"
            }}
        }}

        【注意】
        - strengths（良かった点）には最低3項目、最大5項目を記載
        - improvements（改善点）には最低3項目、最大5項目を記載
        - 各項目は具体的な発言を引用し、「なぜ良い/悪い」「どう改善すべき」を明記
        - 評価は実践的で、次回のロープレで即実行できる内容にする
        """
        
        response = openai_client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": """あなたはショート動画制作営業のプロフェッショナルコーチです。
10年以上の営業経験を持ち、1000件以上のロープレを評価してきました。
営業の発言を詳細に分析し、具体的な発言を引用しながら、実践的で的確な評価を提供してください。
良かった点と改善点を明確に分け、次回のロープレで即実行できる具体的なアドバイスを心がけてください。"""},
                {"role": "user", "content": evaluation_prompt}
            ],
            max_tokens=1500,  # より詳細な評価のため増量
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
            # JSON解析に失敗した場合はフォールバック
            return generate_evaluation_fallback(sales_utterances)
            
    except Exception as e:
        logger.error(f"GPT-4評価エラー: {e}")
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
    
    # フロントエンド互換性のため、strengths と improvements を追加
    strengths = []
    improvements = []

    # commentsから良かった点を抽出
    if comments:
        for comment in comments:
            if '✅' in comment or '👍' in comment or '⭐' in comment or '良い' in comment or '優秀' in comment:
                strengths.append(comment)
            else:
                improvements.append(comment)

    # improvement_suggestionsをimprovementsに追加
    if improvement_suggestions:
        improvements.extend(improvement_suggestions)

    # 最低限のコメントを保証
    if not strengths:
        strengths = [overall_comment if overall_comment else "評価を実施しました。"]

    if not improvements:
        improvements = ["さらなる向上のため、継続的な練習を心がけましょう。"]

    return {
        'scores': {
            'questioning': round(questioning_score, 1),
            'listening': round(listening_score, 1),
            'proposing': round(proposing_score, 1),
            'closing': round(closing_score, 1),
            'total': round(total_score, 1)
        },
        'overall': overall_comment,  # フロントエンドが期待するフィールド名
        'strengths': strengths,  # フロントエンドが期待するフィールド名
        'improvements': improvements,  # フロントエンドが期待するフィールド名
        'comments': comments,
        'overall_comment': overall_comment,  # 後方互換性のため維持
        'improvement_suggestions': improvement_suggestions,  # 後方互換性のため維持
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


# ========================================
# 録画アップロード・ダウンロード機能
# セッション32: 練習履歴から録画ダウンロード
# ========================================

@conversations_bp.route('/api/conversations/<conversation_id>/recording', methods=['POST'])
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

