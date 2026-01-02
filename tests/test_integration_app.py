"""
app.py統合テスト
動画取り込み機能などのapp.pyエンドポイントをテスト
"""
import pytest
import os
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


@pytest.mark.integration
class TestIngestEndpoint:
    """動画取り込みエンドポイントのテスト"""

    @patch('app.load_scenarios_index')
    @patch('subprocess.run')
    @patch('os.path.exists', return_value=True)
    def test_ingest_success(self, mock_exists, mock_subprocess, mock_load_scenarios, client):
        """動画取り込み成功ケース"""
        # サブプロセス実行結果をモック
        mock_result = Mock()
        mock_result.stdout = """
動画取り込み完了
作成シナリオ数: 5
RAGアイテム数: 120
"""
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        response = client.post('/ingest')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert data['scenarios_created'] == 5
        assert data['rag_items'] == 120
        assert mock_load_scenarios.called

    @patch('os.path.exists', return_value=False)
    def test_ingest_script_not_found(self, mock_exists, client):
        """取り込みスクリプトが見つからない場合"""
        response = client.post('/ingest')

        assert response.status_code == 404
        data = response.get_json()
        assert data['success'] is False
        assert '見つかりません' in data['error']

    @patch('app.load_scenarios_index')
    @patch('subprocess.run')
    @patch('os.path.exists', return_value=True)
    def test_ingest_subprocess_error(self, mock_exists, mock_subprocess, mock_load_scenarios, client):
        """サブプロセス実行エラー"""
        mock_subprocess.side_effect = OSError("プロセス実行失敗")

        response = client.post('/ingest')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'スクリプトの実行に失敗' in data['error']

    @patch('app.load_scenarios_index')
    @patch('subprocess.run')
    @patch('os.path.exists', return_value=True)
    def test_ingest_output_parsing_error(self, mock_exists, mock_subprocess, mock_load_scenarios, client):
        """出力解析エラー（数値変換失敗）"""
        # 不正な出力形式
        mock_result = Mock()
        mock_result.stdout = "作成シナリオ数: invalid_number"
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        # int()変換時にValueErrorが発生するようにする
        with patch('builtins.int', side_effect=ValueError("invalid literal")):
            response = client.post('/ingest')

            assert response.status_code == 500
            data = response.get_json()
            assert data['success'] is False
            assert '出力形式が不正' in data['error']

    @patch('app.load_scenarios_index')
    @patch('subprocess.run')
    @patch('os.path.exists', return_value=True)
    def test_ingest_unexpected_error(self, mock_exists, mock_subprocess, mock_load_scenarios, client):
        """予期しないエラー"""
        mock_subprocess.side_effect = Exception("予期しないエラー")

        response = client.post('/ingest')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'エラーが発生' in data['error']

    @patch('app.load_scenarios_index')
    @patch('subprocess.run')
    @patch('os.path.exists', return_value=True)
    def test_ingest_with_no_numbers(self, mock_exists, mock_subprocess, mock_load_scenarios, client):
        """数値情報なしの出力"""
        mock_result = Mock()
        mock_result.stdout = "処理完了"
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        response = client.post('/ingest')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert data['scenarios_created'] == 0
        assert data['rag_items'] == 0

    @patch('app.load_scenarios_index')
    @patch('subprocess.run')
    @patch('os.path.exists', return_value=True)
    def test_ingest_file_not_found_error(self, mock_exists, mock_subprocess, mock_load_scenarios, client):
        """FileNotFoundError発生時の処理"""
        mock_subprocess.side_effect = FileNotFoundError("依存ファイルが見つかりません")

        response = client.post('/ingest')

        assert response.status_code == 404
        data = response.get_json()
        assert data['success'] is False
        assert '必要なファイルが見つかりません' in data['error']

    @patch('app.load_scenarios_index')
    @patch('subprocess.run')
    @patch('os.path.exists', return_value=True)
    def test_ingest_get_method(self, mock_exists, mock_subprocess, mock_load_scenarios, client):
        """GETメソッドでもアクセス可能"""
        mock_result = Mock()
        mock_result.stdout = "作成シナリオ数: 3"
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        response = client.get('/ingest')

        # GETメソッドも許可されている
        assert response.status_code == 200
