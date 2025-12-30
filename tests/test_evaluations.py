"""
evaluations.py (評価機能) のユニットテスト
講師評価、評価精度検証などの機能をテスト
"""
import pytest
from unittest.mock import Mock, patch
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


class TestCalculateAccuracyMetrics:
    """精度指標計算関数のテスト"""

    def test_calculate_accuracy_perfect_match(self):
        """完全一致の場合（精度100%）"""
        from blueprints.evaluations import calculate_accuracy_metrics

        instructor_scores = {
            'questioning_skill': 8.0,
            'listening_skill': 7.0,
            'proposal_skill': 9.0,
            'closing_skill': 6.0
        }
        ai_scores = {
            'questioning_skill': 8.0,
            'listening_skill': 7.0,
            'proposal_skill': 9.0,
            'closing_skill': 6.0
        }

        result = calculate_accuracy_metrics(instructor_scores, ai_scores)

        assert result['overall_accuracy'] == 1.0  # 完全一致
        assert result['average_difference'] == 0.0
        assert result['total_comparisons'] == 4

    def test_calculate_accuracy_with_differences(self):
        """差分がある場合"""
        from blueprints.evaluations import calculate_accuracy_metrics

        instructor_scores = {
            'questioning_skill': 8.0,
            'listening_skill': 7.0,
            'proposal_skill': 9.0,
            'closing_skill': 6.0
        }
        ai_scores = {
            'questioning_skill': 7.0,  # -1
            'listening_skill': 8.0,    # +1
            'proposal_skill': 9.0,     # 0
            'closing_skill': 5.0       # -1
        }

        result = calculate_accuracy_metrics(instructor_scores, ai_scores)

        # 平均差分: (1 + 1 + 0 + 1) / 4 = 0.75
        # 精度: 1 - (0.75 / 5) = 0.85
        assert result['average_difference'] == 0.75
        assert result['overall_accuracy'] == 0.85
        assert result['total_comparisons'] == 4

    def test_calculate_accuracy_empty_ai_scores(self):
        """AI評価がない場合"""
        from blueprints.evaluations import calculate_accuracy_metrics

        instructor_scores = {'questioning_skill': 8.0}
        ai_scores = {}

        result = calculate_accuracy_metrics(instructor_scores, ai_scores)

        assert result['overall_accuracy'] == 0
        assert 'message' in result
        assert 'AI評価がありません' in result['message']

    def test_calculate_accuracy_no_matching_keys(self):
        """キーが一致しない場合"""
        from blueprints.evaluations import calculate_accuracy_metrics

        instructor_scores = {'questioning_skill': 8.0}
        ai_scores = {'other_metric': 7.0}

        result = calculate_accuracy_metrics(instructor_scores, ai_scores)

        assert result['overall_accuracy'] == 0
        assert 'message' in result


