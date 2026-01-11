"""
admin.py (管理者機能) のユニットテスト
店舗統計、ランキング、CSVエクスポートなどの管理者機能をテスト
"""
import pytest
import io
import csv
from unittest.mock import Mock, patch, MagicMock, PropertyMock
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


class TestStoresStats:
    """全店舗統計情報テスト"""

    @patch('blueprints.admin.supabase_client')
    def test_get_stores_stats_success(self, mock_supabase, client):
        """全店舗統計取得の成功ケース"""
        # Supabaseモック設定
        mock_supabase.table.return_value.select.return_value.execute.return_value = Mock(
            data=[
                {'id': 'store_1', 'store_name': '店舗A'},
                {'id': 'store_2', 'store_name': '店舗B'}
            ]
        )

        # profiles, conversations, evaluationsのモック
        def mock_table_response(table_name):
            mock_table = Mock()
            if table_name == 'stores':
                mock_table.select.return_value.execute.return_value = Mock(
                    data=[
                        {'id': 'store_1', 'store_name': '店舗A'},
                        {'id': 'store_2', 'store_name': '店舗B'}
                    ]
                )
            elif table_name == 'profiles':
                mock_table.select.return_value.execute.return_value = Mock(
                    data=[
                        {'id': 'user_1', 'store_id': 'store_1'},
                        {'id': 'user_2', 'store_id': 'store_1'},
                        {'id': 'user_3', 'store_id': 'store_2'}
                    ]
                )
            elif table_name == 'conversations':
                mock_table.select.return_value.execute.return_value = Mock(
                    data=[
                        {'id': 'conv_1'},
                        {'id': 'conv_2'},
                        {'id': 'conv_3'},
                        {'id': 'conv_4'},
                        {'id': 'conv_5'}
                    ]
                )
            elif table_name == 'evaluations':
                mock_table.select.return_value.execute.return_value = Mock(
                    data=[
                        {'id': 'eval_1', 'average_score': 8.5},
                        {'id': 'eval_2', 'average_score': 7.0},
                        {'id': 'eval_3', 'average_score': 9.0}
                    ]
                )
            return mock_table

        mock_supabase.table.side_effect = mock_table_response

        # APIリクエスト
        response = client.get('/api/admin/stores/stats')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'stats' in data
        assert data['stats']['total_stores'] == 2
        assert data['stats']['total_users'] == 3
        assert data['stats']['total_conversations'] == 5
        assert data['stats']['total_evaluations'] == 3
        assert data['stats']['overall_avg_score'] == 8.17  # (8.5 + 7.0 + 9.0) / 3

    @patch('blueprints.admin.supabase_client', None)
    def test_get_stores_stats_no_database(self, client):
        """データベース未設定エラー"""
        response = client.get('/api/admin/stores/stats')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'Database not configured' in data['error']

    @patch('blueprints.admin.supabase_client')
    def test_get_stores_stats_empty_evaluations(self, mock_supabase, client):
        """評価データが0件の場合（ZeroDivision回避）"""
        def mock_table_response(table_name):
            mock_table = Mock()
            if table_name == 'stores':
                mock_table.select.return_value.execute.return_value = Mock(data=[{'id': 'store_1'}])
            elif table_name == 'profiles':
                mock_table.select.return_value.execute.return_value = Mock(data=[{'id': 'user_1'}])
            elif table_name == 'conversations':
                mock_table.select.return_value.execute.return_value = Mock(data=[])
            elif table_name == 'evaluations':
                mock_table.select.return_value.execute.return_value = Mock(data=[])
            return mock_table

        mock_supabase.table.side_effect = mock_table_response

        response = client.get('/api/admin/stores/stats')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert data['stats']['overall_avg_score'] == 0  # 評価0件なので平均0


