import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { LoginPage } from './components/Auth/LoginPage'
import { RegisterPage } from './components/Auth/RegisterPage'
import { AuthCallback } from './components/Auth/AuthCallback'
import { ProtectedRoute } from './components/Auth/ProtectedRoute'
import { StoreManagementPage } from './components/Admin/StoreManagementPage'
import { AdminDashboardPage } from './components/Admin/AdminDashboardPage'
import { StoreDashboardPage } from './components/Store/StoreDashboardPage'
import { HistoryPage } from './components/History/HistoryPage'
import RoleplayApp from './RoleplayApp'

/**
 * メインアプリケーションコンポーネント
 * 認証とルーティングを管理
 */
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* 公開ルート */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* 保護されたルート */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <RoleplayApp />
              </ProtectedRoute>
            }
          />

          {/* 本部管理者専用ルート */}
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/stores"
            element={
              <ProtectedRoute>
                <StoreManagementPage />
              </ProtectedRoute>
            }
          />

          {/* 店舗ダッシュボードルート */}
          <Route
            path="/store/dashboard"
            element={
              <ProtectedRoute>
                <StoreDashboardPage />
              </ProtectedRoute>
            }
          />

          {/* 練習履歴ルート */}
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <HistoryPage />
              </ProtectedRoute>
            }
          />

          {/* その他のパスは / にリダイレクト */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
