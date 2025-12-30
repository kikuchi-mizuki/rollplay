"""
scenarios.py (シナリオ管理) のユニットテスト
シナリオ一覧取得・詳細取得などの機能をテスト
"""
import pytest
import json
from unittest.mock import Mock, patch, mock_open
from flask import Flask


@pytest.fixture
def app():
    """テスト用Flaskアプリケーション"""
    from app import app as flask_app
    flask_app.config['TESTING'] = True
    return flask_app


@pytest.fixture
def client(app):
    """テスト用クライアント"""
    return app.test_client()


class TestGetScenarios:
    """シナリオ一覧取得のテスト"""

    @patch('blueprints.scenarios.SCENARIOS_INDEX_PATH', '/fake/scenarios/index.json')
    @patch('builtins.open', new_callable=mock_open, read_data='{"scenarios": [{"id": "meeting_1st", "name": "初回面談"}], "default_id": "meeting_1st"}')
    def test_get_scenarios_success(self, mock_file, client):
        """シナリオ一覧取得の成功ケース"""
        response = client.get('/api/scenarios')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'scenarios' in data
        assert len(data['scenarios']) == 1
        assert data['default_id'] == 'meeting_1st'

    @patch('blueprints.scenarios.SCENARIOS_INDEX_PATH', '/fake/scenarios/index.json')
    @patch('builtins.open', side_effect=FileNotFoundError())
    def test_get_scenarios_file_not_found(self, mock_file, client):
        """シナリオインデックスファイルが見つからない場合"""
        response = client.get('/api/scenarios')

        assert response.status_code == 404
        data = response.get_json()
        assert data['success'] is False
        assert 'シナリオデータが見つかりませんでした' in data['error']

    @patch('blueprints.scenarios.SCENARIOS_INDEX_PATH', '/fake/scenarios/index.json')
    @patch('builtins.open', new_callable=mock_open, read_data='invalid json')
    def test_get_scenarios_json_decode_error(self, mock_file, client):
        """JSON解析エラーの場合"""
        response = client.get('/api/scenarios')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'シナリオデータの形式が不正です' in data['error']

    @patch('blueprints.scenarios.SCENARIOS_INDEX_PATH', '/fake/scenarios/index.json')
    @patch('builtins.open', side_effect=OSError('File read error'))
    def test_get_scenarios_os_error(self, mock_file, client):
        """ファイル読み込みエラーの場合"""
        response = client.get('/api/scenarios')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'シナリオデータの読み込みに失敗しました' in data['error']

    @patch('blueprints.scenarios.SCENARIOS_INDEX_PATH', '/fake/scenarios/index.json')
    @patch('builtins.open', side_effect=Exception('Unexpected error'))
    def test_get_scenarios_unexpected_error(self, mock_file, client):
        """予期しないエラーの場合"""
        response = client.get('/api/scenarios')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'シナリオ一覧の取得に失敗しました' in data['error']


class TestGetScenario:
    """シナリオ詳細取得のテスト"""

    @patch('blueprints.scenarios.load_scenario_object')
    def test_get_scenario_success(self, mock_load, client):
        """シナリオ詳細取得の成功ケース"""
        mock_load.return_value = {
            'id': 'meeting_1st',
            'name': '初回面談',
            'description': 'テストシナリオ',
            'scenes': {'scene_1': {'description': 'テストシーン'}}
        }

        response = client.get('/api/scenarios/meeting_1st')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'scenario' in data
        assert data['scenario']['id'] == 'meeting_1st'

    @patch('blueprints.scenarios.load_scenario_object')
    def test_get_scenario_not_found(self, mock_load, client):
        """シナリオが見つからない場合"""
        mock_load.return_value = None

        response = client.get('/api/scenarios/nonexistent')

        assert response.status_code == 404
        data = response.get_json()
        assert data['success'] is False
        assert 'シナリオが見つかりません' in data['error']

    @patch('blueprints.scenarios.load_scenario_object')
    def test_get_scenario_file_not_found(self, mock_load, client):
        """シナリオファイルが見つからない場合"""
        mock_load.side_effect = FileNotFoundError()

        response = client.get('/api/scenarios/missing_scenario')

        assert response.status_code == 404
        data = response.get_json()
        assert data['success'] is False
        assert 'が見つかりませんでした' in data['error']

    @patch('blueprints.scenarios.load_scenario_object')
    def test_get_scenario_json_decode_error(self, mock_load, client):
        """JSON解析エラーの場合"""
        mock_load.side_effect = json.JSONDecodeError('Invalid JSON', '', 0)

        response = client.get('/api/scenarios/invalid_json')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'シナリオデータの形式が不正です' in data['error']

    @patch('blueprints.scenarios.load_scenario_object')
    def test_get_scenario_os_error(self, mock_load, client):
        """ファイル読み込みエラーの場合"""
        mock_load.side_effect = OSError('File read error')

        response = client.get('/api/scenarios/error_scenario')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'シナリオデータの読み込みに失敗しました' in data['error']

    @patch('blueprints.scenarios.load_scenario_object')
    def test_get_scenario_unexpected_error(self, mock_load, client):
        """予期しないエラーの場合"""
        mock_load.side_effect = Exception('Unexpected error')

        response = client.get('/api/scenarios/error_scenario')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'シナリオの取得に失敗しました' in data['error']


class TestInitBlueprint:
    """ブループリント初期化のテスト"""

    def test_init_blueprint(self, app):
        """init_blueprint関数のテスト"""
        from blueprints.scenarios import init_blueprint

        # 初期化を呼ぶ
        init_blueprint(app)

        # グローバル変数が設定される
        from blueprints.scenarios import SCENARIOS_INDEX_PATH, load_scenario_object
        assert SCENARIOS_INDEX_PATH is not None
        assert load_scenario_object is not None


class TestEdgeCases:
    """エッジケースのテスト"""

    @patch('blueprints.scenarios.SCENARIOS_INDEX_PATH', '/fake/scenarios/index.json')
    @patch('builtins.open', new_callable=mock_open, read_data='{"scenarios": [], "default_id": null}')
    def test_get_scenarios_empty_list(self, mock_file, client):
        """シナリオが0件の場合"""
        response = client.get('/api/scenarios')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert len(data['scenarios']) == 0

    @patch('blueprints.scenarios.SCENARIOS_INDEX_PATH', '/fake/scenarios/index.json')
    @patch('builtins.open', new_callable=mock_open, read_data='{}')
    def test_get_scenarios_no_scenarios_key(self, mock_file, client):
        """scenariosキーがない場合"""
        response = client.get('/api/scenarios')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        # キーがない場合は空リストが返る
        assert data['scenarios'] == []