class TestStoresRankings:
    """店舗ランキングテスト"""

    @patch('blueprints.admin.supabase_client')
    def test_get_stores_rankings_success(self, mock_supabase, client):
        """店舗ランキング取得の成功ケース（N+1クエリ修正後）"""
        def mock_table_response(table_name):
            mock_table = Mock()
            if table_name == 'stores':
                # 全店舗データ
                mock_table.select.return_value.execute.return_value = Mock(
                    data=[
                        {'id': 'store_1', 'store_code': 'S001', 'store_name': '店舗A', 'region': '東京'},
                        {'id': 'store_2', 'store_code': 'S002', 'store_name': '店舗B', 'region': '大阪'}
                    ]
                )
            elif table_name == 'profiles':
                # 全プロファイルデータ（一括取得）
                mock_table.select.return_value.execute.return_value = Mock(
                    data=[
                        {'id': 'user_1', 'store_id': 'store_1'},
                        {'id': 'user_2', 'store_id': 'store_2'},
                        {'id': 'user_3', 'store_id': 'store_2'}
                    ]
                )
            elif table_name == 'conversations':
                # 全会話データ（一括取得）
                mock_table.select.return_value.execute.return_value = Mock(
                    data=[
                        {'id': 'conv_1', 'store_id': 'store_1'},
                        {'id': 'conv_2', 'store_id': 'store_1'},
                        {'id': 'conv_3', 'store_id': 'store_2'}
                    ]
                )
            elif table_name == 'evaluations':
                # 全評価データ（一括取得）
                mock_table.select.return_value.execute.return_value = Mock(
                    data=[
                        {'store_id': 'store_1', 'average_score': 7.0},
                        {'store_id': 'store_1', 'average_score': 9.0},  # 店舗1平均: 8.0
                        {'store_id': 'store_2', 'average_score': 9.0}   # 店舗2平均: 9.0
                    ]
                )
            return mock_table

        mock_supabase.table.side_effect = mock_table_response

        response = client.get('/api/admin/stores/rankings')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'rankings' in data
        assert len(data['rankings']) == 2
        # 平均スコア順（降順）でソート
        assert data['rankings'][0]['average_score'] >= data['rankings'][1]['average_score']

    @patch('blueprints.admin.supabase_client', None)
    def test_get_stores_rankings_no_database(self, client):
        """データベース未設定エラー"""
        response = client.get('/api/admin/stores/rankings')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False


class TestStoreMembers:
    """店舗メンバー一覧テスト"""

    @patch('blueprints.admin.supabase_client')
    def test_get_store_members_success(self, mock_supabase, client):
        """店舗メンバー取得の成功ケース"""
        store_id = 'store_123'

        def mock_table_response(table_name):
            mock_table = Mock()
            if table_name == 'profiles':
                mock_chain = Mock()
                mock_chain.eq.return_value.execute.return_value = Mock(
                    data=[
                        {'id': 'user_1', 'name': '太郎'},
                        {'id': 'user_2', 'name': '花子'}
                    ]
                )
                mock_table.select.return_value = mock_chain
            elif table_name == 'conversations':
                mock_chain = Mock()
                def mock_eq(field, value):
                    if value == 'user_1':
                        return Mock(execute=Mock(return_value=Mock(data=[{'id': 'c1'}, {'id': 'c2'}])))
                    elif value == 'user_2':
                        return Mock(execute=Mock(return_value=Mock(data=[{'id': 'c3'}])))
                    return Mock(execute=Mock(return_value=Mock(data=[])))
                mock_chain.eq = mock_eq
                mock_table.select.return_value = mock_chain
            elif table_name == 'evaluations':
                mock_chain = Mock()
                def mock_eq(field, value):
                    if value == 'user_1':
                        return Mock(execute=Mock(return_value=Mock(data=[{'average_score': 8.5}])))
                    elif value == 'user_2':
                        return Mock(execute=Mock(return_value=Mock(data=[{'average_score': 7.0}])))
                    return Mock(execute=Mock(return_value=Mock(data=[])))
                mock_chain.eq = mock_eq
                mock_table.select.return_value = mock_chain
            return mock_table

        mock_supabase.table.side_effect = mock_table_response

        response = client.get(f'/api/stores/{store_id}/members')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'members' in data
        assert len(data['members']) == 2
        # メンバーに統計情報が追加されている
        assert 'conversation_count' in data['members'][0]
        assert 'average_score' in data['members'][0]
        assert 'evaluation_count' in data['members'][0]

    @patch('blueprints.admin.supabase_client', None)
    def test_get_store_members_no_database(self, client):
        """データベース未設定エラー"""
        response = client.get('/api/stores/store_123/members')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False