class TestSaveInstructorEvaluation:
    """講師評価保存のテスト"""

    @patch('blueprints.evaluations.supabase_client')
    def test_save_instructor_evaluation_success(self, mock_supabase, client):
        """講師評価保存の成功ケース"""
        # AI評価取得のモック
        mock_select_chain = Mock()
        mock_select_chain.eq.return_value.execute.return_value = Mock(
            data=[{
                'scores': {
                    'questioning_skill': 7.0,
                    'listening_skill': 8.0,
                    'proposal_skill': 9.0,
                    'closing_skill': 5.0
                },
                'average_score': 7.25
            }]
        )

        # 講師評価保存のモック
        mock_insert_chain = Mock()
        mock_insert_chain.insert.return_value.execute.return_value = Mock(
            data=[{'id': 'instructor_eval_123'}]
        )

        def mock_table(table_name):
            if table_name == 'evaluations':
                return Mock(select=lambda x: mock_select_chain)
            elif table_name == 'instructor_evaluations':
                return mock_insert_chain
            return Mock()

        mock_supabase.table = mock_table

        # リクエストデータ
        request_data = {
            'conversation_id': 'conv_123',
            'evaluation_id': 'eval_123',
            'user_id': 'user_123',
            'store_id': 'store_123',
            'scenario_id': 'meeting_1st',
            'instructor_scores': {
                'questioning_skill': 8.0,
                'listening_skill': 7.0,
                'proposal_skill': 9.0,
                'closing_skill': 6.0
            },
            'instructor_comments': {'overall': '良好です'},
            'instructor_name': '講師A'
        }

        response = client.post('/api/instructor-evaluations', json=request_data)

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'instructor_evaluation_id' in data
        assert 'score_differences' in data
        assert 'accuracy_metrics' in data

    @patch('blueprints.evaluations.supabase_client', None)
    def test_save_instructor_evaluation_no_database(self, client):
        """データベース未設定エラー"""
        request_data = {
            'conversation_id': 'conv_123',
            'evaluation_id': 'eval_123',
            'instructor_scores': {'questioning_skill': 8.0}
        }

        response = client.post('/api/instructor-evaluations', json=request_data)

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'Supabaseが設定されていません' in data['error']

    @patch('blueprints.evaluations.supabase_client')
    def test_save_instructor_evaluation_missing_fields(self, mock_supabase, client):
        """必須フィールドが欠けている場合"""
        # conversation_idが欠落
        request_data = {
            'evaluation_id': 'eval_123',
            'instructor_scores': {'questioning_skill': 8.0}
        }

        response = client.post('/api/instructor-evaluations', json=request_data)

        assert response.status_code == 400
        data = response.get_json()
        assert data['success'] is False
        assert '必須です' in data['error']


class TestGetInstructorEvaluations:
    """講師評価取得のテスト"""

    @patch('blueprints.evaluations.supabase_client')
    def test_get_instructor_evaluations_success(self, mock_supabase, client):
        """講師評価取得の成功ケース"""
        # モック設定
        mock_query = Mock()
        mock_query.order.return_value.limit.return_value.execute.return_value = Mock(
            data=[
                {
                    'id': 'inst_eval_1',
                    'conversation_id': 'conv_1',
                    'instructor_scores': {'questioning_skill': 8.0},
                    'created_at': '2025-12-30'
                },
                {
                    'id': 'inst_eval_2',
                    'conversation_id': 'conv_2',
                    'instructor_scores': {'questioning_skill': 7.0},
                    'created_at': '2025-12-29'
                }
            ]
        )
        mock_table = Mock()
        mock_table.select.return_value = mock_query
        mock_supabase.table.return_value = mock_table

        response = client.get('/api/instructor-evaluations')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'instructor_evaluations' in data
        assert len(data['instructor_evaluations']) == 2

    @patch('blueprints.evaluations.supabase_client')
    def test_get_instructor_evaluations_with_filters(self, mock_supabase, client):
        """フィルター付き講師評価取得"""
        # モック設定
        mock_query = Mock()
        mock_query.eq = Mock(return_value=mock_query)
        mock_query.order.return_value.limit.return_value.execute.return_value = Mock(
            data=[{'id': 'inst_eval_1'}]
        )
        mock_table = Mock()
        mock_table.select.return_value = mock_query
        mock_supabase.table.return_value = mock_table

        response = client.get('/api/instructor-evaluations?user_id=user_123&scenario_id=meeting_1st')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        # フィルターが適用されている（eqが呼ばれる）
        assert mock_query.eq.called

    @patch('blueprints.evaluations.supabase_client', None)
    def test_get_instructor_evaluations_no_database(self, client):
        """データベース未設定エラー"""
        response = client.get('/api/instructor-evaluations')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False


