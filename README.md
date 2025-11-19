# 🎬 営業ロープレ自動化システム - Whisper/GPT版（基本版完成）

AIが顧客役を演じ、営業トレーニングを自動化するシステムです。音声認識は OpenAI Whisper、対話生成/評価は GPT-4 を使用します。

## 🎉 進捗状況

**最終更新**: 2025年11月20日
**開発進捗**: 65%完成（Week 1-4, 6, 8 完了 / 全8週間）
**ステータス**: 主要機能実装完了、デプロイ可能

### ✅ 基本版（STEP 0-6）完了

- ✅ STEP 0: MVPデモ版構築
- ✅ STEP 1: テキスト版＋講評生成
- ✅ STEP 2: 音声入出力対応（Whisper API + Web Speech API TTS統合完了）
- ✅ STEP 3: 映像UI実装
- ✅ STEP 4: シナリオ管理構造・評価ルーブリック整備
- ✅ STEP 6: RAG連携（Embedding検索）実装完了
- ✅ React版フロントエンド統合（実録音機能対応）

### ✅ Week 1: Google認証 + 店舗管理基盤（完了 - 2025-11-11）

**実装済み機能:**
- ✅ **Supabase統合**
  - プロジェクト作成（Tokyo リージョン）
  - データベース設計・構築（4テーブル）
  - Row Level Security (RLS) 設定
- ✅ **Google OAuth認証**
  - ログイン・ログアウト機能
  - 店舗コード検証付き初回登録フロー
  - 認証状態管理（AuthContext）
- ✅ **本部管理者機能**
  - 店舗コード自動生成（8桁英数字）
  - 店舗管理画面（追加・削除・一覧表示）
- ✅ **ダークテーマUI統一**
  - 全認証画面をダークグラデーション背景に統一
  - ガラスカードエフェクト
  - レスポンシブデザイン

**データベース構造:**
- `stores` - 店舗マスタ
- `profiles` - ユーザープロフィール（Supabase Auth連携）
- `conversations` - 会話履歴
- `evaluations` - 評価履歴

### 🔄 Week 2: 6シナリオ構築 + RAG構築（60%完了 - 2025-11-20）

**実装済み:**
- ✅ **6シナリオのJSON作成完了**
  - meeting_1st（1次面談）
  - meeting_1_5th（1.5次面談）
  - meeting_2nd（2次面談）
  - meeting_3rd（3次面談）
  - kickoff_meeting（キックオフMTG）
  - upsell（追加営業）
- ✅ **音声データ準備完了**（27本のmp3ファイル）
- 🔄 **音声データの文字起こし**（3/27完了、進行中）
- 🔄 **RAGインデックス構築**（49件/600-800件目標、初期段階）

### ✅ Week 3: データ永続化（完了 - 2025-11-20）

**実装済み:**
- ✅ **Supabase統合（バックエンド）**
  - 会話履歴保存API（`/api/conversations`）
  - 評価履歴保存API（`/api/evaluations`）
  - 自動保存機能
- ✅ **シナリオ切替UI**
  - 6シナリオ選択機能（ヘッダー）
  - シナリオ別に会話・評価を保存

### ✅ Week 4: 履歴閲覧 + CSV出力（完了 - 2025-11-20）

**実装済み:**
- ✅ **過去の練習一覧**（HistoryPage）
  - 会話履歴・評価履歴の表示
  - シナリオ別フィルター機能
- ✅ **会話の再生（読み返し）**
- ✅ **評価の振り返り**
  - スコア詳細表示（質問力・傾聴力・提案力・クロージング力）
- ✅ **スコア推移グラフ**（ScoreChart）
  - 時系列でのスコア変化を可視化
  - シナリオ別平均スコア表示
- ✅ **CSV出力機能**
  - 会話履歴CSV出力
  - 評価履歴CSV出力

### ✅ Week 6: 店舗管理機能強化（完了 - 2025-11-20）

**実装済み:**
- ✅ **バックエンドAPI**
  - `/api/admin/stores/stats` - 全店舗統計情報
  - `/api/admin/stores/rankings` - 店舗別ランキング
  - `/api/stores/{id}/members` - 店舗メンバー一覧
  - `/api/stores/{id}/analytics` - 店舗分析データ
- ✅ **本部管理者ダッシュボード**（AdminDashboardPage）
  - 全店舗統計カード（店舗数、ユーザー数、練習回数、評価回数、平均スコア）
  - 店舗別ランキング表示（平均スコア順）
  - リージョン表示
- ✅ **店舗管理者ダッシュボード**（StoreDashboardPage）
  - 自店舗統計カード
  - シナリオ別スコア分析
  - メンバー一覧と個別スコア表示

### ✅ Week 8: テスト・デプロイ準備（完了 - 2025-11-20）

**実装済み:**
- ✅ **アプリケーション起動確認**
  - Python構文チェック完了
  - バックエンド起動可能確認
