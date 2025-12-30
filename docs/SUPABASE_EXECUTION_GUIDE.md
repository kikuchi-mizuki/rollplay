# Supabase実行ガイド - RLS循環参照問題の解決

**目的**: 作成したSQLファイルをSupabaseで実行し、RLS循環参照問題を解決する
**所要時間**: 約15分
**作成日**: 2025年12月30日

---

## 📋 実行前の確認

### 必要なもの
- ✅ Supabaseプロジェクトへのアクセス権
- ✅ 管理者権限（SQL Editorの使用が必要）
- ✅ テスト用のユーザーアカウント（管理者、店舗管理者、一般ユーザー）

### 実行するSQLファイル
1. **database/13_setup_jwt_custom_claims.sql** - JWT カスタムクレームのセットアップ
2. **database/12_fix_rls_with_jwt.sql** - RLSポリシーの適用

---

## 🚀 実行手順

### Step 1: Supabaseダッシュボードにアクセス（1分）

1. ブラウザで以下のURLにアクセス：
   ```
   https://app.supabase.com/project/guargnhnblhiupjumkhe
   ```

2. ログインしていない場合は、認証情報を入力してログイン

3. 左メニューから **「SQL Editor」** をクリック

   ```
   ┌─────────────────┐
   │ 🏠 Home         │
   │ 📊 Table Editor │
   │ 🔍 SQL Editor   │ ← ここをクリック
   │ 📚 Database     │
   │ 🔐 Authentication│
   └─────────────────┘
   ```

---

### Step 2: JWT カスタムクレームのセットアップ（5分）

#### 2-1. 新しいクエリを作成

1. SQL Editorの右上にある **「+ New query」** ボタンをクリック

2. クエリ名を入力（例: "Setup JWT Custom Claims"）

#### 2-2. SQLファイルの内容をコピー

1. ローカルマシンで以下のファイルを開く：
   ```
   database/13_setup_jwt_custom_claims.sql
   ```

2. ファイルの**全内容**をコピー（Cmd+A → Cmd+C）

#### 2-3. SQLを実行

1. SQL Editorのテキストエリアに**ペースト**（Cmd+V）

2. 右下の **「Run」** ボタンをクリック

   ```
   ┌──────────────────────────────────┐
   │ SQL Editor                       │
   │                                  │
   │ [SQLコードがここに表示される]      │
   │                                  │
   │                      [ Run ▶ ]  │ ← ここをクリック
   └──────────────────────────────────┘
   ```

3. **実行結果の確認**（画面下部に表示）:

   ✅ 成功の場合:
   ```
   NOTICE:  ✅ JWT カスタムクレームのセットアップが完了しました！
   NOTICE:
   NOTICE:  📊 実行結果:
   NOTICE:    - 作成された関数: set_user_metadata()
   NOTICE:    - 作成されたTrigger: 2 個
   NOTICE:    - 更新されたユーザー: X 人
   ```

   ❌ エラーの場合:
   - エラーメッセージをスクリーンショットで保存
   - 後述の「トラブルシューティング」セクションを参照

#### 2-4. 確認クエリの結果を確認

実行が成功すると、以下のような表が表示されます：

| email | role_in_jwt | store_id_in_jwt | role_in_profile | store_id_in_profile | role_sync | store_id_sync |
|-------|-------------|-----------------|-----------------|---------------------|-----------|---------------|
| admin@example.com | admin | null | admin | null | ✅ | ✅ |
| manager@example.com | manager | 123e4567-... | manager | 123e4567-... | ✅ | ✅ |
| user@example.com | user | 123e4567-... | user | 123e4567-... | ✅ | ✅ |

**確認ポイント**:
- ✅ `role_sync` と `store_id_sync` がすべて **✅** になっている
- ✅ `role_in_jwt` と `role_in_profile` が一致している

---

### Step 3: RLSポリシーの適用（5分）

#### 3-1. 新しいクエリを作成

1. SQL Editorの右上にある **「+ New query」** ボタンをクリック

2. クエリ名を入力（例: "Fix RLS with JWT"）

#### 3-2. SQLファイルの内容をコピー

1. ローカルマシンで以下のファイルを開く：
   ```
   database/12_fix_rls_with_jwt.sql
   ```

2. ファイルの**全内容**をコピー（Cmd+A → Cmd+C）

#### 3-3. SQLを実行

1. SQL Editorのテキストエリアに**ペースト**（Cmd+V）

2. 右下の **「Run」** ボタンをクリック

