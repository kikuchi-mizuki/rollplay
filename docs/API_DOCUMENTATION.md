# API仕様書 - 営業ロープレ自動化システム

## 概要

営業ロープレ自動化システムのREST API仕様書です。このシステムは、AIが顧客役を演じ、営業トレーニングを自動化します。

## Swagger UI

対話的なAPI仕様書は以下のURLでアクセスできます：

```
http://localhost:5001/api/docs
```

サーバーを起動後、ブラウザで上記URLにアクセスすることで、すべてのエンドポイントを確認・テストできます。

## クイックスタート

### 1. サーバーの起動

```bash
python3 app.py 5001
```

### 2. Swagger UIにアクセス

ブラウザで以下にアクセス：
```
http://localhost:5001/api/docs
```

### 3. API仕様書の確認

OpenAPI仕様ファイル（YAML）は以下から直接取得可能：
```
http://localhost:5001/api/openapi.yaml
```

## 主要APIエンドポイント

### 会話管理（Conversations）

#### POST /api/chat
通常の会話応答（ストリーミングなし）

**リクエスト例：**
```json
{
  "message": "こんにちは、動画制作について相談したいです",
  "scenario_id": "meeting_1st",
  "history": []
}
```

**レスポンス例：**
```json
{
  "success": true,
  "response": "はい、どういった内容でしょうか？"
}
```

#### POST /api/chat-stream
ストリーミング会話応答（Server-Sent Events）

リアルタイムでAIの応答が生成されます。

#### POST /api/evaluate
会話の評価を生成

**リクエスト例：**
```json
{
  "scenario_id": "meeting_1st",
  "history": [
    {"role": "user", "text": "こんにちは"},
    {"role": "bot", "text": "はい、どういった..."}
  ]
}
```

#### GET /api/conversations
会話履歴一覧を取得

**クエリパラメータ：**
- `user_id`: ユーザーID（オプション）
- `store_id`: 店舗ID（オプション）
- `limit`: 取得件数（デフォルト: 50）

#### POST /api/conversations
会話履歴を保存

### 評価管理（Evaluations）

#### GET /api/evaluations
評価履歴一覧を取得

#### POST /api/evaluations
評価を保存

#### GET /api/instructor-evaluations
講師による評価一覧を取得

#### POST /api/instructor-evaluations
講師による評価を保存

#### GET /api/evaluation-accuracy
AI評価と講師評価の精度分析

### メディア処理（Media）

#### POST /api/tts
テキストから音声を生成（OpenAI TTS API使用）

**リクエスト例：**
```json
{
  "text": "こんにちは、AIアシスタントです",
  "voice": "alloy"
}
```

**音声ID：**
- `alloy` (デフォルト)
- `echo`
- `fable`
- `onyx`
- `nova`
- `shimmer`

#### POST /api/transcribe
音声ファイルをテキストに変換（OpenAI Whisper API使用）

**リクエスト形式：** `multipart/form-data`

**対応フォーマット：** WAV, MP3, M4A, WebM等

### シナリオ管理（Scenarios）

#### GET /api/scenarios
利用可能なシナリオ一覧を取得

**レスポンス例：**
```json
{
  "success": true,
  "scenarios": [
    {
      "id": "meeting_1st",
      "name": "1次面談",
      "description": "初回の営業面談シナリオ",
      "difficulty": "beginner"
    }
  ]
}
```

#### GET /api/scenarios/{scenario_id}
シナリオの詳細情報を取得

### 管理者機能（Admin）

#### GET /api/admin/stores/stats
全店舗の統計情報を取得

#### GET /api/admin/stores/rankings
店舗別ランキングを取得

#### GET /api/stores/{store_id}/members
指定店舗のメンバー一覧を取得

#### GET /api/admin/regions/stats
地域別統計情報を取得

#### GET /api/stores/{store_id}/analytics
指定店舗の詳細分析データを取得

#### GET /api/admin/export/evaluations
評価データをCSV形式でエクスポート

**クエリパラメータ：**
- `start_date`: 開始日（YYYY-MM-DD）
- `end_date`: 終了日（YYYY-MM-DD）

