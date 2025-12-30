"""
管理者機能ブループリント
店舗統計、ランキング、CSVエクスポートなど管理者専用機能を提供
"""
import io
import csv
import logging
from flask import Blueprint, jsonify, request

# ロガー取得
logger = logging.getLogger(__name__)

# Blueprintオブジェクト作成
admin_bp = Blueprint('admin', __name__)

# グローバル変数（init_blueprint()で初期化）
supabase_client = None


def init_blueprint(app):
    """
    ブループリント初期化
    app.pyから必要な設定やヘルパー関数を受け取る
    """
    global supabase_client

    supabase_client = app.config.get('supabase_client')


@admin_bp.route('/api/admin/stores/stats', methods=['GET'])
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

    except ZeroDivisionError as e:
        # スコア平均計算でゼロ除算
        logger.error(f"店舗統計取得 - スコア計算エラー: {e}")
        return jsonify({
            'success': False,
            'error': 'スコアデータの計算中にエラーが発生しました'
        }), 500
    except Exception as e:
        # データベースエラーまたは予期しないエラー
        logger.exception(f"店舗統計取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': '店舗統計の取得に失敗しました'
        }), 500


@admin_bp.route('/api/admin/stores/rankings', methods=['GET'])
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

    except KeyError as e:
        # 必要なフィールドが欠落
        logger.error(f"店舗ランキング取得 - データフィールドが欠落: {e}")
        return jsonify({
            'success': False,
            'error': 'データの形式が不正です'
        }), 500
    except ZeroDivisionError as e:
        # 平均スコア計算でゼロ除算
        logger.error(f"店舗ランキング取得 - スコア計算エラー: {e}")
        return jsonify({
            'success': False,
            'error': 'スコアデータの計算中にエラーが発生しました'
        }), 500
    except Exception as e:
        # データベースエラーまたは予期しないエラー
        logger.exception(f"店舗ランキング取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': '店舗ランキングの取得に失敗しました'
        }), 500


@admin_bp.route('/api/stores/<store_id>/members', methods=['GET'])
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

    except ValueError as e:
        # 不正な店舗ID
        logger.error(f"店舗メンバー取得 - 不正な店舗ID: {store_id}, {e}")
        return jsonify({
            'success': False,
            'error': '店舗IDの形式が不正です'
        }), 400
    except KeyError as e:
        # 必要なフィールドが欠落
        logger.error(f"店舗メンバー取得 - データフィールドが欠落: {e}")
        return jsonify({
            'success': False,
            'error': 'データの形式が不正です'
        }), 500
    except ZeroDivisionError as e:
        # 平均スコア計算でゼロ除算
        logger.error(f"店舗メンバー取得 - スコア計算エラー: {e}")
        return jsonify({
            'success': False,
            'error': 'スコアデータの計算中にエラーが発生しました'
        }), 500
    except Exception as e:
        # データベースエラーまたは予期しないエラー
        logger.exception(f"店舗メンバー取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': '店舗メンバー情報の取得に失敗しました'
        }), 500


@admin_bp.route('/api/admin/regions/stats', methods=['GET'])
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

    except KeyError as e:
        # 必要なフィールドが欠落
        logger.error(f"リージョン統計取得 - データフィールドが欠落: {e}")
        return jsonify({
            'success': False,
            'error': 'データの形式が不正です'
        }), 500
    except ZeroDivisionError as e:
        # 平均スコア計算でゼロ除算
        logger.error(f"リージョン統計取得 - スコア計算エラー: {e}")
        return jsonify({
            'success': False,
            'error': 'スコアデータの計算中にエラーが発生しました'
        }), 500
    except Exception as e:
        # データベースエラーまたは予期しないエラー
        logger.exception(f"リージョン統計取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': 'リージョン統計の取得に失敗しました'
        }), 500


@admin_bp.route('/api/stores/<store_id>/analytics', methods=['GET'])
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
        # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
        logger.exception(f"データエクスポート - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({'success': False, 'error': 'データのエクスポート中にエラーが発生しました'}), 500


@admin_bp.route('/api/admin/export/evaluations', methods=['GET'])
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

    except KeyError as e:
        # 必要なフィールドが欠落
        logger.error(f"評価エクスポート - データフィールドが欠落: {e}")
        return jsonify({
            'success': False,
            'error': 'データの形式が不正です'
        }), 500
    except OSError as e:
        # ファイル操作エラー
        logger.error(f"評価エクスポート - ファイル操作エラー: {e}")
        return jsonify({
            'success': False,
            'error': 'CSVファイルの生成に失敗しました'
        }), 500
    except Exception as e:
        # データベースエラーまたは予期しないエラー
        logger.exception(f"評価エクスポート - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': '評価データのエクスポートに失敗しました'
        }), 500


@admin_bp.route('/api/admin/export/stores', methods=['GET'])
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
        # 予期しないエラー：詳細をログに記録、ユーザーには一般的なメッセージ
        logger.exception(f"店舗ランキング取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({'success': False, 'error': '店舗ランキングの取得中にエラーが発生しました'}), 500
