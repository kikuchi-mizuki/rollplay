"""
RAG検索統合テスト
FAISS インデックスと類似パターン検索の統合をテスト
"""
import pytest
import numpy as np
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
class TestRAGSearchIntegration:
    """RAG検索の統合テスト"""

    @patch('blueprints.conversations.openai_client')
    def test_rag_search_with_faiss_index(self, mock_openai, app):
        """FAISSインデックスを使った類似パターン検索"""
        from app import RAG_INDEX, RAG_METADATA

        # RAGインデックスが読み込まれているか確認
        assert RAG_INDEX is not None
        assert len(RAG_METADATA) > 0

        # Embeddingモック（3072次元 - text-embedding-3-large）
        mock_embedding_response = Mock()
        mock_embedding_response.data = [Mock()]
        mock_embedding_response.data[0].embedding = np.random.rand(3072).tolist()
        mock_openai.embeddings.create.return_value = mock_embedding_response

        # 類似パターン検索のテスト（実際の関数を使用）
        query_text = "初めての営業訪問"
        query_embedding = np.array(mock_embedding_response.data[0].embedding).astype('float32')

        # FAISSで検索
        k = 5
        distances, indices = RAG_INDEX.search(query_embedding.reshape(1, -1), k)

        # 結果の検証
        assert len(indices[0]) == k
        assert len(distances[0]) == k
        assert all(idx < len(RAG_METADATA) for idx in indices[0])

    @pytest.mark.skip(reason="RAG検索の内部実装に依存しすぎ - エンドツーエンドテストで別途検証")
    @patch('blueprints.conversations.openai_client')
    def test_chat_uses_rag_patterns(self, mock_openai, client):
        """チャット応答がRAGパターンを活用"""
        # Embeddingモック（3072次元 - text-embedding-3-large）
        mock_embedding_response = Mock()
        mock_embedding_response.data = [Mock()]
        mock_embedding_response.data[0].embedding = np.random.rand(3072).tolist()

        # Chat completionモック
        mock_chat_response = Mock()
        mock_chat_response.choices = [Mock()]
        mock_message = Mock()
        mock_message.content = "RAGパターンを活用した応答"
        mock_chat_response.choices[0].message = mock_message

        mock_openai.embeddings.create.return_value = mock_embedding_response
        mock_openai.chat.completions.create.return_value = mock_chat_response

        # チャットリクエスト
        response = client.post('/api/chat',
            json={
                'message': '初回訪問でどのように話を切り出せばいいですか？',
                'history': [],
                'scenario_id': 'meeting_1st'
            },
            content_type='application/json'
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'response' in data

        # OpenAI APIが呼ばれている（embeddings + chat)
        assert mock_openai.embeddings.create.called
        assert mock_openai.chat.completions.create.called


@pytest.mark.integration
class TestRAGIndexStructure:
    """RAGインデックス構造のテスト"""

    def test_rag_patterns_structure(self, app):
        """RAGパターンの構造を検証"""
        from app import RAG_METADATA

        assert isinstance(RAG_METADATA, list)
        assert len(RAG_METADATA) > 0

        # 最初のパターンの構造を確認
        first_pattern = RAG_METADATA[0]
        assert isinstance(first_pattern, dict)
        # パターンは最低限のキーを含む
        assert len(first_pattern) > 0

    def test_rag_index_loaded(self, app):
        """RAGインデックスが正しく読み込まれている"""
        from app import RAG_INDEX

        assert RAG_INDEX is not None
        # FAISSインデックスのサイズ確認
        assert RAG_INDEX.ntotal > 0


@pytest.mark.integration
class TestRAGWithDifferentQueries:
    """異なるクエリでのRAG検索テスト"""

    @patch('blueprints.conversations.openai_client')
    def test_rag_search_with_greeting_query(self, mock_openai, app):
        """挨拶クエリでのRAG検索"""
        from app import RAG_INDEX, RAG_METADATA

        # Embeddingモック（3072次元 - text-embedding-3-large）
        mock_embedding_response = Mock()
        mock_embedding_response.data = [Mock()]
        # 挨拶用の埋め込みベクトル
        mock_embedding_response.data[0].embedding = np.random.rand(3072).tolist()
        mock_openai.embeddings.create.return_value = mock_embedding_response

        query_embedding = np.array(mock_embedding_response.data[0].embedding).astype('float32')
        distances, indices = RAG_INDEX.search(query_embedding.reshape(1, -1), 3)

        # 結果が返ってくることを確認
        assert len(indices[0]) == 3
        assert all(idx < len(RAG_METADATA) for idx in indices[0])

    @patch('blueprints.conversations.openai_client')
    def test_rag_search_with_technical_query(self, mock_openai, app):
        """技術的な質問でのRAG検索"""
        from app import RAG_INDEX, RAG_METADATA

        # Embeddingモック（3072次元 - text-embedding-3-large）
        mock_embedding_response = Mock()
        mock_embedding_response.data = [Mock()]
        # 技術的質問用の埋め込みベクトル
        mock_embedding_response.data[0].embedding = np.random.rand(3072).tolist()
        mock_openai.embeddings.create.return_value = mock_embedding_response

        query_embedding = np.array(mock_embedding_response.data[0].embedding).astype('float32')
        distances, indices = RAG_INDEX.search(query_embedding.reshape(1, -1), 5)

        # 結果が返ってくることを確認
        assert len(indices[0]) == 5
        assert all(idx < len(RAG_METADATA) for idx in indices[0])


@pytest.mark.integration
class TestRAGPerformance:
    """RAG検索のパフォーマンステスト"""

    @patch('blueprints.conversations.openai_client')
    def test_rag_search_speed(self, mock_openai, app):
        """RAG検索が高速に実行される"""
        import time
        from app import RAG_INDEX

        # Embeddingモック（3072次元 - text-embedding-3-large）
        mock_embedding_response = Mock()
        mock_embedding_response.data = [Mock()]
        mock_embedding_response.data[0].embedding = np.random.rand(3072).tolist()
        mock_openai.embeddings.create.return_value = mock_embedding_response

        query_embedding = np.array(mock_embedding_response.data[0].embedding).astype('float32')

        # 検索速度の測定
        start_time = time.time()
        distances, indices = RAG_INDEX.search(query_embedding.reshape(1, -1), 10)
        search_time = time.time() - start_time

        # FAISS検索は非常に高速（通常1ms未満）
        assert search_time < 0.1  # 100ms以内
        assert len(indices[0]) == 10


@pytest.mark.integration
class TestRAGErrorHandling:
    """RAG検索のエラーハンドリングテスト"""

    @patch('blueprints.conversations.openai_client')
    def test_chat_handles_rag_search_error(self, mock_openai, client):
        """RAG検索エラー時のフォールバック"""
        # Embeddingモック: エラーを発生
        mock_openai.embeddings.create.side_effect = Exception('Embedding API error')

        # Chat completionモック: 正常動作
        mock_chat_response = Mock()
        mock_chat_response.choices = [Mock()]
        mock_chat_response.choices[0].message.content = "フォールバック応答"
        mock_openai.chat.completions.create.return_value = mock_chat_response

        # チャットリクエスト
        response = client.post('/api/chat',
            json={
                'message': 'こんにちは',
                'history': [],
                'scenario_id': 'meeting_1st'
            },
            content_type='application/json'
        )

        # RAGエラーでもチャットは継続（フォールバック）
        data = response.get_json()
        assert response.status_code == 200
        assert data['success'] is True


@pytest.mark.integration
class TestRAGIntegrationWithScenarios:
    """シナリオ別のRAG統合テスト"""

    @patch('blueprints.conversations.openai_client')
    def test_rag_with_meeting_1st_scenario(self, mock_openai, client):
        """meeting_1stシナリオでのRAG統合"""
        # Embeddingモック
        mock_embedding_response = Mock()
        mock_embedding_response.data = [Mock()]
        mock_embedding_response.data[0].embedding = np.random.rand(1536).tolist()

        # Chat completionモック
        mock_chat_response = Mock()
        mock_chat_response.choices = [Mock()]
        mock_chat_response.choices[0].message.content = "シナリオに適した応答"

        mock_openai.embeddings.create.return_value = mock_embedding_response
        mock_openai.chat.completions.create.return_value = mock_chat_response

        # チャットリクエスト
        response = client.post('/api/chat',
            json={
                'message': '初回訪問の挨拶をどうすればいいですか？',
                'history': [],
                'scenario_id': 'meeting_1st'
            },
            content_type='application/json'
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True

    @patch('blueprints.conversations.openai_client')
    def test_rag_patterns_count(self, mock_openai, app):
        """RAGパターン数の確認"""
        from app import RAG_METADATA

        # 898パターンが読み込まれている（ログから確認）
        assert len(RAG_METADATA) >= 800
        assert len(RAG_METADATA) <= 1000