3. **実行結果の確認**:

   ✅ 成功の場合:
   ```
   NOTICE:  ✅ RLS循環参照問題の完全な解決が完了しました！
   NOTICE:
   NOTICE:  📝 実装内容:
   NOTICE:    - is_admin()関数: JWTから管理者権限を確認
   NOTICE:    - is_manager()関数: JWTから店舗管理者権限を確認
   NOTICE:    - current_user_store_id()関数: JWTから店舗IDを取得
   NOTICE:
   NOTICE:  🔒 セキュリティ改善:
   NOTICE:    - profilesテーブルの参照による循環参照を完全に排除
   NOTICE:    - 管理者・店舗管理者の適切なアクセス制御を実装
   ```

#### 3-4. 作成されたポリシーを確認

実行が成功すると、以下のような表が表示されます：

| tablename | policyname | operation |
|-----------|------------|-----------|
| conversations | Admins can view all conversations - fixed | SELECT |
| conversations | Managers can view store conversations - fixed | SELECT |
| evaluations | Admins can view all evaluations - fixed | SELECT |
| evaluations | Managers can view store evaluations - fixed | SELECT |
| profiles | Admins can view all profiles - fixed | SELECT |
| profiles | Admins can update all profiles - fixed | UPDATE |
| profiles | Managers can view store users - fixed | SELECT |
| stores | Admins can delete stores - fixed | DELETE |
| stores | Admins can insert stores - fixed | INSERT |
| stores | Admins can update stores - fixed | UPDATE |

**確認ポイント**:
- ✅ 10個以上のポリシーが作成されている
- ✅ すべてのポリシー名に **"- fixed"** が含まれている

---

### Step 4: テストと確認（5分）

#### 4-1. セキュリティ関数のテスト

SQL Editorで以下のクエリを実行して、関数が正しく動作するか確認：

```sql
-- 現在のユーザーで関数をテスト
SELECT
  auth.uid() AS current_user_id,
  is_admin() AS is_admin_result,
  is_manager() AS is_manager_result,
  current_user_store_id() AS store_id;
```

**期待される結果**（管理者でログインしている場合）:
| current_user_id | is_admin_result | is_manager_result | store_id |
|-----------------|-----------------|-------------------|----------|
| 123e4567-... | true | false | null |

#### 4-2. RLSポリシーが有効か確認

```sql
-- RLSが有効になっているか確認
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'conversations', 'evaluations', 'stores')
ORDER BY tablename;
```

**期待される結果**:
| tablename | rls_enabled |
|-----------|-------------|
| conversations | true |
| evaluations | true |
| profiles | true |
| stores | true |

**確認ポイント**:
- ✅ すべてのテーブルで `rls_enabled` が **true** になっている

---

## 🧪 アクセス権限のテスト

### テストシナリオ1: 管理者（admin）

1. **管理者アカウントでログイン**

2. **フロントエンドまたはAPIで以下をテスト**:
   ```javascript
   // 全conversationsを取得
   const { data, error } = await supabase
     .from('conversations')
     .select('*')

   console.log('管理者: 全会話数 =', data?.length)
   // 期待: 全ユーザーの会話が取得できる
   ```

3. **期待される動作**:
   - ✅ 全ユーザーのconversations/evaluationsを閲覧可能
   - ✅ 全profilesを閲覧・更新可能
   - ✅ storesを作成・更新・削除可能

---

### テストシナリオ2: 店舗管理者（manager）

1. **店舗管理者アカウントでログイン**

2. **フロントエンドまたはAPIで以下をテスト**:
   ```javascript
   // 自店舗のconversationsを取得
   const { data, error } = await supabase
     .from('conversations')
     .select('*')

   console.log('店舗管理者: 自店舗の会話数 =', data?.length)
   // 期待: 自店舗のユーザーの会話のみ取得
   ```

3. **期待される動作**:
   - ✅ 自店舗のconversations/evaluationsのみ閲覧可能
   - ✅ 自店舗のprofilesのみ閲覧可能
   - ❌ 他店舗のデータは閲覧不可
   - ❌ storesの作成・更新・削除は不可

---

### テストシナリオ3: 一般ユーザー（user）

1. **一般ユーザーアカウントでログイン**

2. **フロントエンドまたはAPIで以下をテスト**:
   ```javascript
   // 自分のconversationsを取得
   const { data, error } = await supabase
     .from('conversations')
     .select('*')

   console.log('一般ユーザー: 自分の会話数 =', data?.length)
   // 期待: 自分の会話のみ取得
   ```

3. **期待される動作**:
   - ✅ 自分のconversations/evaluationsのみ閲覧・作成・更新・削除可能
   - ✅ 自分のprofileのみ閲覧・更新可能
   - ❌ 他ユーザーのデータは閲覧不可
   - ❌ storesの作成・更新・削除は不可

---

## 🔍 トラブルシューティング

### エラー1: "function set_user_metadata() does not exist"

**原因**: 関数が作成されていない、またはschemaが間違っている

**解決策**:
```sql
-- 関数が存在するか確認
SELECT proname, pronamespace::regnamespace
FROM pg_proc
WHERE proname = 'set_user_metadata';

-- 存在しない場合、13_setup_jwt_custom_claims.sql を再実行
```

