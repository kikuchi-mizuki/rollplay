"""
主要APIエンドポイントのテスト
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


class TestScenariosEndpoint:
    """シナリオ一覧取得エンドポイントのテスト"""

    def test_get_scenarios_success(self, client):
        """シナリオ一覧を正常に取得"""
        response = client.get('/api/scenarios')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'scenarios' in data
        assert isinstance(data['scenarios'], list)
        assert len(data['scenarios']) > 0

        # 最初のシナリオの構造を確認
        first_scenario = data['scenarios'][0]
        assert 'id' in first_scenario
        assert 'title' in first_scenario  # 'name'ではなく'title'


class TestChatEndpoint:
    """チャット応答エンドポイントのテスト"""

    @patch('app.openai_client')
    def test_chat_success(self, mock_openai, client):
        """チャット応答を正常に取得"""
        # OpenAI APIのモック設定
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "こんにちは、お問い合わせありがとうございます。"
        mock_openai.chat.completions.create.return_value = mock_response

        response = client.post('/api/chat',
            json={
                'message': 'こんにちは',
                'history': [],
                'scenario_id': 'meeting_1st'
            },
            content_type='application/json'
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'response' in data
        assert isinstance(data['response'], str)
        assert len(data['response']) > 0

class TestEvaluateEndpoint:
    """評価生成エンドポイントのテスト"""

    @patch('app.openai_client')
    def test_evaluate_success(self, mock_openai, client):
        """評価を正常に生成"""
        # OpenAI APIのモック設定
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = json.dumps({
            'total_score': 85,
            'dimensions': {
                'listening': {'score': 90, 'feedback': '傾聴が素晴らしい'},
                'questioning': {'score': 80, 'feedback': '質問が適切'}
            }
        }, ensure_ascii=False)
        mock_openai.chat.completions.create.return_value = mock_response

        conversation = [
            {'speaker': '営業', 'text': 'こんにちは'},
            {'speaker': '顧客', 'text': 'こんにちは'}
        ]

        response = client.post('/api/evaluate',
            json={
                'conversation': conversation,
                'scenario_id': 'meeting_1st'
            },
            content_type='application/json'
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'evaluation' in data
        assert 'total_score' in data['evaluation']
        assert 'dimensions' in data['evaluation']

    def test_evaluate_missing_conversation(self, client):
        """会話データなしの場合はエラー"""
        response = client.post('/api/evaluate',
            json={
                'scenario_id': 'meeting_1st'
            },
            content_type='application/json'
        )

        assert response.status_code == 400
        data = response.get_json()
        assert data['success'] is False
        assert 'error' in data

    def test_evaluate_empty_conversation(self, client):
        """空の会話データの場合はエラー"""
        response = client.post('/api/evaluate',
            json={
                'conversation': [],
                'scenario_id': 'meeting_1st'
            },
            content_type='application/json'
        )

        assert response.status_code == 400
        data = response.get_json()
        assert data['success'] is False


class TestTranscribeEndpoint:
    """音声認識エンドポイントのテスト"""

    @patch('app.openai_client')
    def test_transcribe_success(self, mock_openai, client):
        """音声認識を正常に実行"""
        # OpenAI Whisper APIのモック設定
        mock_response = Mock()
        mock_response.text = "こんにちは、お世話になっております。"
        mock_openai.audio.transcriptions.create.return_value = mock_response

        # ダミーの音声ファイルを作成（1KB以上のデータ）
        import io
        audio_data = io.BytesIO(b'fake audio data' * 100)  # 1500 bytes
        audio_data.name = 'test.wav'

        response = client.post('/api/transcribe',
            data={
                'audio': (audio_data, 'test.wav')
            },
            content_type='multipart/form-data'
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'text' in data
        assert isinstance(data['text'], str)

    def test_transcribe_no_audio_file(self, client):
        """音声ファイルなしの場合はエラー"""
        response = client.post('/api/transcribe',
            data={},
            content_type='multipart/form-data'
        )

        assert response.status_code == 400
        data = response.get_json()
        assert data['success'] is False
        assert 'error' in data
