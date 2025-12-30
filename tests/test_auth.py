"""
認証・権限制御関数のテスト
"""
import pytest
from unittest.mock import Mock, patch, MagicMock
from flask import Flask


@pytest.fixture
def app():
    """テスト用Flaskアプリケーション"""
    app = Flask(__name__)
    app.config['TESTING'] = True
    return app


@pytest.fixture
def client(app):
    """テスト用クライアント"""
    return app.test_client()


class TestCanAccessData:
    """can_access_data関数のテスト"""

    def test_admin_can_access_all_data(self):
        """管理者は全データにアクセス可能"""
        from app import can_access_data

        current_user = {
            'user_id': 'admin123',
            'role': 'admin',
            'profile': {}
        }

        # 管理者は任意のデータにアクセス可能
        assert can_access_data(current_user, data_user_id='other_user') is True
        assert can_access_data(current_user, data_store_id='store123') is True
        assert can_access_data(current_user) is True

    def test_manager_can_access_own_store_data(self):
        """店舗管理者は自店舗のデータにアクセス可能"""
        from app import can_access_data

        current_user = {
            'user_id': 'manager123',
            'role': 'manager',
            'profile': {'store_id': 'store123'}
        }

        # 自店舗のデータにアクセス可能
        assert can_access_data(current_user, data_store_id='store123') is True

        # 他店舗のデータにはアクセス不可
        assert can_access_data(current_user, data_store_id='store456') is False

    def test_user_can_access_own_data_only(self):
        """一般ユーザーは自分のデータのみアクセス可能"""
        from app import can_access_data

        current_user = {
            'user_id': 'user123',
            'role': 'user',
            'profile': {}
        }

        # 自分のデータにアクセス可能
        assert can_access_data(current_user, data_user_id='user123') is True

        # 他人のデータにはアクセス不可
        assert can_access_data(current_user, data_user_id='other_user') is False
        assert can_access_data(current_user, data_store_id='store123') is False

    def test_no_user_cannot_access_data(self):
        """ユーザー情報がない場合はアクセス不可"""
        from app import can_access_data

        # Noneの場合
        assert can_access_data(None) is False

        # 空辞書の場合
        assert can_access_data({}) is False


class TestGetCurrentUser:
    """get_current_user関数のテスト"""

    @patch('app.supabase_client')
    def test_get_current_user_with_valid_token(self, mock_supabase):
        """有効なトークンでユーザー情報を取得"""
        from app import get_current_user, app as flask_app

        # モックの設定
        mock_user = Mock()
        mock_user.id = 'user123'
        mock_supabase.auth.get_user.return_value = Mock(user=mock_user)
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = Mock(
            data={'id': 'user123', 'role': 'user', 'name': 'Test User'}
        )

        with flask_app.test_request_context(headers={'Authorization': 'Bearer valid_token'}):
            result = get_current_user()

        assert result is not None
        assert result['user_id'] == 'user123'
        assert result['role'] == 'user'
        assert result['profile']['name'] == 'Test User'

    def test_get_current_user_without_token(self):
        """トークンなしの場合はNoneを返す"""
        from app import get_current_user, app as flask_app

        with flask_app.test_request_context():
            result = get_current_user()

        assert result is None

    @patch('app.supabase_client')
    def test_get_current_user_with_invalid_token(self, mock_supabase):
        """無効なトークンの場合はNoneを返す"""
        from app import get_current_user, app as flask_app

        # モックの設定: 認証エラー
        mock_supabase.auth.get_user.side_effect = Exception('Invalid token')

        with flask_app.test_request_context(headers={'Authorization': 'Bearer invalid_token'}):
            result = get_current_user()

        assert result is None


class TestRequireAuth:
    """require_authデコレータのテスト"""

    @patch('app.get_current_user')
    def test_require_auth_with_authenticated_user(self, mock_get_user, app):
        """認証済みユーザーの場合は関数を実行"""
        from app import require_auth

        mock_get_user.return_value = {
            'user_id': 'user123',
            'role': 'user',
            'profile': {}
        }

        @require_auth
        def protected_function():
            return {'success': True}

        with app.test_request_context():
            result = protected_function()

        assert result == {'success': True}

    @patch('app.get_current_user')
    def test_require_auth_without_authentication(self, mock_get_user, app):
        """未認証の場合は401エラー"""
        from app import require_auth

        mock_get_user.return_value = None

        @require_auth
        def protected_function():
            return {'success': True}

        with app.test_request_context():
            response = protected_function()
            response_data, status_code = response

        assert status_code == 401
        assert response_data.json['success'] is False


class TestRequireRole:
    """require_roleデコレータのテスト"""

    @patch('app.get_current_user')
    def test_require_role_with_correct_role(self, mock_get_user, app):
        """正しいロールの場合は関数を実行"""
        from app import require_role

        mock_get_user.return_value = {
            'user_id': 'admin123',
            'role': 'admin',
            'profile': {}
        }

        @require_role('admin')
        def admin_function():
            return {'success': True}

        with app.test_request_context():
            result = admin_function()

        assert result == {'success': True}

    @patch('app.get_current_user')
    def test_require_role_with_incorrect_role(self, mock_get_user, app):
        """不正なロールの場合は403エラー"""
        from app import require_role

        mock_get_user.return_value = {
            'user_id': 'user123',
            'role': 'user',
            'profile': {}
        }

        @require_role('admin')
        def admin_function():
            return {'success': True}

        with app.test_request_context():
            response = admin_function()
            response_data, status_code = response

        assert status_code == 403
        assert response_data.json['success'] is False

    @patch('app.get_current_user')
    def test_require_role_with_multiple_allowed_roles(self, mock_get_user, app):
        """複数のロールが許可されている場合"""
        from app import require_role

        mock_get_user.return_value = {
            'user_id': 'manager123',
            'role': 'manager',
            'profile': {}
        }

        @require_role('admin', 'manager')
        def protected_function():
            return {'success': True}

        with app.test_request_context():
            result = protected_function()

        assert result == {'success': True}
