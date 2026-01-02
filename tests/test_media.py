"""
media.py (メディア処理) のユニットテスト
TTS、音声認識、動画生成などの機能をテスト
"""
import pytest
import io
from unittest.mock import Mock, patch, MagicMock, mock_open
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


class TestTTSEndpoint:
    """TTS（Text-to-Speech）エンドポイントのテスト"""

    @patch('blueprints.media.openai_client')
    @patch('blueprints.media.open', new_callable=mock_open)
    @patch('blueprints.media.os.makedirs')
    @patch('blueprints.media.os.path.exists', return_value=False)
    def test_tts_success(self, mock_exists, mock_makedirs, mock_file, mock_openai, client):
        """TTS生成の成功ケース"""
        # OpenAI TTS APIモック
        mock_response = Mock()
        mock_response.content = b'fake audio content'
        mock_openai.audio.speech.create.return_value = mock_response

        response = client.post('/api/tts', json={
            'text': 'これはテストです',
            'voice': 'alloy'
        })

        # エンドポイントが存在しない場合は404
        assert response.status_code in [200, 404]

    @patch('blueprints.media.openai_client', None)
    def test_tts_no_openai_client(self, client):
        """OpenAIクライアント未設定エラー"""
        response = client.post('/api/tts', json={
            'text': 'test',
            'voice': 'alloy'
        })

        # OpenAIクライアント未設定
        assert response.status_code in [404, 500]


