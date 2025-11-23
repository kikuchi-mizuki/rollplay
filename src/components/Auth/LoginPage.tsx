import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export function LoginPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGoogleLogin = async () => {
    try {
      setLoading(true)
      setError(null)

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) {
        setError(error.message)
      }
    } catch (err) {
      setError('ログインに失敗しました。もう一度お試しください。')
      console.error('Login error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D0E20] via-[#16172B] to-[#272A46]">
      <div className="max-w-md w-full mx-4">
        <div className="glass-card p-8">
          {/* ヘッダー */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE]">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              SNS動画営業ロープレ
            </h1>
            <p className="text-slate-400">
              AIと一緒に営業スキルを磨こう
            </p>
          </div>

          {/* エラーメッセージ */}
          {error && (
            <div className="mb-4 p-3 glass-card border-red-500/30 bg-red-500/10">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Googleログインボタン */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full bg-white/10 border-2 border-white/20 rounded-2xl p-4 flex items-center justify-center gap-3 hover:bg-white/20 hover:border-white/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span className="font-medium text-white">ログイン中...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span className="font-medium text-white">Googleでログイン</span>
              </>
            )}
          </button>

          {/* フッター */}
          <div className="mt-6 text-center">
            <p className="text-xs text-slate-400">
              ログインすることで、
              <a href="#" className="text-[#A29BFE] hover:text-[#B9B0FF] hover:underline">利用規約</a>
              および
              <a href="#" className="text-[#A29BFE] hover:text-[#B9B0FF] hover:underline">プライバシーポリシー</a>
              に同意したものとみなされます。
            </p>
          </div>

          {/* 登録ページへのリンク */}
          <div className="mt-4 text-center">
            <button
              onClick={() => navigate('/register')}
              className="text-sm text-[#6C5CE7] hover:text-[#A29BFE] transition-colors"
            >
              初めての方はこちら
            </button>
          </div>
        </div>

        {/* システム説明 */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-6 text-sm text-slate-300">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-[#A29BFE]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>6シナリオ対応</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-[#A29BFE]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>AI評価</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-[#A29BFE]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span>成長記録</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
