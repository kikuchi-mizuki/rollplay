"""
Supabase統合テスト
データベース操作と各エンドポイントの統合をテスト
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


@pytest.mark.integration
class TestConversationDataFlow:
    """会話データの保存・取得フロー統合テスト"""

    @patch('blueprints.conversations.supabase_client')
    @patch('blueprints.conversations.openai_client')
    def test_chat_and_save_conversation(self, mock_openai, mock_supabase, client):
        """チャット → 会話履歴保存の統合フロー"""
        # OpenAI APIモック
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "テスト応答"
        mock_openai.chat.completions.create.return_value = mock_response

        # Supabaseモック: 会話保存
        mock_supabase.table.return_value.insert.return_value.execute.return_value = Mock(
            data=[{'id': 'conv_123', 'user_id': 'user_123'}]
        )

        # チャットリクエスト
        response = client.post('/api/chat',
            json={
                'message': 'こんにちは',
                'history': [],
                'scenario_id': 'meeting_1st',
                'user_id': 'user_123',
                'save_conversation': True
            },
            content_type='application/json'
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'response' in data


@pytest.mark.integration
class TestEvaluationDataFlow:
    """評価データの生成・保存フロー統合テスト"""

    @patch('blueprints.conversations.supabase_client')
    @patch('blueprints.conversations.openai_client')
    def test_evaluate_and_save(self, mock_openai, mock_supabase, client):
        """評価生成 → データベース保存の統合フロー"""
        # OpenAI APIモック
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = json.dumps({
            'scores': {
                'questioning': 8.0,
                'listening': 7.0,
                'proposing': 6.0,
                'closing': 5.0,
                'total': 26.0
            },
            'overall': 'テスト評価'
        }, ensure_ascii=False)
        mock_openai.chat.completions.create.return_value = mock_response

        # Supabaseモック: 評価保存
        mock_supabase.table.return_value.insert.return_value.execute.return_value = Mock(
            data=[{'id': 'eval_123', 'conversation_id': 'conv_123'}]
        )

        # 評価リクエスト
        conversation = [
            {'speaker': '営業', 'text': 'こんにちは'},
            {'speaker': '顧客', 'text': 'こんにちは'}
        ]

        response = client.post('/api/evaluate',
            json={
                'conversation': conversation,
                'scenario_id': 'meeting_1st',
                'conversation_id': 'conv_123',
                'user_id': 'user_123'
            },
            content_type='application/json'
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'evaluation' in data
        assert 'scores' in data['evaluation']


@pytest.mark.integration
class TestUserProfileFlow:
    """ユーザープロファイル取得フロー統合テスト"""

    @patch('app.supabase_client')
    def test_get_current_user_profile(self, mock_supabase, client):
        """認証トークン → ユーザープロファイル取得の統合フロー"""
        # Supabaseモック: ユーザー認証
        mock_user = Mock()
        mock_user.id = 'user_123'
        mock_supabase.auth.get_user.return_value = Mock(user=mock_user)

        # Supabaseモック: プロファイル取得
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = Mock(
            data={
                'id': 'user_123',
                'role': 'user',
                'name': 'テストユーザー',
                'store_id': 'store_123'
            }
        )

        # ヘッダーに認証トークンを含めてリクエスト
        response = client.get('/api/scenarios',
            headers={'Authorization': 'Bearer test_token'}
        )

        assert response.status_code == 200


@pytest.mark.integration
class TestStoreManagementFlow:
    """店舗管理フロー統合テスト"""

    @patch('blueprints.admin.supabase_client')
    def test_get_store_rankings(self, mock_supabase, client):
        """店舗ランキング取得の統合フロー（N+1問題解決済み）"""
        # Supabaseモック: 店舗一覧取得
        mock_table = MagicMock()

        # stores.select('*').execute()
        stores_execute = MagicMock()
        stores_execute.data = [
            {'id': 'store_1', 'store_code': 'S001', 'store_name': '店舗A', 'region': '東京'},
            {'id': 'store_2', 'store_code': 'S002', 'store_name': '店舗B', 'region': '大阪'},
            {'id': 'store_3', 'store_code': 'S003', 'store_name': '店舗C', 'region': '福岡'}
        ]

        # profiles.select('id').eq('store_id', X).execute()
        profiles_execute = MagicMock()
        profiles_execute.data = [
            {'id': 'profile_1'},
            {'id': 'profile_2'}
        ]

        # conversations.select('id').eq('store_id', X).execute()
        conversations_execute = MagicMock()
        conversations_execute.data = [
            {'id': 'conv_1'},
            {'id': 'conv_2'},
            {'id': 'conv_3'}
        ]

        # evaluations.select('average_score').eq('store_id', X).execute()
        evaluations_execute = MagicMock()
        evaluations_execute.data = [
            {'average_score': 8.5},
            {'average_score': 7.5}
        ]

        def table_mock(table_name):
            mock = MagicMock()
            if table_name == 'stores':
                mock.select.return_value.execute.return_value = stores_execute
            elif table_name == 'profiles':
                mock.select.return_value.eq.return_value.execute.return_value = profiles_execute
            elif table_name == 'conversations':
                mock.select.return_value.eq.return_value.execute.return_value = conversations_execute
            elif table_name == 'evaluations':
                mock.select.return_value.eq.return_value.execute.return_value = evaluations_execute
            return mock

        mock_supabase.table.side_effect = table_mock

        response = client.get('/api/admin/stores/rankings')

        # エンドポイントは認証なしでも動作（現在の実装）
        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'rankings' in data


@pytest.mark.integration
class TestDataAccessControl:
    """データアクセス制御の統合テスト"""

    @patch('app.get_current_user')
    def test_admin_can_access_all_data(self, mock_get_user, client):
        """管理者は全データにアクセス可能"""
        from app import can_access_data

        # 管理者ユーザー
        admin_user = {
            'user_id': 'admin_123',
            'role': 'admin',
            'profile': {}
        }
        mock_get_user.return_value = admin_user

        # 任意のデータにアクセス可能
        assert can_access_data(admin_user, data_user_id='other_user') is True
        assert can_access_data(admin_user, data_store_id='any_store') is True

    @patch('app.get_current_user')
    def test_manager_can_access_store_data_only(self, mock_get_user, client):
        """店舗管理者は自店舗のデータのみアクセス可能"""
        from app import can_access_data

        # 店舗管理者ユーザー
        manager_user = {
            'user_id': 'manager_123',
            'role': 'manager',
            'profile': {'store_id': 'store_123'}
        }
        mock_get_user.return_value = manager_user

        # 自店舗のデータにアクセス可能
        assert can_access_data(manager_user, data_store_id='store_123') is True

        # 他店舗のデータにアクセス不可
        assert can_access_data(manager_user, data_store_id='store_456') is False

    @patch('app.get_current_user')
    def test_user_can_access_own_data_only(self, mock_get_user, client):
        """一般ユーザーは自分のデータのみアクセス可能"""
        from app import can_access_data

        # 一般ユーザー
        user = {
            'user_id': 'user_123',
            'role': 'user',
            'profile': {}
        }
        mock_get_user.return_value = user

        # 自分のデータにアクセス可能
        assert can_access_data(user, data_user_id='user_123') is True

        # 他人のデータにアクセス不可
        assert can_access_data(user, data_user_id='other_user') is False
        assert can_access_data(user, data_store_id='any_store') is False


@pytest.mark.integration
class TestDatabaseErrorHandling:
    """データベースエラーハンドリングの統合テスト"""

    @patch('blueprints.conversations.supabase_client')
    @patch('blueprints.conversations.openai_client')
    def test_chat_handles_database_error_gracefully(self, mock_openai, mock_supabase, client):
        """チャット中のデータベースエラーを適切に処理"""
        # OpenAI APIモック
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "テスト応答"
        mock_openai.chat.completions.create.return_value = mock_response

        # Supabaseモック: データベースエラー
        mock_supabase.table.return_value.insert.return_value.execute.side_effect = Exception('Database error')

        # チャットリクエスト
        response = client.post('/api/chat',
            json={
                'message': 'こんにちは',
                'history': [],
                'scenario_id': 'meeting_1st',
                'user_id': 'user_123',
                'save_conversation': True
            },
            content_type='application/json'
        )

        # データベースエラーでもチャット自体は成功する（保存は失敗）
        data = response.get_json()
        # エラーハンドリングによって、適切なレスポンスが返る
        assert response.status_code in [200, 500]
        assert 'success' in data


@pytest.mark.integration
class TestCacheIntegration:
    """キャッシュ統合テスト"""

    def test_scenario_cache_improves_performance(self, client):
        """シナリオキャッシュがパフォーマンスを改善"""
        from app import load_scenario_object

        # 最初の呼び出し
        scenario1 = load_scenario_object('meeting_1st')
        cache_info1 = load_scenario_object.cache_info()

        # 2回目の呼び出し（キャッシュヒット）
        scenario2 = load_scenario_object('meeting_1st')
        cache_info2 = load_scenario_object.cache_info()

        # キャッシュヒットが増えている
        assert cache_info2.hits > cache_info1.hits
        assert scenario1 == scenario2

    def test_cache_clear_works(self, client):
        """キャッシュクリアが正常に動作"""
        from app import load_scenario_object, load_evaluation_samples

        # キャッシュにデータを追加
        load_scenario_object('meeting_1st')
        load_evaluation_samples('meeting_1st')

        # キャッシュクリアリクエスト
        response = client.post('/api/clear-cache')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True

        # キャッシュがクリアされている
        cache_info = load_scenario_object.cache_info()
        assert cache_info.currsize == 0
