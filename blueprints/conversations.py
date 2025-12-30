"""
会話・評価機能ブループリント
チャット応答、会話保存・取得、評価生成・保存などの機能を提供
"""
import logging
from datetime import datetime
from flask import Blueprint, jsonify, request

# ロガー取得
logger = logging.getLogger(__name__)

# Blueprintオブジェクト作成
conversations_bp = Blueprint('conversations', __name__)

# グローバル変数（init_blueprint()で初期化）
supabase_client = None


def init_blueprint(app):
    """
    ブループリント初期化
    app.pyから必要な設定やヘルパー関数を受け取る
    """
    global supabase_client

    supabase_client = app.config.get('supabase_client')


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
        logger.error(f"会話保存 - 予期しないエラー: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
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
        import traceback
        traceback.print_exc()
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
            import traceback
            traceback.print_exc()
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
            import traceback
            traceback.print_exc()
            return jsonify({'success': False, 'error': '評価の保存中にエラーが発生しました'}), 500
