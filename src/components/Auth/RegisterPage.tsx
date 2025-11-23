import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export function RegisterPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [storeCode, setStoreCode] = useState('')
  const [storeCodeValid, setStoreCodeValid] = useState(false)
  const [storeName, setStoreName] = useState('')
  const [storeId, setStoreId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)
  const [verifying, setVerifying] = useState(false)
  const verifyTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 現在のユーザー情報を取得
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUser(user)
        // Googleアカウントから名前を取得
        setDisplayName(user.user_metadata?.full_name || '')

        // 既にプロフィールが存在するかチェック
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()

        if (existingProfile) {
          console.log('✅ プロフィール既存 - メイン画面へリダイレクト')
          navigate('/')
          return
        }
      } else {
        // ログインしていない場合はログインページへ
        navigate('/login')
      }
    }
    getUser()
  }, [navigate])

  // 店舗コード検証
  const verifyStoreCode = async (code: string) => {
    if (!code) {
      setStoreCodeValid(false)
      setStoreName('')
      setStoreId('')
      setVerifying(false)
      return
    }

    try {
      setVerifying(true)
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('store_code', code)
        .eq('status', 'active')
        .maybeSingle()

      if (data && !error) {
        setStoreCodeValid(true)
        setStoreName(data.store_name)
        setStoreId(data.id)
      } else {
        setStoreCodeValid(false)
        setStoreName('')
        setStoreId('')
      }
    } catch (err) {
      console.error('Store code verification error:', err)
      setStoreCodeValid(false)
      setStoreName('')
      setStoreId('')
    } finally {
      setVerifying(false)
    }
  }

  // 店舗コード入力時の処理（デバウンス付き）
  const handleStoreCodeChange = (value: string) => {
    const upperValue = value.toUpperCase()
    setStoreCode(upperValue)

    // 既存のタイマーをクリア
    if (verifyTimeoutRef.current) {
      clearTimeout(verifyTimeoutRef.current)
    }

    // 入力が空の場合は即座にリセット
    if (!upperValue) {
      setStoreCodeValid(false)
      setStoreName('')
      setStoreId('')
      setVerifying(false)
      return
    }

    // 500ms後に検証を実行（デバウンス）
    setVerifying(true)
    verifyTimeoutRef.current = setTimeout(() => {
      verifyStoreCode(upperValue)
    }, 500)
  }

  // コンポーネントアンマウント時にタイマーをクリア
  useEffect(() => {
    return () => {
      if (verifyTimeoutRef.current) {
        clearTimeout(verifyTimeoutRef.current)
      }
    }
  }, [])

  // 登録処理
  const handleRegister = async () => {
    if (!user || !storeCodeValid || !displayName) return

    try {
      setLoading(true)
      setError(null)

      // profilesテーブルに登録
      const { error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          store_id: storeId,
          store_code: storeCode,
          display_name: displayName,
          email: user.email,
          avatar_url: user.user_metadata?.avatar_url || null,
          role: 'user'
        })

      if (insertError) {
        throw insertError
      }

      // 登録成功 - ホーム画面へリダイレクト
      navigate('/')
    } catch (err: any) {
      console.error('Registration error:', err)
      setError(err.message || '登録に失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D0E20] via-[#16172B] to-[#272A46]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#6C5CE7]"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D0E20] via-[#16172B] to-[#272A46] py-12 px-4">
      <div className="max-w-md w-full">
        <div className="glass-card p-8">
          {/* ヘッダー */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">アカウント登録</h2>
            <p className="text-slate-400">あと少しで完了です</p>
          </div>

          {/* エラーメッセージ */}
          {error && (
            <div className="mb-6 p-3 glass-card border-red-500/30 bg-red-500/10">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Googleから取得した情報 */}
          <div className="bg-white/5 border border-white/10 p-4 rounded-2xl mb-6 backdrop-blur-sm">
            <p className="text-xs text-slate-400 mb-2">Googleアカウント</p>
            <div className="flex items-center gap-3">
              {user.user_metadata?.avatar_url && (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Avatar"
                  className="w-12 h-12 rounded-full"
                />
              )}
              <div>
                <p className="font-semibold text-white">
                  {user.user_metadata?.full_name || 'ユーザー'}
                </p>
                <p className="text-sm text-slate-400">{user.email}</p>
              </div>
            </div>
          </div>

          {/* 店舗コード入力 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              店舗コード <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              placeholder="例: STORE_001"
              value={storeCode}
              onChange={(e) => handleStoreCodeChange(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#6C5CE7]/60 focus:border-transparent transition-all backdrop-blur-sm"
            />
            {storeCode && verifying && (
              <div className="mt-2 flex items-center gap-2 text-slate-400">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-400"></div>
                <span className="text-sm">確認中...</span>
              </div>
            )}
            {storeCode && !verifying && storeCodeValid && (
              <div className="mt-2 flex items-center gap-2 text-green-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium">{storeName} として登録されます</span>
              </div>
            )}
            {storeCode && !verifying && !storeCodeValid && (
              <div className="mt-2 flex items-center gap-2 text-red-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm">店舗コードが見つかりません</span>
              </div>
            )}
          </div>

          {/* 表示名 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              表示名 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              placeholder="山田 太郎"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#6C5CE7]/60 focus:border-transparent transition-all backdrop-blur-sm"
            />
          </div>

          {/* 登録ボタン */}
          <button
            onClick={handleRegister}
            disabled={!storeCodeValid || !displayName || loading}
            className="w-full px-6 py-3 bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] text-white rounded-2xl font-semibold hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all shadow-lg"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>登録中...</span>
              </div>
            ) : (
              '登録完了'
            )}
          </button>

          {/* ヘルプ */}
          <div className="mt-6 text-center">
            <p className="text-sm text-slate-400">
              店舗コードがわからない場合は、管理者にお問い合わせください。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
