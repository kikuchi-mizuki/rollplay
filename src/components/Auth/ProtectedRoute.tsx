import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

interface ProtectedRouteProps {
  children: ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth()

  // ローディング中
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-full mb-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">読み込み中...</h2>
          <p className="text-gray-600">少々お待ちください</p>
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
