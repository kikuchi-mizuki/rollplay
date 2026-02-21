"""
管理者機能ブループリント
店舗統計、ランキング、CSVエクスポートなど管理者専用機能を提供
"""
import io
import csv
import logging
from functools import wraps
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


def sanitize_csv_field(value):
    """
    CSVインジェクション対策
    数式として実行される可能性のある文字で始まる値をエスケープ
    """
    if value is None:
        return ''

    value_str = str(value)

    # 数式インジェクション対策：=, +, -, @, タブ, 改行で始まる場合はシングルクォートを追加
    if value_str and value_str[0] in ('=', '+', '-', '@', '\t', '\r', '\n'):
        return "'" + value_str

    return value_str


def require_admin(f):
    """
    管理者権限を要求するデコレータ
    リクエストヘッダーのAuthorizationトークンを検証し、管理者権限をチェック
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Authorizationヘッダーをチェック
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            logger.warning('認証失敗: Authorizationヘッダーがありません')
            return jsonify({'success': False, 'error': '認証が必要です'}), 401

        token = auth_header.replace('Bearer ', '')

        try:
            # Supabaseでトークンを検証してユーザー情報を取得
            user_response = supabase_client.auth.get_user(token)

            if not user_response or not user_response.user:
                logger.warning('認証失敗: 無効なトークン')
                return jsonify({'success': False, 'error': '無効な認証トークンです'}), 401

            user_id = user_response.user.id

            # プロフィールから権限を取得
            profile_result = supabase_client.table('profiles').select('role').eq('id', user_id).single().execute()

            if not profile_result.data:
                logger.warning(f'認証失敗: プロフィールが見つかりません (user_id={user_id})')
                return jsonify({'success': False, 'error': 'ユーザープロフィールが見つかりません'}), 404

            user_role = profile_result.data.get('role')

            # 管理者権限をチェック
            if user_role != 'admin':
                logger.warning(f'権限不足: user_id={user_id}, role={user_role}')
                return jsonify({'success': False, 'error': '管理者権限が必要です'}), 403

            # リクエストにユーザーIDを追加（エンドポイント内で使用可能）
            request.user_id = user_id
            request.user_role = user_role

            logger.info(f'管理者認証成功: user_id={user_id}')
            return f(*args, **kwargs)

        except Exception as e:
            logger.error(f'認証エラー: {type(e).__name__}: {e}')
            return jsonify({'success': False, 'error': '認証処理でエラーが発生しました'}), 500

    return decorated_function


@admin_bp.route('/api/admin/stores/stats', methods=['GET'])
@require_admin
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
@require_admin
def get_stores_rankings():
    """店舗別ランキングを取得（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # 全店舗取得
        stores_result = supabase_client.table('stores').select('*').execute()
        stores = stores_result.data if stores_result.data else []

        # 全店舗のプロファイル、会話、評価を一括取得（N+1クエリを回避）
        all_profiles = supabase_client.table('profiles').select('id, store_id').execute()
        all_conversations = supabase_client.table('conversations').select('id, store_id').execute()
        all_evaluations = supabase_client.table('evaluations').select('store_id, average_score').execute()

        # 店舗IDごとに集計
        profiles_by_store = {}
        conversations_by_store = {}
        evaluations_by_store = {}

        for profile in (all_profiles.data or []):
            store_id = profile.get('store_id')
            if store_id:
                profiles_by_store[store_id] = profiles_by_store.get(store_id, 0) + 1

        for conversation in (all_conversations.data or []):
            store_id = conversation.get('store_id')
            if store_id:
                conversations_by_store[store_id] = conversations_by_store.get(store_id, 0) + 1

        for evaluation in (all_evaluations.data or []):
            store_id = evaluation.get('store_id')
            if store_id:
                if store_id not in evaluations_by_store:
                    evaluations_by_store[store_id] = []
                evaluations_by_store[store_id].append(evaluation['average_score'])

        rankings = []
        for store in stores:
            store_id = store['id']

            # 集計データから取得
            user_count = profiles_by_store.get(store_id, 0)
            conversation_count = conversations_by_store.get(store_id, 0)
            evaluations = evaluations_by_store.get(store_id, [])
            avg_score = sum(evaluations) / len(evaluations) if evaluations else 0

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
@require_admin
def get_store_members(store_id):
    """店舗メンバー一覧を取得（店舗管理者・本部管理者）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # メンバー取得
        profiles_result = supabase_client.table('profiles').select('*').eq('store_id', store_id).execute()
        members = profiles_result.data if profiles_result.data else []

        # N+1クエリ問題の解決: 全メンバーの統計データを一度に取得
        user_ids = [member['id'] for member in members]

        if user_ids:
            # 全メンバーの会話数を一度に取得
            conversations_result = supabase_client.table('conversations').select('id,user_id').in_('user_id', user_ids).execute()
            conversations_by_user = {}
            for conv in (conversations_result.data or []):
                user_id = conv['user_id']
                conversations_by_user[user_id] = conversations_by_user.get(user_id, 0) + 1

            # 全メンバーの評価データを一度に取得
            evaluations_result = supabase_client.table('evaluations').select('average_score,user_id').in_('user_id', user_ids).execute()
            evaluations_by_user = {}
            for eval in (evaluations_result.data or []):
                user_id = eval['user_id']
                if user_id not in evaluations_by_user:
                    evaluations_by_user[user_id] = []
                evaluations_by_user[user_id].append(eval['average_score'])

        # 各メンバーに統計情報を追加
        for member in members:
            user_id = member['id']
            member['conversation_count'] = conversations_by_user.get(user_id, 0) if user_ids else 0

            evaluations = evaluations_by_user.get(user_id, []) if user_ids else []
            member['average_score'] = round(sum(evaluations) / len(evaluations), 2) if evaluations else 0
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
@require_admin
def get_regions_stats():
    """リージョン別集計を取得（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # 全店舗取得
        stores_result = supabase_client.table('stores').select('*').execute()
        stores = stores_result.data if stores_result.data else []

        # N+1クエリ問題の解決: 全店舗のデータを一度に取得
        store_ids = [store['id'] for store in stores]

        # 全店舗のユーザー数を一度に取得
        profiles_result = supabase_client.table('profiles').select('id,store_id').in_('store_id', store_ids).execute()
        profiles_by_store = {}
        for profile in (profiles_result.data or []):
            store_id = profile['store_id']
            profiles_by_store[store_id] = profiles_by_store.get(store_id, 0) + 1

        # 全店舗の会話数を一度に取得
        conversations_result = supabase_client.table('conversations').select('id,store_id').in_('store_id', store_ids).execute()
        conversations_by_store = {}
        for conv in (conversations_result.data or []):
            store_id = conv['store_id']
            conversations_by_store[store_id] = conversations_by_store.get(store_id, 0) + 1

        # 全店舗の評価データを一度に取得
        evaluations_result = supabase_client.table('evaluations').select('average_score,store_id').in_('store_id', store_ids).execute()
        evaluations_by_store = {}
        for eval in (evaluations_result.data or []):
            store_id = eval['store_id']
            if store_id not in evaluations_by_store:
                evaluations_by_store[store_id] = []
            evaluations_by_store[store_id].append(eval['average_score'])

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

            # 事前取得したデータから統計情報を取得
            user_count = profiles_by_store.get(store_id, 0)
            conversation_count = conversations_by_store.get(store_id, 0)
            evaluations = evaluations_by_store.get(store_id, [])
            avg_score = sum(evaluations) / len(evaluations) if evaluations else 0

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
@require_admin
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
@require_admin
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
                sanitize_csv_field(evaluation.get('id', '')),
                sanitize_csv_field(store.get('store_code', '')),
                sanitize_csv_field(store.get('store_name', '')),
                sanitize_csv_field(store.get('region', '')),
                sanitize_csv_field(user.get('display_name', '')),
                sanitize_csv_field(evaluation.get('scenario_id', '')),
                sanitize_csv_field(scores.get('questioning_skill', 0)),
                sanitize_csv_field(scores.get('listening_skill', 0)),
                sanitize_csv_field(scores.get('proposal_skill', 0)),
                sanitize_csv_field(scores.get('closing_skill', 0)),
                sanitize_csv_field(evaluation.get('total_score', 0)),
                sanitize_csv_field(evaluation.get('average_score', 0)),
                sanitize_csv_field(evaluation.get('created_at', ''))
            ])

        # BOM付きUTF-8で返却（Excel互換）
        csv_data = '\ufeff' + output.getvalue()

        # ファイル名の日付部分を生成（最初の評価の日付、または"all"）
        date_suffix = evaluations[0].get("created_at", "").split("T")[0] if evaluations else "all"

        return csv_data, 200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': f'attachment; filename=evaluations_export_{date_suffix}.csv'
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


