import { useAuth } from '../contexts/AuthContext'

/**
 * デバッグ用コンポーネント
 * 現在のユーザー情報とプロフィール情報を表示
 */
export function DebugInfo() {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="fixed bottom-4 right-4 bg-gray-900 text-white p-4 rounded-lg shadow-lg max-w-md z-[9999]">
        <h3 className="font-bold text-yellow-400 mb-2">🔍 デバッグ情報（読み込み中...）</h3>
      </div>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 text-white p-4 rounded-lg shadow-lg max-w-md z-[9999] text-xs">
      <h3 className="font-bold text-yellow-400 mb-2">🔍 デバッグ情報</h3>

      <div className="space-y-2">
        <div>
          <span className="text-gray-400">User ID:</span>{' '}
          <span className="text-green-400 font-mono">{user?.id || 'null'}</span>
        </div>

        <div>
          <span className="text-gray-400">Email:</span>{' '}
          <span className="text-blue-400">{user?.email || 'null'}</span>
        </div>

        <div>
          <span className="text-gray-400">Profile:</span>{' '}
          <span className={profile ? 'text-green-400' : 'text-red-400'}>
            {profile ? '✅ 取得成功' : '❌ null'}
          </span>
        </div>

        {profile && (
          <>
            <div>
              <span className="text-gray-400">Display Name:</span>{' '}
              <span className="text-white">{profile.display_name}</span>
            </div>

            <div>
              <span className="text-gray-400">Role:</span>{' '}
              <span className={`font-bold ${
                profile.role === 'admin' ? 'text-purple-400' :
                profile.role === 'manager' ? 'text-blue-400' :
                'text-gray-400'
              }`}>
                {profile.role}
              </span>
            </div>

            <div>
              <span className="text-gray-400">Store ID:</span>{' '}
              <span className="text-gray-300 font-mono text-xs">
                {profile.store_id || 'null'}
              </span>
            </div>

            <div>
              <span className="text-gray-400">Store Code:</span>{' '}
              <span className="text-gray-300">{profile.store_code || 'null'}</span>
            </div>
          </>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-700">
        <div className="text-xs text-gray-500">
          このパネルは開発用です。本番環境では非表示にしてください。
        </div>
      </div>
    </div>
  )
}
