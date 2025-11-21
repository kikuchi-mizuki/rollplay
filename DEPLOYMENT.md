# 🚀 デプロイ手順書

営業ロープレ自動化システムのデプロイ手順を説明します。

## 📋 前提条件

- Node.js 18以上
- Python 3.9以上
- Supabaseアカウント
- OpenAI APIキー

## 🔧 環境変数設定

### 必須環境変数

`.env`ファイルを作成し、以下の環境変数を設定してください：

```env
# OpenAI API
OPENAI_API_KEY=sk-...

# Supabase
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

### 環境変数の取得方法

**OpenAI API:**
1. https://platform.openai.com/api-keys にアクセス
2. 新しいAPIキーを作成
3. `OPENAI_API_KEY`に設定

**Supabase:**
1. https://supabase.com/ でプロジェクト作成（Tokyo リージョン推奨）
2. Settings → API でURL とAnon Keyを確認
3. `VITE_SUPABASE_URL`と`VITE_SUPABASE_ANON_KEY`に設定

## 🗄️ データベースセットアップ

Supabase SQL Editorで以下のスクリプトを順番に実行：

```bash
database/01_create_stores.sql
database/02_create_profiles.sql
database/03_create_conversations.sql
database/04_create_evaluations.sql
database/05_rls_policies.sql
database/06_fix_rls_circular_reference.sql
database/07_create_instructor_evaluations.sql  # Week 5追加
database/08_create_video_cache.sql  # Week 7追加
database/09_performance_indexes.sql  # Week 7追加
```

**重要:** `06_fix_rls_circular_reference.sql`は必ず実行してください（RLS循環参照の修正）。

または、`tools/setup_database.py`を使用：

```bash
python3 tools/setup_database.py
```

## 📦 依存関係のインストール

### バックエンド（Python）

```bash
pip install -r requirements.txt
```

必要なパッケージ：
- Flask
- openai
- python-dotenv
- supabase
- faiss-cpu
- pydub
- その他

### フロントエンド（React）

```bash
npm install
```

## 🏃 ローカル開発環境

### バックエンド起動

```bash
python3 app.py 5001
```

サーバーが`http://localhost:5001`で起動します。

### フロントエンド起動

```bash
npm run dev
```

開発サーバーが`http://localhost:3000`で起動します。

## 🌐 本番デプロイ

### オプション1: Vercel + Railway

**フロントエンド（Vercel）:**

1. GitHubリポジトリにプッシュ
2. Vercel でプロジェクトをインポート
3. 環境変数を設定：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. ビルド設定:
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`

**バックエンド（Railway）:**

1. Railway でプロジェクト作成
2. GitHubリポジトリを接続
3. 環境変数を設定：
   - `OPENAI_API_KEY`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. 起動コマンド: `python3 app.py $PORT`

### オプション2: Render

**バックエンド:**
1. Render でWeb Service作成
2. 環境変数設定
3. Start Command: `python3 app.py $PORT`

**フロントエンド:**
1. Render でStatic Site作成
2. Build Command: `npm run build`
3. Publish Directory: `dist`

## 🔒 セキュリティ設定

### CORS設定

本番環境では、app.pyのCORS設定を更新：

```python
CORS(app, origins=["https://your-domain.com"])
```

### 環境変数の保護

- `.env`ファイルをgitignoreに追加（既に設定済み）
- 本番環境では環境変数をプラットフォームの設定から注入

## 📊 初期データ設定

### 1. 本部管理者アカウント作成

1. Google認証でログイン
2. Supabase Dashboard → Table Editor → `profiles`
3. 自分のアカウントの`role`を`admin`に変更

### 2. 店舗コード発行

1. 本部管理者でログイン
2. `/admin/stores`にアクセス
3. 店舗を作成して店舗コードを発行

### 3. ユーザー招待

発行した店舗コードをユーザーに共有し、登録時に入力してもらう

## 🧪 動作確認チェックリスト

- [ ] バックエンドが起動する
- [ ] フロントエンドが起動する
- [ ] Google認証でログインできる
- [ ] 店舗コードで登録できる
- [ ] シナリオ選択ができる
- [ ] AI対話が動作する
- [ ] 音声入力が動作する（HTTPS必須）
- [ ] 講評生成が動作する
- [ ] 履歴が保存される
- [ ] 履歴ページで過去の練習が見れる
- [ ] CSV出力ができる
- [ ] 本部管理者ダッシュボードが表示される
- [ ] 店舗ダッシュボードが表示される

## 🐛 トラブルシューティング

### 問題: Supabaseに接続できない

**解決策:**
- 環境変数が正しく設定されているか確認
- Supabase URLとAnon Keyを再確認
- RLSポリシーが正しく設定されているか確認

### 問題: OpenAI APIエラー

**解決策:**
- APIキーが有効か確認
- API利用制限に達していないか確認
- クレジットが残っているか確認

### 問題: 音声録音が動作しない

**解決策:**
- HTTPSで接続しているか確認（localhost以外ではHTTPS必須）
- ブラウザのマイク権限を確認
- ブラウザがMediaRecorder APIをサポートしているか確認

## 📈 モニタリング

### ログ確認

**バックエンド:**
- Flask起動時のログを確認
- エラーはコンソールに出力される

**フロントエンド:**
- ブラウザのDevToolsコンソールを確認

### データベース

Supabase Dashboardで以下を確認：
- テーブルのレコード数
- クエリパフォーマンス
- RLSポリシーの動作

## 🔄 アップデート手順

1. コードを更新
2. 依存関係を更新（必要に応じて）
3. データベーススキーマを更新（必要に応じて）
4. 環境変数を追加/更新（必要に応じて）
5. デプロイ

## 💰 コスト試算

**月間コスト（100店舗想定）:**
- Supabase Pro: 2,500円
- バックエンドサーバー（Railway/Render）: 1-2万円
- OpenAI API: 3-8万円
- **合計: 約3.5-10.5万円/月**

## 📞 サポート

問題がある場合は、以下を確認してください：
- README.md - 基本的な使い方
- 要件定義書.md - システム仕様
- 開発手順書.md - 詳細な実装手順

---

**最終更新**: 2025年11月20日
**バージョン**: v1.0
