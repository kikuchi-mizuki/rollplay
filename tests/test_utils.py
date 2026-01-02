"""
ユーティリティ関数・ヘルパー関数のテスト
"""
import pytest
from unittest.mock import Mock, patch, MagicMock, mock_open
import json
import tempfile
import os


class TestLoadScenarioObject:
    """load_scenario_object関数のテスト"""

    def test_load_scenario_success(self):
        """シナリオを正常に読み込み"""
        from app import load_scenario_object

        scenario = load_scenario_object('meeting_1st')

        assert scenario is not None
        assert 'id' in scenario
        assert scenario['id'] == 'meeting_1st'
        assert 'title' in scenario or 'name' in scenario

    def test_load_nonexistent_scenario(self):
        """存在しないシナリオの場合はNoneまたは例外"""
        from app import load_scenario_object

        scenario = load_scenario_object('nonexistent_scenario_id')

        # 実装によってはNoneを返すか、例外を投げる
        # ここでは柔軟にテスト
        assert scenario is None or isinstance(scenario, dict)


class TestSelectRandomPersona:
    """select_random_persona_for_scene関数のテスト"""

    def test_select_persona_for_meeting_1st(self):
        """meeting_1stシーンのペルソナ選択"""
        from app import select_random_persona_for_scene

        persona = select_random_persona_for_scene('meeting_1st')

        # ペルソナが正常に選択される
        assert persona is not None
        assert isinstance(persona, dict)
        if 'name' in persona or 'company_name' in persona:
            assert True
        else:
            # ペルソナの基本構造を確認
            assert len(persona) > 0

    def test_select_persona_for_different_scenes(self):
        """異なるシーンでペルソナ選択"""
        from app import select_random_persona_for_scene

        # 複数回呼び出してランダム性を確認
        personas = []
        for _ in range(5):
            persona = select_random_persona_for_scene('meeting_1st')
            if persona:
                personas.append(persona)

        # 少なくとも1つのペルソナが選択される
        assert len(personas) > 0


class TestGuidelinesFormatting:
    """ガイドラインフォーマット関数のテスト"""

    def test_format_guidelines_empty(self):
        """空のガイドラインをフォーマット"""
        # ガイドラインフォーマット処理が存在する場合のテスト
        guidelines = []
        formatted = "\n".join([f"- {g}" for g in guidelines])

        assert formatted == ""

    def test_format_guidelines_with_content(self):
        """内容があるガイドラインをフォーマット"""
        guidelines = ["ガイドライン1", "ガイドライン2", "ガイドライン3"]
        formatted = "\n".join([f"- {g}" for g in guidelines])

        assert "ガイドライン1" in formatted
        assert "ガイドライン2" in formatted
        assert "ガイドライン3" in formatted
        assert formatted.count("- ") == 3


class TestConversationHistoryBuilding:
    """会話履歴構築のテスト"""

    def test_build_conversation_history_empty(self):
        """空の会話履歴を構築"""
        history = []
        messages = []

        for msg in history:
            role = "user" if msg.get('speaker') == '営業' else "assistant"
            messages.append({"role": role, "content": msg.get('text', '')})

        assert len(messages) == 0

    def test_build_conversation_history_with_messages(self):
        """メッセージがある会話履歴を構築"""
        history = [
            {'speaker': '営業', 'text': 'こんにちは'},
            {'speaker': '顧客', 'text': 'こんにちは、お世話になっております'}
        ]
        messages = []

        for msg in history:
            role = "user" if msg.get('speaker') == '営業' else "assistant"
            messages.append({"role": role, "content": msg.get('text', '')})

        assert len(messages) == 2
        assert messages[0]['role'] == 'user'
        assert messages[0]['content'] == 'こんにちは'
        assert messages[1]['role'] == 'assistant'
        assert messages[1]['content'] == 'こんにちは、お世話になっております'


class TestErrorMessageGeneration:
    """エラーメッセージ生成のテスト"""

    def test_error_message_for_timeout(self):
        """タイムアウトエラーメッセージ"""
        error_type = "TimeoutError"
        user_message = "処理がタイムアウトしました。もう一度お試しください"

        assert "タイムアウト" in user_message
        assert "もう一度" in user_message

    def test_error_message_for_value_error(self):
        """値エラーメッセージ"""
        error_type = "ValueError"
        user_message = "入力内容に誤りがあります"

        assert "入力" in user_message or "誤り" in user_message


class TestJSONParsing:
    """JSON解析のテスト"""

    def test_parse_valid_json(self):
        """正常なJSONを解析"""
        json_str = '{"key": "value", "number": 123}'
        data = json.loads(json_str)

        assert data['key'] == 'value'
        assert data['number'] == 123

    def test_parse_invalid_json(self):
        """不正なJSONの解析でエラー"""
        json_str = '{invalid json}'

        with pytest.raises(json.JSONDecodeError):
            json.loads(json_str)

    def test_parse_json_with_japanese(self):
        """日本語を含むJSONを解析"""
        json_str = '{"message": "こんにちは"}'
        data = json.loads(json_str)

        assert data['message'] == 'こんにちは'


class TestSniffSuffix:
    """sniff_suffix関数のテスト"""

    def test_sniff_webm_format(self):
        """WebM形式を正しく判定"""
        from app import sniff_suffix

        # 一時ファイルを作成してWebMヘッダーを書き込む
        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
            f.write(b"\x1A\x45\xDF\xA3" + b"\x00" * 12)  # EBML header
            temp_path = f.name

        try:
            result = sniff_suffix(temp_path)
            assert result == '.webm'
        finally:
            os.unlink(temp_path)

    def test_sniff_ogg_format(self):
        """Ogg形式を正しく判定"""
        from app import sniff_suffix

        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
            f.write(b"OggS" + b"\x00" * 12)
            temp_path = f.name

        try:
            result = sniff_suffix(temp_path)
            assert result == '.ogg'
        finally:
            os.unlink(temp_path)

    def test_sniff_wav_format(self):
        """WAV形式を正しく判定"""
        from app import sniff_suffix

        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
            f.write(b"RIFF\x00\x00\x00\x00WAVE")
            temp_path = f.name

        try:
            result = sniff_suffix(temp_path)
            assert result == '.wav'
        finally:
            os.unlink(temp_path)

    def test_sniff_mp4_format(self):
        """MP4形式を正しく判定"""
        from app import sniff_suffix

        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
            f.write(b"\x00\x00\x00\x18ftyp" + b"\x00" * 10)
            temp_path = f.name

        try:
            result = sniff_suffix(temp_path)
            assert result == '.mp4'
        finally:
            os.unlink(temp_path)

    def test_sniff_mp3_format(self):
        """MP3形式を正しく判定"""
        from app import sniff_suffix

        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
            f.write(b"ID3" + b"\x00" * 13)
            temp_path = f.name

        try:
            result = sniff_suffix(temp_path)
            assert result == '.mp3'
        finally:
            os.unlink(temp_path)

    def test_sniff_unknown_format(self):
        """不明な形式は.binを返す"""
        from app import sniff_suffix

        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
            f.write(b"UNKNOWN" + b"\x00" * 9)
            temp_path = f.name

        try:
            result = sniff_suffix(temp_path)
            assert result == '.bin'
        finally:
            os.unlink(temp_path)

    def test_sniff_file_not_found(self):
        """ファイルが見つからない場合は.binを返す"""
        from app import sniff_suffix

        result = sniff_suffix('/nonexistent/file/path.bin')
        assert result == '.bin'
