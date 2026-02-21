import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// デバッグ用：環境変数の確認（開発環境のみ）
if (import.meta.env.DEV) {
  console.log('🔍 環境変数チェック:')
  console.log('  VITE_SUPABASE_URL:', supabaseUrl)
  console.log('  VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? '設定済み (長さ: ' + supabaseAnonKey.length + ')' : '❌ 未設定')
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase環境変数が設定されていません')
  if (import.meta.env.DEV) {
    console.error('VITE_SUPABASE_URL:', supabaseUrl)
    console.error('VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? '設定済み' : '未設定')
  }
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  }
)
