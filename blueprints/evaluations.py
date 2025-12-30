"""
評価機能ブループリント
講師評価、評価精度検証などの機能を提供
"""
import logging
from flask import Blueprint, jsonify, request

# ロガー取得
logger = logging.getLogger(__name__)

# Blueprintオブジェクト作成
evaluations_bp = Blueprint('evaluations', __name__)

# グローバル変数（init_blueprint()で初期化）
supabase_client = None


def init_blueprint(app):
    """
    ブループリント初期化
    app.pyから必要な設定やヘルパー関数を受け取る
    """
    global supabase_client

    supabase_client = app.config.get('supabase_client')


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


@evaluations_bp.route('/api/instructor-evaluations', methods=['POST'])
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
        # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
        logger.exception(f"インストラクター評価保存 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({'success': False, 'error': '評価の保存中にエラーが発生しました'}), 500


@evaluations_bp.route('/api/instructor-evaluations', methods=['GET'])
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
        # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
        logger.exception(f"インストラクター評価取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({'success': False, 'error': '評価データの取得中にエラーが発生しました'}), 500


@evaluations_bp.route('/api/evaluation-accuracy', methods=['GET'])
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
        # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
        logger.exception(f"評価精度レポート生成 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({'success': False, 'error': '評価精度レポートの生成中にエラーが発生しました'}), 500