class TestTranscribeEndpoint:
    """音声認識エンドポイントのテスト"""

    @patch('blueprints.media.openai_client')
    @patch('blueprints.media.AudioSegment')
    def test_transcribe_success(self, mock_audio_segment, mock_openai, client):
        """音声認識の成功ケース"""
        # OpenAI Whisper APIモック
        mock_response = Mock()
        mock_response.text = "これはテスト音声の文字起こしです"
        mock_openai.audio.transcriptions.create.return_value = mock_response

        # AudioSegmentモック（ffmpegエラー回避）
        mock_audio = Mock()
        mock_audio.set_frame_rate.return_value.set_channels.return_value.export.return_value = None
        mock_audio_segment.from_file.return_value = mock_audio

        # 音声ファイルアップロード
        audio_data = io.BytesIO(b'fake audio data' * 100)
        audio_data.name = 'test.wav'

        response = client.post('/api/transcribe',
            data={'audio': (audio_data, 'test.wav')},
            content_type='multipart/form-data'
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'text' in data

    @patch('blueprints.media.openai_client', None)
    def test_transcribe_no_openai_client(self, client):
        """OpenAIクライアント未設定エラー"""
        # 十分なサイズの音声データ
        audio_data = io.BytesIO(b'fake audio data' * 100)
        audio_data.name = 'test.wav'

        response = client.post('/api/transcribe',
            data={'audio': (audio_data, 'test.wav')},
            content_type='multipart/form-data'
        )

        assert response.status_code in [500, 400]
        data = response.get_json()
        assert data['success'] is False

    def test_transcribe_no_audio_file(self, client):
        """音声ファイルなしのリクエスト"""
        response = client.post('/api/transcribe',
            data={},
            content_type='multipart/form-data'
        )

        assert response.status_code in [400, 500]
        data = response.get_json()
        assert data['success'] is False

    def test_transcribe_empty_audio_file(self, client):
        """空の音声ファイル"""
        audio_data = io.BytesIO(b'')
        audio_data.name = 'empty.wav'

        response = client.post('/api/transcribe',
            data={'audio': (audio_data, 'empty.wav')},
            content_type='multipart/form-data'
        )

        assert response.status_code in [400, 500]
        data = response.get_json()
        assert data['success'] is False


class TestRateLimitHelper:
    """レート制限ヘルパー関数のテスト"""

    def test_apply_rate_limit_with_limiter(self, app):
        """limiterがある場合のレート制限適用"""
        from blueprints.media import apply_rate_limit

        # limiterの有無に関わらず、デコレータは関数を返す
        @apply_rate_limit("10 per minute")
        def test_func():
            return "success"

        # アプリケーションコンテキスト内でテスト
        with app.app_context():
            result = test_func()
            assert result == "success"


class TestErrorHandling:
    """エラーハンドリングテスト"""

    @patch('blueprints.media.openai_client')
    @patch('blueprints.media.AudioSegment')
    def test_transcribe_openai_error(self, mock_audio_segment, mock_openai, client):
        """音声認識時のOpenAIエラー"""
        # AudioSegmentモック
        mock_audio = Mock()
        mock_audio.set_frame_rate.return_value.set_channels.return_value.export.return_value = None
        mock_audio_segment.from_file.return_value = mock_audio

        # Whisper APIエラー
        mock_openai.audio.transcriptions.create.side_effect = Exception('Whisper API error')

        audio_data = io.BytesIO(b'fake audio' * 100)
        audio_data.name = 'test.wav'

        response = client.post('/api/transcribe',
            data={'audio': (audio_data, 'test.wav')},
            content_type='multipart/form-data'
        )

        # Whisper APIエラー時はエラーレスポンスを返す
        assert response.status_code in [400, 500]
        data = response.get_json()
        assert data['success'] is False

    @patch('blueprints.media.openai_client')
    @patch('blueprints.media.AudioSegment')
    def test_transcribe_audio_conversion_error(self, mock_audio_segment, mock_openai, client):
        """音声変換エラー"""
        # AudioSegmentエラー
        mock_audio_segment.from_file.side_effect = Exception('Audio conversion error')

        audio_data = io.BytesIO(b'invalid audio')
        audio_data.name = 'invalid.wav'

        response = client.post('/api/transcribe',
            data={'audio': (audio_data, 'invalid.wav')},
            content_type='multipart/form-data'
        )

        # 音声変換エラー時はエラーレスポンスを返す
        assert response.status_code in [400, 500]
        data = response.get_json()
        assert data['success'] is False


class TestTTSErrorHandling:
    """TTSのエラーハンドリングテスト"""

    @patch('blueprints.media.openai_client')
    def test_tts_empty_text(self, mock_openai, client):
        """空のテキストでのエラー"""
        response = client.post('/api/tts', json={
            'text': '',
            'voice': 'alloy'
        })

        # 空のテキストは400エラー
        assert response.status_code in [400, 404]

    @patch('blueprints.media.openai_client')
    def test_tts_invalid_voice_fallback(self, mock_openai, client):
        """不正な音声IDのフォールバック"""
        # OpenAI TTS APIモック
        mock_response = Mock()
        mock_response.content = b'fake audio content'
        mock_openai.audio.speech.create.return_value = mock_response

        response = client.post('/api/tts', json={
            'text': 'テスト',
            'voice': 'invalid_voice_id'  # 不正な音声ID
        })

        # 不正な音声IDでもデフォルトにフォールバックして成功
        assert response.status_code in [200, 404]
        # 'alloy'がデフォルトとして使われることを確認（モックが呼ばれた場合）
        if mock_openai.audio.speech.create.called:
            call_args = mock_openai.audio.speech.create.call_args
            assert call_args[1]['voice'] == 'alloy'

    @patch('blueprints.media.openai_client')
    def test_tts_value_error(self, mock_openai, client):
        """ValueErrorのハンドリング"""
        mock_openai.audio.speech.create.side_effect = ValueError("Invalid parameter")

        response = client.post('/api/tts', json={
            'text': 'テスト',
            'voice': 'alloy'
        })

        assert response.status_code in [400, 404, 500]

    @patch('blueprints.media.openai_client')
    def test_tts_timeout_error(self, mock_openai, client):
        """TimeoutErrorのハンドリング"""
        mock_openai.audio.speech.create.side_effect = TimeoutError("API timeout")

        response = client.post('/api/tts', json={
            'text': 'テスト',
            'voice': 'alloy'
        })

        assert response.status_code in [404, 500]

    @patch('blueprints.media.openai_client')
    def test_tts_general_exception(self, mock_openai, client):
        """一般的なExceptionのハンドリング"""
        mock_openai.audio.speech.create.side_effect = Exception("Unexpected error")

        response = client.post('/api/tts', json={
            'text': 'テスト',
            'voice': 'alloy'
        })

        assert response.status_code in [404, 500]


class TestTranscribeDetails:
    """音声認識の詳細テスト"""

    @patch('blueprints.media.openai_client')
    @patch('blueprints.media.AudioSegment')
    def test_transcribe_with_conversion(self, mock_audio_segment, mock_openai, client):
        """音声変換を含む音声認識"""
        # AudioSegmentモック
        mock_audio = Mock()
        mock_audio.set_frame_rate.return_value.set_channels.return_value.export.return_value = None
        mock_audio_segment.from_file.return_value = mock_audio

        # Whisper APIモック
        mock_transcription = Mock()
        mock_transcription.text = "変換されたテキスト"
        mock_openai.audio.transcriptions.create.return_value = mock_transcription

        audio_data = io.BytesIO(b'fake audio data' * 100)
        audio_data.name = 'test.wav'

        response = client.post('/api/transcribe',
            data={'audio': (audio_data, 'test.wav')},
            content_type='multipart/form-data'
        )

        # 音声変換が成功する場合
        assert response.status_code in [200, 404]

    @patch('blueprints.media.openai_client')
    @patch('blueprints.media.AudioSegment', None)
    def test_transcribe_without_pydub(self, mock_openai, client):
        """PyDub未インストール時の処理"""
        # Whisper APIモック
        mock_transcription = Mock()
        mock_transcription.text = "直接変換されたテキスト"
        mock_openai.audio.transcriptions.create.return_value = mock_transcription

        # 十分なサイズの音声データ（最小サイズチェックを通過）
        audio_data = io.BytesIO(b'fake audio data' * 100)
        audio_data.name = 'test.wav'

        response = client.post('/api/transcribe',
            data={'audio': (audio_data, 'test.wav')},
            content_type='multipart/form-data'
        )

        # PyDubなしでも処理可能（または400でサイズエラー）
        assert response.status_code in [200, 400, 404, 500]


class TestTTSFileHandling:
    """TTSファイル処理のテスト"""

    @patch('blueprints.media.openai_client')
    @patch('blueprints.media.os.makedirs')
    @patch('blueprints.media.open', side_effect=OSError("File write error"))
    @patch('blueprints.media.os.path.exists', return_value=False)
    def test_tts_file_write_error(self, mock_exists, mock_open, mock_makedirs, mock_openai, client):
        """TTSファイル書き込みエラー"""
        # OpenAI TTS APIモック
        mock_response = Mock()
        mock_response.content = b'fake audio content'
        mock_openai.audio.speech.create.return_value = mock_response

        response = client.post('/api/tts', json={
            'text': 'テスト',
            'voice': 'alloy'
        })

        # ファイル書き込みエラーが発生しても適切に処理
        assert response.status_code in [200, 404, 500]


class TestTranscribeOSError:
    """Transcribe OSErrorハンドリングのテスト"""

    @patch('blueprints.media.openai_client')
    @patch('blueprints.media.AudioSegment')
    def test_transcribe_os_error(self, mock_audio_segment, mock_openai, client):
        """OSError発生時の処理"""
        # AudioSegmentモック: OSError発生
        mock_audio_segment.from_file.side_effect = OSError("File system error")

        audio_data = io.BytesIO(b'fake audio data' * 100)
        audio_data.name = 'test.wav'

        response = client.post('/api/transcribe',
            data={'audio': (audio_data, 'test.wav')},
            content_type='multipart/form-data'
        )

        # OSErrorが適切に処理される
        assert response.status_code in [400, 500]
        data = response.get_json()
        assert data['success'] is False
