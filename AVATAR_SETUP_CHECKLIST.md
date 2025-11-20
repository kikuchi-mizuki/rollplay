# アバター機能セットアップチェックリスト

## 🔍 エラー「File name is invalid」の解決手順

### 1. ブラウザのコンソールを確認

1. ブラウザで開発者ツールを開く
   - Chrome: `Cmd + Option + I` (Mac) / `F12` (Windows)
   - Firefox: `Cmd + Option + K` (Mac) / `F12` (Windows)
2. **Console** タブを開く
3. アバターをアップロードしてみる
4. 以下のログを確認:
   ```
   Uploading file: { originalName: "...", fileType: "...", ... }
   Supabase upload error: { ... }
   ```
5. エラーメッセージをコピーしてください

### 2. Supabaseストレージバケットの確認

#### 方法A: Supabase Dashboardで確認

1. [Supabase Dashboard](https://app.supabase.com/) を開く
2. プロジェクトを選択
3. 左メニューから **Storage** をクリック
4. **avatars** という名前のバケットがあるか確認

**avatarsバケットがない場合:**
→ **手順3** に進んでマイグレーションを実行

**avatarsバケットがある場合:**
→ **手順4** に進んでポリシーを確認

#### 方法B: コマンドで確認

```bash
# Supabaseクライアントでバケット一覧を取得
curl 'https://your-project.supabase.co/storage/v1/bucket' \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### 3. マイグレーションを実行

**このマイグレーションが実行されているか確認してください:**

1. Supabase Dashboard → **SQL Editor**
2. 以下のSQLを実行:

```sql
-- avatarsバケットの存在確認
SELECT * FROM storage.buckets WHERE id = 'avatars';
```

**結果が空の場合、マイグレーションを実行:**

```sql
-- supabase/migrations/003_create_avatars_table.sql の内容を貼り付けて実行
-- または以下を実行:

-- アバター画像用ストレージバケット作成
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- ストレージポリシー
CREATE POLICY IF NOT EXISTS "Avatar images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY IF NOT EXISTS "Authenticated users can upload avatar images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars' AND
    auth.role() = 'authenticated'
  );

CREATE POLICY IF NOT EXISTS "Users can delete their own avatar images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
```

### 4. ストレージポリシーの確認

1. Supabase Dashboard → **Storage** → **avatars** → **Policies**
2. 以下のポリシーが存在するか確認:
   - ✅ Avatar images are publicly accessible (SELECT)
   - ✅ Authenticated users can upload avatar images (INSERT)
   - ✅ Users can delete their own avatar images (DELETE)

### 5. ファイル名の制限を確認

Supabaseストレージのファイル名制限:
- ✅ 英数字: `a-z`, `A-Z`, `0-9`
- ✅ アンダースコア: `_`
- ✅ ハイフン: `-`
- ✅ ピリオド: `.` (拡張子用)
- ❌ スペース
- ❌ 特殊文字: `@`, `#`, `$`, `%`, etc.
- ❌ 日本語

**現在のファイル名生成:**
```typescript
avatar_1732114800000_abc123.png
```

これは有効なはずです。

### 6. 代替案: 手動でバケットを作成

もしマイグレーションがうまくいかない場合:

1. Supabase Dashboard → **Storage**
2. **New bucket** をクリック
3. 設定:
   - **Name**: `avatars`
   - **Public bucket**: ✅ ON
   - **File size limit**: 5MB
   - **Allowed MIME types**: `image/jpeg, image/png, image/webp`
4. **Save** をクリック

### 7. テストアップロード

コンソールで直接テスト:

```javascript
// ブラウザのコンソールで実行
import { supabase } from './lib/supabase';

// テストファイルを作成
const testBlob = new Blob(['test'], { type: 'image/png' });
const testFile = new File([testBlob], 'test.png', { type: 'image/png' });

// アップロードテスト
const { data, error } = await supabase.storage
  .from('avatars')
  .upload('test_' + Date.now() + '.png', testFile);

console.log('Result:', { data, error });
```

### 8. よくあるエラーと解決策

#### エラー: "Bucket not found"
→ avatarsバケットが作成されていない
→ **手順3** を実行

#### エラー: "File name is invalid"
→ ファイル名に使えない文字が含まれている
→ コンソールログで生成されたファイル名を確認

#### エラー: "New row violates row-level security policy"
→ ストレージポリシーの問題
→ **手順4** を実行

#### エラー: "The resource already exists"
→ 同じファイル名が既に存在
→ `upsert: true` に変更、または古いファイルを削除

## 🎯 次のアクション

1. **手順1** でコンソールログを確認
2. エラーメッセージを報告
3. **手順2-3** でバケットを確認・作成
4. 再度アップロードを試す

---

**問題が解決しない場合は、以下の情報を教えてください:**
- ブラウザのコンソールに表示されるエラーメッセージ
- Supabaseのavatarsバケットが存在するか
- 生成されたファイル名（コンソールログより）
