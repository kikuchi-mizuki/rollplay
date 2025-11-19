import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface Profile {
  id: string
  store_id: string | null
  store_code: string | null
  display_name: string
  email: string
  avatar_url: string | null
  role: 'admin' | 'manager' | 'user'
  created_at: string
  last_active_at: string | null
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {}
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isInitialized, setIsInitialized] = useState(false)

  // プロフィール取得
  const fetchProfile = async (userId: string) => {
    try {
      console.log('👤 プロフィール取得開始:', userId)

      // タイムアウト付きでプロフィール取得
      const profileTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('プロフィール取得タイムアウト')), 5000)
      )

      const profilePromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
        .then(result => {
          console.log('📦 プロフィールクエリ完了:', result)
          return result
        })

      const { data, error } = await Promise.race([
        profilePromise,
        profileTimeout
      ]) as any

      if (error) {
        console.error('❌ プロフィール取得エラー:', error)
        console.error('   エラーコード:', error.code)
        console.error('   エラー詳細:', error.details)
        console.log('ℹ️  プロフィールが未登録の可能性があります')
        setProfile(null)
        return
      }

      console.log('✅ プロフィール取得成功:', data?.display_name)
      setProfile(data)

      // 最終ログイン時刻を更新（非同期、エラーは無視）
      supabase
        .from('profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', userId)
        .then(({ error }) => {
          if (error) {
            console.warn('⚠️  最終ログイン時刻更新失敗:', error)
          }
        })
    } catch (err: any) {
      console.error('❌ Profile fetch error:', err.message || err)
      if (err.message === 'プロフィール取得タイムアウト') {
        console.error('⚠️  プロフィールデータの取得に5秒以上かかっています')
        console.error('⚠️  データベース接続またはRLSポリシーを確認してください')
      }
      setProfile(null)
    }
  }

  // プロフィール再取得
  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id)
    }
  }

  // 初回セッション取得
  useEffect(() => {
    const initAuth = async () => {
      try {
        console.log('🔐 認証初期化開始...')
        console.log('📡 supabase.auth.getSession() を呼び出します...')

        // タイムアウト設定を10秒に延長
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('認証タイムアウト')), 10000)
        )

        const sessionPromise = supabase.auth.getSession()
          .then(result => {
            console.log('📦 getSession() レスポンス受信:', result)
            return result
          })
          .catch(err => {
            console.error('📦 getSession() エラー:', err)
            throw err
          })

        const { data: { session }, error } = await Promise.race([
          sessionPromise,
          timeoutPromise
        ]) as any

        if (error) {
          console.error('❌ セッション取得エラー:', error)
          setLoading(false)
          return
        }

        console.log('✅ セッション取得完了:', session ? 'ログイン済み' : '未ログイン')

        if (session?.user) {
          setUser(session.user)
          await fetchProfile(session.user.id)
        }
      } catch (err: any) {
        console.error('❌ Session initialization error:', err.message || err)
        console.error('❌ Error stack:', err.stack)
        if (err.message === '認証タイムアウト') {
          console.error('⚠️  Supabase接続がタイムアウトしました。')
          console.error('⚠️  考えられる原因:')
          console.error('   1. 環境変数が正しく読み込まれていない')
          console.error('   2. Supabaseプロジェクトの設定に問題がある')
          console.error('   3. ネットワーク接続の問題')
        }
      } finally {
        console.log('🏁 認証初期化完了 - loading: false')
        setLoading(false)
        setIsInitialized(true)
      }
    }

    initAuth()
  }, [])

  // 認証状態の変更を監視
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('🔄 認証状態変更:', event, '初期化済み:', isInitialized)

        // 初回読み込み完了前のイベントは無視（initAuthで処理する）
        if (!isInitialized) {
          console.log('⏭️  初期化中のため無視')
          return
        }

        setUser(session?.user ?? null)

        if (session?.user) {
          await fetchProfile(session.user.id)
        } else {
          setProfile(null)
        }

        setLoading(false)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [isInitialized])

  // ログアウト
  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
