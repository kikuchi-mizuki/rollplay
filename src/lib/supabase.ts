import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 環境変数の検証
if (!supabaseUrl || !supabaseAnonKey) {
  const errorMessage = '❌ Supabase環境変数が設定されていません。.envファイルを確認してください。'
  console.error(errorMessage)
  console.error('必要な環境変数: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY')
  throw new Error(errorMessage)
}

// URLの形式検証
try {
  new URL(supabaseUrl)
} catch {
  const errorMessage = '❌ VITE_SUPABASE_URLの形式が正しくありません'
  console.error(errorMessage, supabaseUrl)
  throw new Error(errorMessage)
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  }
)
