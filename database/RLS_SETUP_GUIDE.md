# RLS（Row Level Security）設定ガイド
## Week 1 Day 4

## 🔒 RLSとは？

Row Level Security（行レベルセキュリティ）は、データベースレベルでアクセス制御を行う機能です。

**設定することで:**
- ✅ ユーザーは自分のデータのみ閲覧・編集可能
- ✅ 店舗管理者は自店舗のデータを閲覧可能
- ✅ 本部管理者は全データにアクセス可能

---

## 🚀 実行手順（3分で完了）

### **Step 1: Supabase Dashboardにアクセス**

```
1. https://app.supabase.com/project/guargnhnblhiupjumkhe にアクセス
2. 左メニュー → 「SQL Editor」をクリック
3. 「+ New query」をクリック
```

### **Step 2: RLSポリシーのSQLを実行**

```
1. 以下のファイルの内容を全てコピー:
   database/05_rls_policies.sql

2. SQL Editorにペースト

3. 右下の「Run」ボタンをクリック

4. 成功メッセージが表示されればOK:
   "RLS（Row Level Security）の設定が完了しました！"
```

### **Step 3: 確認**

以下のSQLを実行して、ポリシーが作成されたか確認:

```sql
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename IN ('conversations', 'evaluations', 'profiles', 'stores')
ORDER BY tablename, policyname;
```

以下のようなポリシーが表示されればOK:

```
tablename      | policyname
---------------|--------------------------------
conversations  | Users can view own conversations
conversations  | Users can insert own conversations
conversations  | Managers can view store conversations
conversations  | Admins can view all conversations
evaluations    | Users can view own evaluations
evaluations    | Users can insert own evaluations
... 等
```

---

## 📋 設定されるポリシー一覧

### **conversations（会話履歴）**
- ✅ ユーザー: 自分の会話のみ閲覧・作成・更新・削除
- ✅ 店舗管理者: 自店舗の全会話を閲覧
- ✅ 本部管理者: 全会話を閲覧

### **evaluations（評価履歴）**
- ✅ ユーザー: 自分の評価のみ閲覧・作成・更新・削除
- ✅ 店舗管理者: 自店舗の全評価を閲覧
- ✅ 本部管理者: 全評価を閲覧

### **profiles（ユーザープロフィール）**
- ✅ ユーザー: 自分のプロフィールのみ閲覧・作成・更新
- ✅ 店舗管理者: 自店舗のユーザーを閲覧
- ✅ 本部管理者: 全ユーザーを閲覧・更新（権限変更可能）

### **stores（店舗マスタ）**
- ✅ 全ユーザー: 店舗情報を閲覧（登録時の店舗コード検証に必要）
- ✅ 本部管理者のみ: 店舗の作成・更新・削除

---

## ✅ 次のステップ

RLS設定が完了したら、Week 1 Day 5に進みます:
→ **フロントエンド - Supabase統合**

---

## 🔧 トラブルシューティング

### エラー: "permission denied for table xxx"
→ RLSが有効化されている可能性があります。一旦無効化してから再度実行:
```sql
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE stores DISABLE ROW LEVEL SECURITY;
```

その後、再度 `database/05_rls_policies.sql` を実行してください。

### ポリシーを削除したい場合
```sql
DROP POLICY IF EXISTS "Users can view own conversations" ON conversations;
-- 必要に応じて他のポリシーも削除
```
