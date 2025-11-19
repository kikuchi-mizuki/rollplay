import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // URLのハッシュからセッション情報を取得
        const { data: { session }, error } = await supabase.auth.getSession()

        if (error) {
          console.error('Auth callback error:', error)
          navigate('/login')
          return
        }

        if (session?.user) {
          // ユーザーのプロフィールが存在するか確認
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()

          if (profileError || !profile) {
            // プロフィールが存在しない場合は登録ページへ
            navigate('/register')
          } else {
            // プロフィールが存在する場合はホームページへ
            navigate('/')
          }
        } else {
          navigate('/login')
        }
      } catch (err) {
        console.error('Callback handling error:', err)
        navigate('/login')
      }
    }

    handleCallback()
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D0E20] via-[#16172B] to-[#272A46]">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] animate-pulse">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">認証中...</h2>
        <p className="text-slate-400">少々お待ちください</p>
      </div>
    </div>
  )
}
