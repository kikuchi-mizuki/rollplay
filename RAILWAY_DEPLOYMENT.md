# 🚂 Railway デプロイ手順（フロントエンド + バックエンド）

フロントエンドとバックエンドの両方をRailwayでデプロイする完全ガイドです。

## 📋 前提条件

- Railwayアカウント（https://railway.app/）
- GitHubアカウント
- Supabaseアカウント
- OpenAI APIキー

## 🏗️ デプロイ構成

```
Railway Project
├── Backend Service (Python/Flask)
│   └── PORT: 自動割り当て
└── Frontend Service (Node.js/Vite)
    └── PORT: 自動割り当て
```

## 📦 事前準備

### 1. GitHubリポジトリにプッシュ

```bash
cd /path/to/rollplay

# Gitリポジトリ初期化（まだの場合）
git init
git add .
git commit -m "Initial commit: 営業ロープレ自動化システム"

# GitHubにプッシュ
git remote add origin https://github.com/your-username/rollplay.git
git push -u origin main
```

### 2. Railway設定ファイルの作成

プロジェクトのルートに以下のファイルを作成：

#### `railway.json`

```json
{
  "version": 2,
  "builds": [
    {
      "src": "app.py",
      "use": "@railway/python"
    },
    {
      "src": "package.json",
      "use": "@railway/node"
    }
  ]
}
```

## 🚀 Railwayデプロイ手順

### ステップ1: プロジェクト作成

1. Railway Dashboard（https://railway.app/dashboard）にアクセス
2. **New Project** をクリック
3. **Deploy from GitHub repo** を選択
4. リポジトリを接続（初回のみGitHub認証が必要）
5. `rollplay`リポジトリを選択

### ステップ2: バックエンドサービスのデプロイ

#### 2-1. サービス作成

1. プロジェクト内で **New Service** をクリック
2. **GitHub Repo** を選択
3. 同じ`rollplay`リポジトリを選択
4. サービス名を`backend`に設定

#### 2-2. 環境変数設定

**Variables** タブで以下を追加：

```env
# OpenAI API
OPENAI_API_KEY=sk-...

# Supabase
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...

# Flask設定
FLASK_ENV=production
PYTHONUNBUFFERED=1
```

#### 2-3. ビルド設定

**Settings** タブ:

- **Root Directory**: 空欄（プロジェクトルート）
- **Build Command**: （自動検出）
- **Start Command**: `python3 app.py $PORT`
- **Watch Paths**: `app.py`, `requirements.txt`

#### 2-4. デプロイ確認

- デプロイが完了すると、URLが生成されます（例: `https://backend-production-xxxx.up.railway.app`）
- このURLをメモしておきます

### ステップ3: フロントエンドサービスのデプロイ

#### 3-1. サービス作成

1. プロジェクト内で **New Service** をクリック
2. **GitHub Repo** を選択
3. 同じ`rollplay`リポジトリを選択
4. サービス名を`frontend`に設定

#### 3-2. 環境変数設定

**Variables** タブで以下を追加：

```env
# Supabase
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...

# バックエンドURL（ステップ2-4でメモしたURL）
VITE_API_BASE_URL=https://backend-production-xxxx.up.railway.app

# Node環境
NODE_ENV=production
```

#### 3-3. ビルド設定

**Settings** タブ:

- **Root Directory**: 空欄（プロジェクトルート）
- **Install Command**: `npm install`
- **Build Command**: `npm run build`
- **Start Command**: `npm run preview -- --port $PORT --host 0.0.0.0`
- **Watch Paths**: `package.json`, `src/**/*`, `index.html`

#### 3-4. package.jsonの確認

`package.json`に以下のスクリプトがあることを確認：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

### ステップ4: フロントエンドの環境変数設定

`src/lib/api.ts`を更新して、本番環境でバックエンドURLを使用：

```typescript
// バックエンドAPIのベースURL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
                     (import.meta.env.DEV ? 'http://localhost:5001' : '');
```

この変更をコミット＆プッシュ：

```bash
git add src/lib/api.ts
git commit -m "feat: 本番環境のバックエンドURL対応"
git push
```

### ステップ5: CORS設定の更新

`app.py`のCORS設定を本番URL対応に更新：

```python
# app.py
from flask_cors import CORS

# 本番環境のフロントエンドURLを追加
FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:3000')

CORS(app, origins=[
    'http://localhost:3000',
    'http://localhost:5173',
    FRONTEND_URL  # Railway フロントエンドURL
])
```

バックエンドの環境変数に追加：

```env
FRONTEND_URL=https://frontend-production-xxxx.up.railway.app
```

この変更をコミット＆プッシュ：

```bash
git add app.py
git commit -m "feat: CORS設定を本番環境対応"
git push
```

## 🔧 カスタムドメイン設定（オプション）

### バックエンド

1. Backend serviceの**Settings** → **Domains**
2. **Generate Domain**または**Custom Domain**を設定
3. 例: `api.yourdomain.com`

### フロントエンド

1. Frontend serviceの**Settings** → **Domains**
2. **Generate Domain**または**Custom Domain**を設定
3. 例: `app.yourdomain.com`

## 📊 デプロイ確認チェックリスト

### バックエンド確認

- [ ] `https://your-backend-url.railway.app/api/scenarios` にアクセスしてJSONが返る
- [ ] ログにエラーがない
- [ ] 環境変数が正しく設定されている

### フロントエンド確認

- [ ] `https://your-frontend-url.railway.app` にアクセスできる
- [ ] ログイン画面が表示される
- [ ] Google認証が動作する
- [ ] バックエンドAPIと通信できる

### 統合テスト

- [ ] Google認証でログインできる
- [ ] 店舗コードで登録できる
- [ ] AI対話が動作する
- [ ] 講評生成が動作する
- [ ] 履歴が保存される
- [ ] 管理者ダッシュボードが表示される

## 💰 Railwayコスト

**無料枠:**
- $5 相当のクレジット/月
- 小規模テストに十分

**有料プラン:**
- Developer Plan: $5/月 + 使用量
- 使用量: リソース使用時間とストレージに応じて課金

**推定コスト（本システム）:**
- バックエンド: 月$5-10程度
- フロントエンド: 月$5-10程度
- 合計: 月$10-20程度（100店舗規模なら月$20-50程度）

## 🔍 トラブルシューティング

### 問題: バックエンドが起動しない

**確認事項:**
1. `railway logs`でエラーログを確認
2. `requirements.txt`に全ての依存関係があるか確認
3. `Start Command`が`python3 app.py $PORT`になっているか確認

### 問題: フロントエンドがバックエンドに接続できない

**確認事項:**
1. `VITE_API_BASE_URL`が正しく設定されているか
2. バックエンドのCORSにフロントエンドURLが追加されているか
3. バックエンドが正常に動作しているか

### 問題: ビルドが失敗する

**フロントエンドの場合:**
```bash
# ローカルでビルドテスト
npm run build
```

**バックエンドの場合:**
```bash
# 依存関係の確認
pip install -r requirements.txt
```

## 🔄 デプロイ後の更新

コードを更新してGitHubにプッシュすると、Railwayが自動的に再デプロイします：

```bash
git add .
git commit -m "機能追加: XXX"
git push
```

## 📞 サポート

問題がある場合：
1. Railway Dashboard でログを確認
2. `railway logs --service backend`（CLI使用時）
3. GitHub Issuesで報告

---

**Railway デプロイ完了！** 🎊

本番環境でのシステム稼働が可能になりました。
