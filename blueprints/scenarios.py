"""
シナリオ管理ブループリント
シナリオの取得・管理に関するエンドポイントを提供
"""
import json
import logging
from flask import Blueprint, jsonify

# ロガー取得
logger = logging.getLogger(__name__)

# Blueprintオブジェクト作成
scenarios_bp = Blueprint('scenarios', __name__, url_prefix='/api/scenarios')


def init_blueprint(app):
    """
    ブループリント初期化
    app.pyから必要な設定やヘルパー関数を受け取る
    """
    global SCENARIOS_INDEX_PATH, load_scenario_object, SHARED_PERSONAS

    SCENARIOS_INDEX_PATH = app.config.get('SCENARIOS_INDEX_PATH')
    load_scenario_object = app.config.get('load_scenario_object')
    SHARED_PERSONAS = app.config.get('SHARED_PERSONAS', [])


@scenarios_bp.route('', methods=['GET'])
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
    except FileNotFoundError:
        # シナリオインデックスファイルが見つからない
        logger.error(f"シナリオ一覧取得 - ファイルが見つかりません: {SCENARIOS_INDEX_PATH}")
        return jsonify({
            'success': False,
            'error': 'シナリオデータが見つかりませんでした'
        }), 404
    except json.JSONDecodeError as e:
        # JSON解析エラー
        logger.error(f"シナリオ一覧取得 - JSON解析エラー: {e}")
        return jsonify({
            'success': False,
            'error': 'シナリオデータの形式が不正です'
        }), 500
    except OSError as e:
        # ファイル読み込みエラー
        logger.error(f"シナリオ一覧取得 - ファイル読み込みエラー: {e}")
        return jsonify({
            'success': False,
            'error': 'シナリオデータの読み込みに失敗しました'
        }), 500
    except Exception as e:
        # 予期しないエラー
        logger.exception(f"シナリオ一覧取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': 'シナリオ一覧の取得に失敗しました'
        }), 500


@scenarios_bp.route('/<scenario_id>', methods=['GET'])
def get_scenario(scenario_id):
    """シナリオ詳細を取得"""
    try:
        if not scenario_id:
            logger.warning("シナリオ詳細取得 - シナリオIDが空です")
            return jsonify({
                'success': False,
                'error': 'シナリオIDを指定してください'
            }), 400

        scenario_obj = load_scenario_object(scenario_id)
        if not scenario_obj:
            logger.warning(f"シナリオ詳細取得 - シナリオが見つかりません: {scenario_id}")
            return jsonify({
                'success': False,
                'error': f'シナリオが見つかりません: {scenario_id}'
            }), 404
        return jsonify({
            'success': True,
            'scenario': scenario_obj
        })
    except FileNotFoundError:
        # シナリオファイルが見つからない
        logger.error(f"シナリオ詳細取得 - ファイルが見つかりません: {scenario_id}")
        return jsonify({
            'success': False,
            'error': f'シナリオ「{scenario_id}」が見つかりませんでした'
        }), 404
    except json.JSONDecodeError as e:
        # JSON解析エラー
        logger.error(f"シナリオ詳細取得 - JSON解析エラー ({scenario_id}): {e}")
        return jsonify({
            'success': False,
            'error': 'シナリオデータの形式が不正です'
        }), 500
    except OSError as e:
        # ファイル読み込みエラー
        logger.error(f"シナリオ詳細取得 - ファイル読み込みエラー ({scenario_id}): {e}")
        return jsonify({
            'success': False,
            'error': 'シナリオデータの読み込みに失敗しました'
        }), 500
    except Exception as e:
        # 予期しないエラー
        logger.exception(f"シナリオ詳細取得 - 予期しないエラー ({scenario_id}): {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': 'シナリオの取得に失敗しました'
        }), 500


@scenarios_bp.route('/personas', methods=['GET'])
def get_personas():
    """ペルソナ一覧を取得"""
    try:
        return jsonify({
            'success': True,
            'personas': SHARED_PERSONAS
        })
    except Exception as e:
        # 予期しないエラー
        logger.exception(f"ペルソナ一覧取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': 'ペルソナ一覧の取得に失敗しました'
        }), 500