@admin_bp.route('/api/admin/online-users', methods=['GET'])
@require_admin
def get_online_users():
    """ログイン中のユーザー一覧を取得（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # オンライン判定時間（分）
        online_threshold_minutes = request.args.get('threshold', 5, type=int)

        # last_active_atが過去N分以内のユーザーを取得
        from datetime import datetime, timedelta
        threshold_time = datetime.utcnow() - timedelta(minutes=online_threshold_minutes)
        threshold_str = threshold_time.isoformat()

        # オンラインユーザー取得
        profiles_result = supabase_client.table('profiles').select('*').gte('last_active_at', threshold_str).order('last_active_at', desc=True).execute()
        online_users = profiles_result.data if profiles_result.data else []

        # 店舗情報を一括取得
        store_ids = list(set([user['store_id'] for user in online_users if user.get('store_id')]))
        stores_result = supabase_client.table('stores').select('*').in_('id', store_ids).execute()
        stores_dict = {store['id']: store for store in (stores_result.data or [])}

        # ユーザー情報に店舗情報を追加
        for user in online_users:
            store_id = user.get('store_id')
            if store_id and store_id in stores_dict:
                user['store_name'] = stores_dict[store_id].get('store_name')
                user['store_code'] = stores_dict[store_id].get('store_code')
                user['region'] = stores_dict[store_id].get('region')
            else:
                user['store_name'] = '未設定'
                user['store_code'] = '未設定'
                user['region'] = '未設定'

        return jsonify({
            'success': True,
            'online_users': online_users,
            'count': len(online_users),
            'threshold_minutes': online_threshold_minutes
        })

    except Exception as e:
        logger.exception(f"オンラインユーザー取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': 'オンラインユーザー情報の取得に失敗しました'
        }), 500


@admin_bp.route('/api/admin/users', methods=['GET'])
@require_admin
def get_all_users():
    """全ユーザー一覧を取得（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # パラメータ取得
        store_id = request.args.get('store_id')
        role = request.args.get('role')
        search = request.args.get('search')

        # 全ユーザー取得
        query = supabase_client.table('profiles').select('*')

        if store_id:
            query = query.eq('store_id', store_id)

        if role:
            query = query.eq('role', role)

        query = query.order('created_at', desc=True)
        profiles_result = query.execute()
        users = profiles_result.data if profiles_result.data else []

        # 検索フィルター（フロントエンドで処理するため、全データを返す）
        if search:
            search_lower = search.lower()
            users = [u for u in users if
                     search_lower in (u.get('display_name') or '').lower() or
                     search_lower in (u.get('email') or '').lower()]

        # 店舗情報を一括取得
        store_ids = list(set([user['store_id'] for user in users if user.get('store_id')]))
        stores_result = supabase_client.table('stores').select('*').in_('id', store_ids).execute()
        stores_dict = {store['id']: store for store in (stores_result.data or [])}

        # ユーザー情報に店舗情報を追加
        for user in users:
            store_id = user.get('store_id')
            if store_id and store_id in stores_dict:
                user['store_name'] = stores_dict[store_id].get('store_name')
                user['store_code'] = stores_dict[store_id].get('store_code')
                user['region'] = stores_dict[store_id].get('region')
            else:
                user['store_name'] = '未設定'
                user['store_code'] = '未設定'
                user['region'] = '未設定'

        return jsonify({
            'success': True,
            'users': users,
            'count': len(users)
        })

    except Exception as e:
        logger.exception(f"ユーザー一覧取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': 'ユーザー一覧の取得に失敗しました'
        }), 500