- ✅ **デプロイ手順書作成**（DEPLOYMENT.md）
  - 環境変数設定手順
  - データベースセットアップ手順
  - ローカル開発環境構築手順
  - 本番デプロイ手順（Vercel + Railway）
  - トラブルシューティングガイド
  - コスト試算

### ⏳ 残タスク（オプション）

**Week 2の残タスク:**
- 音声データの文字起こし完了（24/27ファイル未完了）
- RAGデータベース拡充（49件 → 600-800件）

**Week 5: 評価精度向上（オプション）:**
- プロンプトチューニング
- Few-shot作成
- Rubric調整

**Week 7: パフォーマンス最適化（オプション）:**
- データベース最適化
- 同時アクセス対応

## 🚀 機能

- **音声入力**: マイクで録音 → Whisper API で文字起こし
- **AI対話**: GPT-4o-mini が顧客役として自然に応答
- **音声出力**: Web Speech API でTTS再生（日本語対応）
- **映像UI**: 返答内容に応じて画像/動画と字幕を自動切替
- **AI講評**: 4軸評価（質問力・傾聴力・提案力・クロージング力）
- **シナリオ管理**: JSON形式でシナリオを簡単に追加・管理

## 🛠️ 技術スタック

- **フロントエンド**: React + TypeScript + Vite
- **バックエンド**: Python Flask
- **データベース**: Supabase (PostgreSQL)
- **認証**: Supabase Auth (Google OAuth)
- **AI**: OpenAI Whisper / GPT-4o-mini / GPT-4
- **RAG**: FAISS + text-embedding-3-large
- **音声**: MediaRecorder API + Web Speech API + pydub(ffmpeg)
- **データ**: JSON（シナリオ） + YAML（Rubric） + PostgreSQL（ユーザー・会話・評価）

## 📦 セットアップ

### 1. 依存関係のインストール

```bash
pip install -r requirements.txt
```

### 2. ffmpeg の導入（pydub 用）

macOS:
```bash
brew install ffmpeg
```

### 3. 環境変数の設定

`env_example.txt` を参考に `.env` を作成し、必要なAPIキーを設定してください。

```bash
cp env_example.txt .env
# .env を編集
```

**必要な環境変数:**
```env
# OpenAI API
OPENAI_API_KEY=sk-...

# Supabase（Week 1で追加）
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

詳細は `開発手順書.md` の Week 1 を参照してください。

### 4. アプリケーションの起動

**バックエンド:**
```bash
python app.py 5001
```

**フロントエンド（別ターミナル）:**
```bash
npm run dev
```

ブラウザで `http://localhost:3000` にアクセスします。

## 🚀 Railway デプロイ

フロントエンドとバックエンドの両方をRailwayでデプロイできます：

- **クイックスタート**: [RAILWAY_QUICKSTART.md](./RAILWAY_QUICKSTART.md) - 5分でデプロイ
- **詳細手順**: [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) - 完全ガイド

## 🎯 使用方法

1. マイクボタンで録音し、音声を送信
2. テキストでも送信可能
3. 「講評を見る」で評価を表示
4. 映像UIがAIの返答に合わせて自動で切り替わります（字幕は `$AUTO` で返答を表示）

## 📁 プロジェクト構造

```
rollplay/
├── app.py                 # Flask アプリ
├── requirements.txt       # Python依存関係
├── package.json           # Node.js依存関係
├── env_example.txt        # 環境変数サンプル
├── 要件定義書.md          # システム要件定義（v4.0）
├── 開発手順書.md          # 8週間開発ガイド
├── scenarios/             # シナリオ管理（STEP4）
│   ├── index.json         # シナリオ一覧・有効管理
│   └── rp_intro_v1.json   # シナリオ例
├── rubrics/               # 評価基準（STEP4）
│   └── rubric.yaml        # Rubric評価定義
├── database/              # Supabase SQLマイグレーション（Week 1）
│   ├── 01_create_stores.sql
│   ├── 02_create_profiles.sql
│   ├── 03_create_conversations.sql
│   ├── 04_create_evaluations.sql
│   ├── 05_rls_policies.sql
│   └── 06_fix_rls_circular_reference.sql
├── templates/
│   └── index.html         # メインHTML（Vanilla JS版）
├── static/
│   ├── style.css          # スタイル
│   ├── script.js          # JavaScript
│   └── storyboard/        # 映像シーン設定（STEP3）
│       └── default.story.json
├── src/                   # React版フロントエンド（Week 1実装）
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── Auth/
│   │   │   ├── LoginPage.tsx       # ログイン画面
│   │   │   ├── RegisterPage.tsx    # 初回登録画面
│   │   │   └── AuthCallback.tsx    # OAuthコールバック
│   │   ├── Admin/
│   │   │   └── StoreManagementPage.tsx  # 店舗管理画面
│   │   ├── Header.tsx
│   │   └── ...
│   ├── contexts/
│   │   └── AuthContext.tsx         # 認証状態管理
│   ├── lib/
│   │   └── supabase.ts             # Supabaseクライアント
│   └── ...
├── conversations/         # 会話履歴保存
└── README.md
```

