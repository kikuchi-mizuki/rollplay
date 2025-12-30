"""
データ管理エンドポイント（会話履歴・評価）のテスト
"""
import pytest
import json
from unittest.mock import Mock, patch, MagicMock
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


class TestScenarioDetailEndpoint:
    """個別シナリオ取得エンドポイントのテスト"""

    def test_get_scenario_by_id_success(self, client):
        """IDを指定してシナリオ詳細を取得"""
        response = client.get('/api/scenarios/meeting_1st')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'scenario' in data
        assert data['scenario']['id'] == 'meeting_1st'

    def test_get_scenario_nonexistent_id(self, client):
        """存在しないシナリオIDでエラー"""
        response = client.get('/api/scenarios/nonexistent_scenario')

        assert response.status_code in [404, 500]
        data = response.get_json()
        assert data['success'] is False


class TestClearCacheEndpoint:
    """キャッシュクリアエンドポイントのテスト"""

    def test_clear_cache_success(self, client):
        """キャッシュをクリア"""
        response = client.post('/api/clear-cache')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'message' in data