#### GET /api/admin/export/stores
店舗データをCSV形式でエクスポート

#### POST /api/clear-cache
システムキャッシュをクリア

## 認証

現在、認証は実装されていません。将来的にはJWTベースの認証を実装予定です。

## エラーハンドリング

すべてのエラーレスポンスは以下の形式で返されます：

```json
{
  "success": false,
  "error": "エラーメッセージ"
}
```

### HTTPステータスコード

- `200 OK`: リクエスト成功
- `400 Bad Request`: リクエストパラメータ不正
- `404 Not Found`: リソースが見つかりません
- `500 Internal Server Error`: サーバー内部エラー

## レート制限

現在、レート制限は実装されていません（flask-limiterが利用可能な場合は有効化可能）。

## 使用例

### cURLでの使用例

#### 会話応答を取得
```bash
curl -X POST http://localhost:5001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "こんにちは",
    "scenario_id": "meeting_1st",
    "history": []
  }'
```

#### 音声認識
```bash
curl -X POST http://localhost:5001/api/transcribe \
  -F "audio=@test.wav"
```

#### シナリオ一覧取得
```bash
curl http://localhost:5001/api/scenarios
```

### Pythonでの使用例

```python
import requests

# 会話応答を取得
response = requests.post('http://localhost:5001/api/chat', json={
    'message': 'こんにちは',
    'scenario_id': 'meeting_1st',
    'history': []
})
print(response.json())

# 音声認識
with open('test.wav', 'rb') as f:
    files = {'audio': f}
    response = requests.post('http://localhost:5001/api/transcribe', files=files)
    print(response.json())
```

### JavaScriptでの使用例

```javascript
// 会話応答を取得
const response = await fetch('http://localhost:5001/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: 'こんにちは',
    scenario_id: 'meeting_1st',
    history: []
  })
});
const data = await response.json();
console.log(data);

// ストリーミング応答
const eventSource = new EventSource('/api/chat-stream');
eventSource.onmessage = (event) => {
  console.log('Received:', event.data);
};
```

## データモデル

### Conversation（会話）
```json
{
  "id": "uuid",
  "user_id": "user123",
  "store_id": "store456",
  "scenario_id": "meeting_1st",
  "messages": [
    {
      "role": "user",
      "text": "こんにちは",
      "timestamp": "2024-01-01T12:00:00Z"
    }
  ],
  "created_at": "2024-01-01T12:00:00Z"
}
```

### Evaluation（評価）
```json
{
  "id": "uuid",
  "conversation_id": "conv123",
  "user_id": "user123",
  "scenario_id": "meeting_1st",
  "total_score": 85.5,
  "criteria_scores": {
    "rapport_building": 90,
    "needs_analysis": 85,
    "solution_presentation": 80
  },
  "feedback": "全体的に良好です...",
  "strengths": ["傾聴力が優れている"],
  "improvements": ["もっと具体的な質問を"],
  "created_at": "2024-01-01T12:30:00Z"
}
```

### Scenario（シナリオ）
```json
{
  "id": "meeting_1st",
  "name": "1次面談",
  "description": "初回の営業面談シナリオ",
  "difficulty": "beginner",
  "customer_persona": {
    "name": "山田太郎",
    "company": "株式会社サンプル",
    "personality": "慎重派"
  },
  "evaluation_criteria": {
    "rapport_building": {"weight": 0.3},
    "needs_analysis": {"weight": 0.4}
  }
}
```

## 開発者向け情報

### OpenAPI仕様ファイルの更新

OpenAPI仕様ファイルは以下の場所にあります：
```
docs/openapi.yaml
```

仕様を更新した場合は、サーバーを再起動してください。

### テスト

APIのテストは以下で実行できます：
```bash
python3 -m pytest tests/ -v
```

カバレッジ測定：
```bash
python3 -m pytest tests/ --cov=app --cov=blueprints --cov-report=term-missing
```

## サポート

質問やバグ報告は、プロジェクトのIssueトラッカーまで。

## 更新履歴

- **1.0.0** (2026-01-04): 初版リリース
  - 全エンドポイントのドキュメント化
  - Swagger UI統合
  - OpenAPI 3.0仕様準拠