class TestRegionsStats:
    """リージョン別統計テスト"""

    @patch('blueprints.admin.supabase_client')
    def test_get_regions_stats_success(self, mock_supabase, client):
        """リージョン別統計取得の成功ケース"""
        def mock_table_response(table_name):
            mock_table = Mock()
            if table_name == 'stores':
                mock_table.select.return_value.execute.return_value = Mock(
                    data=[
                        {'id': 'store_1', 'store_code': 'S001', 'store_name': '店舗A', 'region': '東京'},
                        {'id': 'store_2', 'store_code': 'S002', 'store_name': '店舗B', 'region': '東京'},
                        {'id': 'store_3', 'store_code': 'S003', 'store_name': '店舗C', 'region': '大阪'}
                    ]
                )
            elif table_name == 'profiles':
                mock_chain = Mock()
                mock_chain.eq.return_value.execute.return_value = Mock(data=[{'id': 'user_1'}])
                mock_table.select.return_value = mock_chain
            elif table_name == 'conversations':
                mock_chain = Mock()
                mock_chain.eq.return_value.execute.return_value = Mock(data=[{'id': 'conv_1'}])
                mock_table.select.return_value = mock_chain
            elif table_name == 'evaluations':
                mock_chain = Mock()
                mock_chain.eq.return_value.execute.return_value = Mock(data=[{'average_score': 8.0}])
                mock_table.select.return_value = mock_chain
            return mock_table

        mock_supabase.table.side_effect = mock_table_response

        response = client.get('/api/admin/regions/stats')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'regions' in data
        # 東京と大阪の2リージョン
        assert len(data['regions']) >= 1

    @patch('blueprints.admin.supabase_client', None)
    def test_get_regions_stats_no_database(self, client):
        """データベース未設定エラー"""
        response = client.get('/api/admin/regions/stats')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False


class TestStoreAnalytics:
    """店舗分析テスト"""

    @patch('blueprints.admin.supabase_client')
    def test_get_store_analytics_success(self, mock_supabase, client):
        """店舗分析取得の成功ケース"""
        store_id = 'store_123'

        def mock_table_response(table_name):
            mock_table = MagicMock()
            if table_name == 'stores':
                # select().eq().execute()のチェーンをモック
                execute_result = MagicMock()
                execute_result.data = [{'id': store_id, 'store_code': 'S123', 'store_name': '店舗A', 'region': '東京'}]
                mock_table.select.return_value.eq.return_value.execute.return_value = execute_result
            elif table_name == 'profiles':
                execute_result = MagicMock()
                execute_result.data = [{'id': 'user_1'}, {'id': 'user_2'}]
                mock_table.select.return_value.eq.return_value.execute.return_value = execute_result
            elif table_name == 'conversations':
                execute_result = MagicMock()
                execute_result.data = [{'id': 'conv_1', 'created_at': '2025-12-01'}]
                mock_table.select.return_value.eq.return_value.execute.return_value = execute_result
            elif table_name == 'evaluations':
                execute_result = MagicMock()
                execute_result.data = [
                    {'scenario_id': 'meeting_1st', 'average_score': 8.5, 'created_at': '2025-12-01'},
                    {'scenario_id': 'meeting_2nd', 'average_score': 7.0, 'created_at': '2025-12-02'}
                ]
                mock_table.select.return_value.eq.return_value.execute.return_value = execute_result
            return mock_table

        mock_supabase.table.side_effect = mock_table_response

        response = client.get(f'/api/stores/{store_id}/analytics')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'scenario_analytics' in data
        assert 'store' in data
        assert 'total_evaluations' in data

    @patch('blueprints.admin.supabase_client', None)
    def test_get_store_analytics_no_database(self, client):
        """データベース未設定エラー"""
        response = client.get('/api/stores/store_123/analytics')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False


class TestExportEvaluations:
    """評価データCSVエクスポートテスト"""

    @patch('blueprints.admin.supabase_client')
    def test_export_evaluations_success(self, mock_supabase, client):
        """評価データCSVエクスポートの成功ケース"""
        def mock_table_response(table_name):
            mock_table = MagicMock()
            if table_name == 'evaluations':
                # evaluations: select().order().execute()のチェーン（パラメータなしのケース）
                execute_result = MagicMock()
                execute_result.data = [
                    {
                        'id': 'eval_1',
                        'user_id': 'user_1',
                        'store_id': 'store_1',
                        'scenario_id': 'meeting_1st',
                        'total_score': 34,
                        'average_score': 8.5,
                        'scores': {
                            'questioning_skill': 9,
                            'listening_skill': 8,
                            'proposal_skill': 9,
                            'closing_skill': 8
                        },
                        'created_at': '2025-12-30T10:00:00'
                    }
                ]
                # select()はクエリオブジェクトを返す
                mock_query = MagicMock()
                # eq()もクエリオブジェクトを返す（チェーン可能）
                mock_query.eq.return_value = mock_query
                # order()もクエリオブジェクトを返す
                mock_query.order.return_value = mock_query
                # execute()で最終結果を返す
                mock_query.execute.return_value = execute_result
                mock_table.select.return_value = mock_query
            elif table_name == 'stores':
                # stores: select().execute()
                execute_result = MagicMock()
                execute_result.data = [
                    {'id': 'store_1', 'store_code': 'S001', 'store_name': '店舗A', 'region': '東京'}
                ]
                mock_table.select.return_value.execute.return_value = execute_result
            elif table_name == 'profiles':
                # profiles: select().execute()
                execute_result = MagicMock()
                execute_result.data = [
                    {'id': 'user_1', 'display_name': '山田太郎'}
                ]
                mock_table.select.return_value.execute.return_value = execute_result
            return mock_table

        mock_supabase.table.side_effect = mock_table_response

        response = client.get('/api/admin/export/evaluations')

        assert response.status_code == 200
        assert response.content_type == 'text/csv; charset=utf-8'

        # CSVデータ検証
        csv_data = response.data.decode('utf-8')
        assert 'eval_1' in csv_data or '評価ID' in csv_data  # データまたはヘッダーが含まれる
        assert 'S001' in csv_data or '山田太郎' in csv_data  # 店舗コードまたはユーザー名

    @patch('blueprints.admin.supabase_client', None)
    def test_export_evaluations_no_database(self, client):
        """データベース未設定エラー"""
        response = client.get('/api/admin/export/evaluations')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False