@admin_bp.route('/api/admin/users/<user_id>', methods=['DELETE'])
@require_admin
def delete_user(user_id):
    """ユーザーを削除（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        # ユーザー情報を取得（存在確認）
        user_result = supabase_client.table('profiles').select('*').eq('id', user_id).execute()
        if not user_result.data:
            return jsonify({'success': False, 'error': 'ユーザーが見つかりません'}), 404

        user = user_result.data[0]

        # auth.usersからユーザーを削除
        # CASCADE設定により、profiles, conversations, evaluationsも自動削除される
        try:
            # Supabase Admin APIを使用してauth.usersから削除
            supabase_client.auth.admin.delete_user(user_id)
            logger.info(f"ユーザー削除成功: {user_id} ({user.get('display_name')})")

            return jsonify({
                'success': True,
                'message': 'ユーザーを削除しました'
            })

        except AttributeError:
            # auth.adminが利用できない場合は、profilesから削除
            # （古いバージョンのSupabase SDKの場合）
            logger.warning(f"auth.admin APIが利用できません。profilesテーブルから削除します。")

            delete_result = supabase_client.table('profiles').delete().eq('id', user_id).execute()

            if delete_result.error:
                raise Exception(delete_result.error)

            logger.info(f"プロファイル削除成功: {user_id} ({user.get('display_name')})")

            return jsonify({
                'success': True,
                'message': 'ユーザーを削除しました'
            })

    except Exception as e:
        logger.exception(f"ユーザー削除 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': f'ユーザーの削除に失敗しました: {str(e)}'
        }), 500


@admin_bp.route('/api/admin/users/<user_id>/role', methods=['PUT'])
@require_admin
def update_user_role(user_id):
    """ユーザーの権限を変更（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        data = request.get_json()
        new_role = data.get('role')

        if new_role not in ['admin', 'manager', 'user']:
            return jsonify({'success': False, 'error': '不正な権限です'}), 400

        # 権限を更新
        update_result = supabase_client.table('profiles').update({
            'role': new_role
        }).eq('id', user_id).execute()

        if not update_result.data:
            return jsonify({'success': False, 'error': 'ユーザーが見つかりません'}), 404

        logger.info(f"ユーザー権限変更成功: {user_id} -> {new_role}")

        return jsonify({
            'success': True,
            'message': '権限を更新しました',
            'user': update_result.data[0]
        })

    except Exception as e:
        logger.exception(f"ユーザー権限変更 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': '権限の更新に失敗しました'
        }), 500


