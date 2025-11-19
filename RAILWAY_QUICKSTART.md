# 🚀 Railway デプロイ クイックスタート

最短5分でデプロイできます！

## ⚡ 3ステップデプロイ

### ステップ1: GitHubにプッシュ（2分）

```bash
cd /path/to/rollplay

# 初回のみ
git init
git add .
git commit -m "Initial commit"

# GitHubリポジトリ作成後
git remote add origin https://github.com/YOUR_USERNAME/rollplay.git
git push -u origin main
```

### ステップ2: Railwayで2つのサービスをデプロイ（1分）

1. https://railway.app/new にアクセス
2. **Deploy from GitHub repo** → リポジトリ選択
3. 自動的にサービスが作成されます

### ステップ3: 環境変数を設定（2分）

#### バックエンドサービス

```env
OPENAI_API_KEY=sk-...
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

#### フロントエンドサービス

バックエンドのURLを取得してから設定：

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
VITE_API_BASE_URL=https://backend-production-xxxx.up.railway.app
```

バックエンドにも追加：

```env
FRONTEND_URL=https://frontend-production-xxxx.up.railway.app
```

## ✅ デプロイ完了！

フロントエンドのURLにアクセスして動作確認してください。

## 📝 詳細手順

詳しい手順は [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) を参照してください。

## 🔧 必要な環境変数まとめ

### バックエンド（backend service）

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `OPENAI_API_KEY` | OpenAI APIキー | `sk-...` |
| `VITE_SUPABASE_URL` | Supabase URL | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase Anon Key | `eyJhbGc...` |
| `FRONTEND_URL` | フロントエンドURL（CORS用） | `https://frontend-production-xxxx.up.railway.app` |

### フロントエンド（frontend service）

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `VITE_SUPABASE_URL` | Supabase URL | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase Anon Key | `eyJhbGc...` |
| `VITE_API_BASE_URL` | バックエンドURL | `https://backend-production-xxxx.up.railway.app` |

## 🐛 トラブルシューティング

### バックエンドが起動しない

**確認:**
- `requirements.txt`が最新か？
- Start Commandが`python3 app.py $PORT`になっているか？

**解決:**
```bash
# ローカルでテスト
python3 app.py 5001
```

### フロントエンドがバックエンドに接続できない

**確認:**
- `VITE_API_BASE_URL`が正しいか？（httpsか？trailing slashがないか？）
- バックエンドの`FRONTEND_URL`が設定されているか？

**解決:**
- Railway Dashboardでログを確認
- バックエンドのCORS設定を確認

### ビルドエラー

**フロントエンド:**
```bash
# ローカルでビルドテスト
npm run build
```

**バックエンド:**
```bash
# 依存関係テスト
pip install -r requirements.txt
```

## 💡 Tips

- デプロイ後は自動的に再デプロイされます（git push時）
- ログはRailway Dashboardで確認できます
- カスタムドメインはSettings → Domainsで設定できます

## 📞 サポート

問題がある場合は RAILWAY_DEPLOYMENT.md の詳細手順を確認してください。