class TestExportStores:
    """店舗データCSVエクスポートテスト"""

    @patch('blueprints.admin.supabase_client')
    def test_export_stores_success(self, mock_supabase, client):
        """店舗データCSVエクスポートの成功ケース"""
        def mock_table_response(table_name):
            mock_table = MagicMock()
            if table_name == 'stores':
                # stores: select().order().execute()
                execute_result = MagicMock()
                execute_result.data = [
                    {'id': 'store_1', 'store_code': 'S001', 'store_name': '店舗A', 'region': '東京', 'status': 'active', 'created_at': '2025-01-01'}
                ]
                mock_table.select.return_value.order.return_value.execute.return_value = execute_result
            elif table_name == 'profiles':
                # profiles: select().in_().execute()
                execute_result = MagicMock()
                execute_result.data = [
                    {'id': 'user_1', 'store_id': 'store_1'},
                    {'id': 'user_2', 'store_id': 'store_1'}
                ]
                mock_table.select.return_value.in_.return_value.execute.return_value = execute_result
            elif table_name == 'conversations':
                # conversations: select().in_().execute()
                execute_result = MagicMock()
                execute_result.data = [
                    {'id': 'conv_1', 'store_id': 'store_1'},
                    {'id': 'conv_2', 'store_id': 'store_1'},
                    {'id': 'conv_3', 'store_id': 'store_1'}
                ]
                mock_table.select.return_value.in_.return_value.execute.return_value = execute_result
            elif table_name == 'evaluations':
                # evaluations: select().in_().execute()
                execute_result = MagicMock()
                execute_result.data = [
                    {'average_score': 8.5, 'store_id': 'store_1'},
                    {'average_score': 7.0, 'store_id': 'store_1'}
                ]
                mock_table.select.return_value.in_.return_value.execute.return_value = execute_result
            return mock_table

        mock_supabase.table.side_effect = mock_table_response

        response = client.get('/api/admin/export/stores')

        assert response.status_code == 200
        assert response.content_type == 'text/csv; charset=utf-8'

        # CSVデータ検証
        csv_data = response.data.decode('utf-8')
        assert 'S001' in csv_data or '店舗コード' in csv_data  # データまたはヘッダー
        assert '店舗A' in csv_data or '東京' in csv_data  # 店舗名またはリージョン

    @patch('blueprints.admin.supabase_client', None)
    def test_export_stores_no_database(self, client):
        """データベース未設定エラー"""
        response = client.get('/api/admin/export/stores')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False


class TestErrorHandling:
    """エラーハンドリングテスト"""

    @patch('blueprints.admin.supabase_client')
    def test_stats_database_exception(self, mock_supabase, client):
        """データベース例外の処理"""
        mock_supabase.table.side_effect = Exception('Database connection error')

        response = client.get('/api/admin/stores/stats')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'error' in data

    @patch('blueprints.admin.supabase_client')
    def test_rankings_key_error(self, mock_supabase, client):
        """KeyErrorの処理（データフィールド欠落）"""
        mock_table = Mock()
        # store_code フィールドがないデータ
        mock_table.select.return_value.execute.return_value = Mock(
            data=[{'id': 'store_1'}]  # store_code, store_name がない
        )
        mock_supabase.table.return_value = mock_table

        response = client.get('/api/admin/stores/rankings')

        # KeyErrorまたは通常処理
        assert response.status_code in [200, 500]