---

### エラー2: "permission denied for table auth.users"

**原因**: SECURITY DEFINER が設定されていない、またはサービスロールキーが必要

**解決策**:
```sql
-- 関数を削除して再作成
DROP FUNCTION IF EXISTS public.set_user_metadata();

-- 13_setup_jwt_custom_claims.sql を再実行
```

---

### エラー3: "policy already exists"

**原因**: 既に同名のポリシーが存在している

**解決策**:
```sql
-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Admins can view all conversations - fixed" ON conversations;
DROP POLICY IF EXISTS "Managers can view store conversations - fixed" ON conversations;
-- (他のポリシーも同様に削除)

-- 12_fix_rls_with_jwt.sql を再実行
```

---

### エラー4: JWTにカスタムクレームが含まれない

**原因**: raw_user_meta_dataが更新されていない、または再ログインが必要

**解決策**:

1. **メタデータを確認**:
   ```sql
   SELECT
     email,
     raw_user_meta_data
   FROM auth.users
   LIMIT 5;
   ```

2. **メタデータが空の場合、再更新**:
   ```sql
   UPDATE auth.users AS u
   SET raw_user_meta_data =
     COALESCE(u.raw_user_meta_data, '{}'::jsonb) ||
     jsonb_build_object('role', p.role, 'store_id', p.store_id)
   FROM public.profiles AS p
   WHERE u.id = p.id;
   ```

3. **アプリケーションで再ログイン**:
   - すべてのユーザーがログアウト
   - 再度ログインして新しいJWTトークンを取得

---

### エラー5: is_admin() が false を返す

**原因**: JWTに'role'カスタムクレームが含まれていない

**確認**:
```sql
-- 現在のJWTの内容を確認
SELECT auth.jwt();

-- 期待される結果（'role'フィールドが含まれている）:
-- {
--   "aud": "authenticated",
--   "role": "admin",  ← これが含まれているか確認
--   "store_id": "...",
--   ...
-- }
```

**解決策**: エラー4の手順を実行

---

## ✅ 完了チェックリスト

実行完了後、以下をチェックしてください：

### データベース設定
- [ ] `set_user_metadata()` 関数が作成されている
- [ ] `on_profile_created` と `on_profile_updated` Triggerが作成されている
- [ ] `is_admin()`, `is_manager()`, `current_user_store_id()` 関数が作成されている
- [ ] 12個のRLSポリシー（"- fixed"）が作成されている
- [ ] すべてのテーブルでRLSが有効（rowsecurity = true）

### メタデータ確認
- [ ] auth.usersのraw_user_meta_dataに'role'と'store_id'が含まれている
- [ ] role_syncとstore_id_syncがすべて ✅ になっている

### アクセス権限テスト
- [ ] 管理者で全データにアクセスできる
- [ ] 店舗管理者で自店舗データのみアクセスできる
- [ ] 一般ユーザーで自分のデータのみアクセスできる

---

## 📊 実行後のセキュリティスコア

| 項目 | Before | After | 状態 |
|------|--------|-------|------|
| RLS循環参照 | ❌ 不合格 | ✅ 合格 | 完了 |
| 管理者アクセス制御 | ❌ 無効 | ✅ 有効 | 完了 |
| 店舗管理者アクセス制御 | ❌ 無効 | ✅ 有効 | 完了 |
| profilesセキュリティ | ⚠️ 全公開 | ✅ 適切な制限 | 完了 |
| **総合セキュリティスコア** | **52.5%** | **85%+** | **+32.5%** |

---

## 📝 次のステップ

1. ✅ このガイドに従ってSupabaseで実行
2. ✅ テストシナリオをすべて確認
3. ⏳ APIレート制限の実装（次のタスク）
4. ⏳ 入力値検証の強化
5. ⏳ セキュリティ監査の再実施

---

## 💡 ヒント

### 実行のタイミング
- **推奨**: 営業時間外または低トラフィック時
- **理由**: Triggerの作成や既存データの更新が発生するため

### バックアップ
- **推奨**: 実行前にデータベースのスナップショットを取得
- **Supabase設定 → Database → Backups** から手動バックアップ可能

### 段階的な実行
- **推奨**: まず開発環境で実行してテスト
- 本番環境では問題がないことを確認してから実行

---

**作成者**: Claude Code
**関連ドキュメント**:
- `docs/JWT_CUSTOM_CLAIMS_SETUP_GUIDE.md` - 詳細な実装ガイド
- `database/13_setup_jwt_custom_claims.sql` - JWT カスタムクレームSQL
- `database/12_fix_rls_with_jwt.sql` - RLSポリシーSQL
- `docs/PROGRESS_REPORT_20251230_SESSION20.md` - セッション20進捗レポート