## 🎨 フロントエンド

2つのフロントエンドがあります：

### 1. Vanilla JS版（デフォルト）
- ファイル: `templates/index.html` + `static/script.js`
- 動作確認済み、バックエンド統合済み
- 起動: `python app.py 5001` → `http://localhost:5001`

### 2. React版（モダンUI）
- ファイル: `src/`
- 実録音機能対応、バックエンド統合済み
- 起動: `npm run dev` → `http://localhost:3000`
- バックエンドは別ターミナルで `python app.py 5001` を起動

## 🎬 映像UI（STEP3）

ストーリーボードファイルで、会話の段階ごとに表示する素材を定義します。

パス: `static/storyboard/default.story.json`

例:

```
{
  "default": { "type": "image", "src": "/static/assets/neutral.jpg", "subtitle": "$AUTO" },
  "greeting": { "type": "image", "src": "/static/assets/greeting.jpg", "subtitle": "$AUTO" },
  "needs_analysis": { "type": "image", "src": "/static/assets/needs.jpg", "subtitle": "$AUTO" },
  "proposal": { "type": "image", "src": "/static/assets/proposal.jpg", "subtitle": "$AUTO" },
  "objection_handling": { "type": "image", "src": "/static/assets/objection.jpg", "subtitle": "$AUTO" },
  "closing": { "type": "image", "src": "/static/assets/closing.jpg", "subtitle": "$AUTO" }
}
```

- `type`: `image` または `video`
- `src`: `/static` 配下のパスを指定
- `subtitle`: `$AUTO` を指定するとAI返答の本文を字幕として表示。任意の固定文字列も可

素材配置例:

```
static/
  assets/
    greeting.jpg
    needs.jpg
    proposal.jpg
    objection.jpg
    closing.jpg
    neutral.jpg
```

会話段階は以下のヒューリスティックで自動判定されます。

- greeting, needs_analysis, proposal, objection_handling, closing

判定はキーワードベース（例: こんにちは→greeting、提案/サービス→proposal 等）。

## 📊 評価基準（STEP4）

Rubricファイルで評価基準を管理します。

パス: `rubrics/rubric.yaml`

4つの評価軸で5段階評価：
- **質問力**: 顧客のニーズ・課題を適切に引き出す質問
- **傾聴力**: 相手の発言を理解し、適切に受容・共感
- **提案力**: 顧客の課題に対する具体的な解決策を提示
- **クロージング力**: 次のアクション・決定を促す適切なクロージング

## 📚 シナリオ管理（STEP4）

シナリオをJSON形式で管理します。

パス: `scenarios/`

- `index.json`: シナリオ一覧と有効/無効管理
- `rp_*.json`: 各シナリオの定義（ペルソナ、ガイドライン、初期発話など）

### 新しいシナリオを追加する方法

1. **シナリオファイルを作成**
   - `scenarios/` ディレクトリに新しいJSONファイルを作成
   - 例: `rp_pricing_v1.json`

2. **シナリオ定義を記述**
   ```json
   {
     "id": "rp_pricing_v1",
     "title": "価格交渉",
     "persona": {
       "customer_role": "店舗オーナー",
       "tone": "慎重",
       "pain_points": ["予算制約", "コスト削減"],
       "business_size": "中小規模"
     },
     "guidelines": [
       "価格に関する懸念を積極的に表現する",
       "予算の制約を明確に伝える"
     ],
     "utterances": [
       { "speaker": "営業", "text": "ご提案させていただいたプランについて、いかがでしょうか？" },
       { "speaker": "お客様", "text": "価格の点で、もう少し抑えられませんか？" }
     ],
     "expected_flow": ["proposal", "objection_handling", "closing"]
   }
   ```

3. **index.jsonに登録**
   ```json
   {
     "default_id": "rp_intro_v1",
     "scenarios": [
       { "id": "rp_intro_v1", "file": "rp_intro_v1.json", "title": "初回ヒアリング", "enabled": true },
       { "id": "rp_pricing_v1", "file": "rp_pricing_v1.json", "title": "価格交渉", "enabled": true }
     ]
   }
   ```

4. **Flaskサーバーを再起動**
   - シナリオは起動時に読み込まれます
   - 新しいシナリオを反映するにはサーバー再起動が必要です

## 🔧 メモ

- 音声録音は HTTPS での利用を推奨（ローカルは許可ダイアログで動作）
- Whisper/GPT 利用には `OPENAI_API_KEY` が必須
- Rubricは起動時に自動読み込みされます

## 📞 サポート

問題があれば Issue/お問い合わせください。
