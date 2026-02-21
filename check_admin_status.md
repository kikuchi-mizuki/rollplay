# 管理者権限のデバッグ手順

## 1. ブラウザのコンソールを開く

1. ブラウザでF12キーを押す
2. 「Console」タブを開く
3. 以下のコマンドを実行：

```javascript
// 現在のユーザー情報を確認
const { data: { session } } = await window.supabase.auth.getSession()
console.log('User ID:', session?.user?.id)

// プロフィール情報を確認
const { data: profile } = await window.supabase.from('profiles').select('*').eq('id', session?.user?.id).single()
console.log('Profile:', profile)
console.log('Role:', profile?.role)
```

## 2. 確認すべきポイント

- `profile.role` の値が `"admin"` になっているか？
- `profile` が null ではないか？

## 3. もし role が "admin" でない場合

Supabase Dashboardで直接データベースを修正：

1. Supabase Dashboard → Table Editor → profiles
2. 該当ユーザーの行を探す
3. `role` カラムを `admin` に変更
4. 保存

## 4. もし profile が null の場合

プロフィールが作成されていません：

1. Supabase Dashboard → Table Editor → profiles
2. 新しい行を追加
3. 以下を入力：
   - id: (ユーザーID)
   - display_name: (名前)
   - email: (メールアドレス)
   - role: admin
   - store_id: (店舗ID or NULL)
   - store_code: (店舗コード or NULL)
