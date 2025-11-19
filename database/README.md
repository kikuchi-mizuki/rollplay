# データベーススキーマ - Week 1 Day 3

## 📋 概要

SNS動画営業ロープレシステムのデータベーススキーマ定義です。

## 🗄️ テーブル構成

### 1. stores（店舗マスタ）
- フランチャイズ各店舗の情報
- 店舗コード（STORE_001形式）で管理

### 2. profiles（ユーザープロフィール）
- Supabase Auth連携
- 店舗所属・権限管理

### 3. conversations（会話履歴）
- ロープレの会話内容を保存
- JSONB形式でメッセージ配列を保存

### 4. evaluations（評価履歴）
- AI評価結果を保存
- スコアとコメントをJSONB形式で保存

## 🚀 実行手順

### **方法1: マスタースクリプトで一括実行（推奨）**

1. Supabase Dashboardにアクセス
2. 左メニュー → 「SQL Editor」をクリック
3. 「New query」をクリック
4. `00_master_schema.sql` の内容をコピー&ペースト
5. 「Run」をクリック

### **方法2: 個別テーブルごとに実行**

以下の順序で実行してください：

```
01_stores_table.sql       → 店舗マスタ
02_profiles_table.sql     → ユーザープロフィール
03_conversations_table.sql → 会話履歴
04_evaluations_table.sql  → 評価履歴
```

## ✅ 確認方法

### **テーブルが作成されたか確認**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('stores', 'profiles', 'conversations', 'evaluations');
```

### **サンプルデータが入っているか確認**

```sql
SELECT * FROM stores;
```

以下のような結果が表示されればOK：

```
store_code  | store_name    | region
------------|---------------|-------
STORE_001   | 東京銀座店    | 関東
STORE_002   | 大阪梅田店    | 関西
STORE_003   | 福岡天神店    | 九州
```

## 📊 ER図

```
stores (店舗マスタ)
  ├── id (PK)
  ├── store_code (UNIQUE)
  └── store_name

profiles (ユーザープロフィール)
  ├── id (PK, FK → auth.users)
  ├── store_id (FK → stores)
  ├── email (UNIQUE)
  └── role

conversations (会話履歴)
  ├── id (PK)
  ├── user_id (FK → profiles)
  ├── store_id (FK → stores)
  ├── scenario_id
  └── messages (JSONB)

evaluations (評価履歴)
  ├── id (PK)
  ├── conversation_id (FK → conversations)
  ├── user_id (FK → profiles)
  ├── store_id (FK → stores)
  ├── scores (JSONB)
  └── comments (JSONB)
```

## 🔒 次のステップ

Week 1 Day 4: RLS（Row Level Security）設定
→ データアクセス権限の設定