class TestGetEvaluationAccuracy:
    """評価精度レポートのテスト"""

    @patch('blueprints.evaluations.supabase_client')
    def test_get_evaluation_accuracy_success(self, mock_supabase, client):
        """評価精度レポート生成の成功ケース"""
        # モック設定
        mock_query = Mock()
        mock_query.eq = Mock(return_value=mock_query)
        mock_query.order.return_value.limit.return_value.execute.return_value = Mock(
            data=[
                {
                    'id': 'inst_eval_1',
                    'accuracy_metrics': {'overall_accuracy': 0.85, 'average_difference': 0.75},
                    'score_differences': {
                        'questioning_skill': 1.0,
                        'listening_skill': 0.5,
                        'proposal_skill': 0.0,
                        'closing_skill': 1.0
                    }
                },
                {
                    'id': 'inst_eval_2',
                    'accuracy_metrics': {'overall_accuracy': 0.90, 'average_difference': 0.5},
                    'score_differences': {
                        'questioning_skill': 0.5,
                        'listening_skill': 0.5,
                        'proposal_skill': 0.5,
                        'closing_skill': 0.5
                    }
                }
            ]
        )
        mock_table = Mock()
        mock_table.select.return_value = mock_query
        mock_supabase.table.return_value = mock_table

        response = client.get('/api/evaluation-accuracy')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'report' in data
        assert data['report']['total_evaluations'] == 2
        assert 'overall_accuracy' in data['report']
        assert 'accuracy_by_metric' in data['report']
        assert 'average_difference' in data['report']

    @patch('blueprints.evaluations.supabase_client')
    def test_get_evaluation_accuracy_no_data(self, mock_supabase, client):
        """評価データがない場合"""
        # モック設定（空データ）
        mock_query = Mock()
        mock_query.eq = Mock(return_value=mock_query)
        mock_query.order.return_value.limit.return_value.execute.return_value = Mock(data=[])
        mock_table = Mock()
        mock_table.select.return_value = mock_query
        mock_supabase.table.return_value = mock_table

        response = client.get('/api/evaluation-accuracy')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert data['report']['total_evaluations'] == 0
        assert '評価データがありません' in data['report']['message']

    @patch('blueprints.evaluations.supabase_client')
    def test_get_evaluation_accuracy_with_scenario_filter(self, mock_supabase, client):
        """シナリオフィルター付き評価精度レポート"""
        # モック設定
        mock_query = Mock()
        mock_query.eq = Mock(return_value=mock_query)
        mock_query.order.return_value.limit.return_value.execute.return_value = Mock(
            data=[
                {
                    'id': 'inst_eval_1',
                    'accuracy_metrics': {'overall_accuracy': 0.85},
                    'score_differences': {'questioning_skill': 1.0}
                }
            ]
        )
        mock_table = Mock()
        mock_table.select.return_value = mock_query
        mock_supabase.table.return_value = mock_table

        response = client.get('/api/evaluation-accuracy?scenario_id=meeting_1st')

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        # シナリオIDフィルターが適用されている
        assert mock_query.eq.called

    @patch('blueprints.evaluations.supabase_client', None)
    def test_get_evaluation_accuracy_no_database(self, client):
        """データベース未設定エラー"""
        response = client.get('/api/evaluation-accuracy')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False


class TestErrorHandling:
    """エラーハンドリングテスト"""

    @patch('blueprints.evaluations.supabase_client')
    def test_save_evaluation_database_exception(self, mock_supabase, client):
        """データベース例外の処理"""
        # Supabaseでエラーを発生させる
        mock_supabase.table.side_effect = Exception('Database error')

        request_data = {
            'conversation_id': 'conv_123',
            'evaluation_id': 'eval_123',
            'instructor_scores': {'questioning_skill': 8.0}
        }

        response = client.post('/api/instructor-evaluations', json=request_data)

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
        assert 'error' in data

    @patch('blueprints.evaluations.supabase_client')
    def test_get_evaluations_database_exception(self, mock_supabase, client):
        """評価取得時のデータベース例外"""
        mock_supabase.table.side_effect = Exception('Database error')

        response = client.get('/api/instructor-evaluations')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False

    @patch('blueprints.evaluations.supabase_client')
    def test_accuracy_report_database_exception(self, mock_supabase, client):
        """精度レポート生成時のデータベース例外"""
        mock_supabase.table.side_effect = Exception('Database error')

        response = client.get('/api/evaluation-accuracy')

        assert response.status_code == 500
        data = response.get_json()
        assert data['success'] is False
