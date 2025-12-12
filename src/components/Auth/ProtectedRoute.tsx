import { ReactNode, useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

interface ProtectedRouteProps {
  children: ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth()
  const [showTimeout, setShowTimeout] = useState(false)

  // 30秒後にタイムアウト警告を表示
  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => {
        setShowTimeout(true)
      }, 30000) // 30秒

      return () => clearTimeout(timer)
    } else {
      setShowTimeout(false)
    }
  }, [loading])

  // ローディング中
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D0E20] via-[#16172B] to-[#272A46]">
        <div className="text-center max-w-md px-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] rounded-full mb-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">読み込み中...</h2>
          <p className="text-gray-400 mb-4">少々お待ちください</p>

          {showTimeout && (
            <div className="mt-6 p-4 bg-white/10 backdrop-blur-xl border border-white/20 rounded-lg">
              <p className="text-yellow-400 font-semibold mb-2">⚠️ 読み込みに時間がかかっています</p>
              <p className="text-gray-300 text-sm mb-4">
                Supabaseのスリープから復帰中の可能性があります。<br/>
                もう少しお待ちいただくか、ページをリロードしてください。
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                ページをリロード
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 未ログイン
  if (!user) {
    return <Navigate to="/login" replace />
  }

  // プロフィール未登録
  if (!profile) {
    return <Navigate to="/register" replace />
  }

  // 認証済み & プロフィール登録済み
  return <>{children}</>
}
