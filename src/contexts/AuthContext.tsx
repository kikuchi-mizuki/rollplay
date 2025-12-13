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

  // プロフィール取得（リトライ機能付き）
  const fetchProfile = async (userId: string, retryCount = 0) => {
    const maxRetries = 3 // 3回に短縮（高速化）
    const timeout = 15000 // 15秒に短縮（無限ループ防止）

    try {
      const startTime = Date.now()
      console.log(`👤 プロフィール取得開始 (試行 ${retryCount + 1}/${maxRetries}):`, userId)

      // タイムアウト付きでプロフィール取得
      const profileTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('プロフィール取得タイムアウト')), timeout)
      )

      const profilePromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
        .then(result => {
          const elapsed = Date.now() - startTime
          console.log('📦 プロフィールクエリ完了:', result)
          console.log(`⏱️  クエリ実行時間: ${elapsed}ms`)
          if (elapsed > 5000) {
            console.warn(`⚠️  クエリが遅い (${elapsed}ms) - Supabaseのコールドスタートの可能性`)
          }
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
        console.error(`⚠️  プロフィールデータの取得に${timeout/1000}秒以上かかっています`)
        console.error('⚠️  Supabaseのコールドスタート（スリープからの復帰）の可能性が高いです')

        // リトライ処理（間隔を短縮）
        if (retryCount < maxRetries - 1) {
          const waitTime = 2000 * (retryCount + 1) // 2秒、4秒、6秒と短縮
          console.warn(`🔄 ${waitTime/1000}秒後に再試行します... (残り${maxRetries - retryCount - 1}回)`)
          console.warn(`💡 Supabaseが起動中です。しばらくお待ちください...`)

          await new Promise(resolve => setTimeout(resolve, waitTime))
          return fetchProfile(userId, retryCount + 1)
        } else {
          console.error('❌ リトライ上限に達しました')
          console.warn('⚠️  既存のプロフィールを保持します（会話を継続できます）')
          // タイムアウトの場合は既存のプロフィールを保持（setProfile(null)を呼ばない）
          // これにより、会話中にリダイレクトされることを防ぐ
          return
        }
      }

      // タイムアウト以外のエラーの場合のみnullに設定
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

        // タイムアウト設定を30秒に短縮（無限ループ防止）
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('認証タイムアウト')), 30000)
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

        // トークン更新は無視（自動リロード防止）
        if (event === 'TOKEN_REFRESHED') {
          console.log('🔄 トークン更新を検知（再レンダリングをスキップ）')
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