@admin_bp.route('/api/admin/users/<user_id>/store', methods=['PUT'])
@require_admin
def update_user_store(user_id):
    """ユーザーの所属店舗を変更（本部管理者専用）"""
    try:
        if not supabase_client:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500

        data = request.get_json()
        new_store_id = data.get('store_id')

        # 店舗の存在確認
        store_result = supabase_client.table('stores').select('store_code').eq('id', new_store_id).execute()
        if not store_result.data:
            return jsonify({'success': False, 'error': '指定された店舗が見つかりません'}), 404

        store_code = store_result.data[0]['store_code']

        # 店舗を更新
        update_result = supabase_client.table('profiles').update({
            'store_id': new_store_id,
            'store_code': store_code
        }).eq('id', user_id).execute()

        if not update_result.data:
            return jsonify({'success': False, 'error': 'ユーザーが見つかりません'}), 404

        logger.info(f"ユーザー店舗変更成功: {user_id} -> {new_store_id}")

        return jsonify({
            'success': True,
            'message': '所属店舗を更新しました',
            'user': update_result.data[0]
        })

    except Exception as e:
        logger.exception(f"ユーザー店舗変更 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': '所属店舗の更新に失敗しました'
        }), 500


@admin_bp.route('/api/admin/export/stores', methods=['GET'])
@require_admin
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

        # N+1クエリ問題の解決: 全店舗の統計データを一度に取得
        store_ids = [store['id'] for store in stores]

        # 全店舗のユーザー数を一度に取得
        profiles_result = supabase_client.table('profiles').select('id,store_id').in_('store_id', store_ids).execute()
        profiles_by_store = {}
        for profile in (profiles_result.data or []):
            store_id = profile['store_id']
            profiles_by_store[store_id] = profiles_by_store.get(store_id, 0) + 1

        # 全店舗の会話数を一度に取得
        conversations_result = supabase_client.table('conversations').select('id,store_id').in_('store_id', store_ids).execute()
        conversations_by_store = {}
        for conv in (conversations_result.data or []):
            store_id = conv['store_id']
            conversations_by_store[store_id] = conversations_by_store.get(store_id, 0) + 1

        # 全店舗の評価データを一度に取得
        evaluations_result = supabase_client.table('evaluations').select('average_score,store_id').in_('store_id', store_ids).execute()
        evaluations_by_store = {}
        for eval in (evaluations_result.data or []):
            store_id = eval['store_id']
            if store_id not in evaluations_by_store:
                evaluations_by_store[store_id] = []
            evaluations_by_store[store_id].append(eval['average_score'])

        # 各店舗に統計情報を設定
        for store in stores:
            store_id = store['id']
            store['user_count'] = profiles_by_store.get(store_id, 0)
            store['conversation_count'] = conversations_by_store.get(store_id, 0)

            evaluations = evaluations_by_store.get(store_id, [])
            store['evaluation_count'] = len(evaluations)
            store['average_score'] = round(sum(evaluations) / len(evaluations), 2) if evaluations else 0

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
                sanitize_csv_field(store.get('store_code', '')),
                sanitize_csv_field(store.get('store_name', '')),
                sanitize_csv_field(store.get('region', '')),
                sanitize_csv_field(store.get('status', '')),
                sanitize_csv_field(store.get('user_count', 0)),
                sanitize_csv_field(store.get('conversation_count', 0)),
                sanitize_csv_field(store.get('evaluation_count', 0)),
                sanitize_csv_field(store.get('average_score', 0)),
                sanitize_csv_field(store.get('created_at', ''))
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
