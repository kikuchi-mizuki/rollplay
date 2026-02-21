import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { getAllUsers, deleteUser, updateUserRole, updateUserStore } from '../../lib/api'
import { Users, Trash2, RefreshCw, Search, Shield, Building2, Edit2, X, Check } from 'lucide-react'

interface User {
  id: string
  display_name: string
  email: string
  store_id: string
  store_name: string
  store_code: string
  region: string
  role: 'admin' | 'manager' | 'user'
  created_at: string
  last_active_at: string | null
}

interface Store {
  id: string
  store_code: string
  store_name: string
}

/**
 * ユーザー管理ページ（本部管理者専用）
 * ユーザーの一覧表示・削除・権限変更・店舗変更
 */
export function UserManagementPage() {
  const navigate = useNavigate()
  const { profile, loading } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [storeFilter, setStoreFilter] = useState<string>('')
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<'role' | 'store' | null>(null)

  // 権限チェック
  useEffect(() => {
    if (!loading && profile?.role !== 'admin') {
      navigate('/')
    }
  }, [loading, profile, navigate])

  // データ取得
  const fetchData = async () => {
    try {
      setLoadingData(true)
      setError(null)

      // ユーザー一覧取得
      const usersData = await getAllUsers({
        role: roleFilter || undefined,
        store_id: storeFilter || undefined,
        search: searchTerm || undefined
      })

      // 店舗一覧取得
      const { data: storesData, error: storesError } = await supabase
        .from('stores')
        .select('*')
        .order('store_name')

      if (storesError) throw storesError

      setUsers(usersData.users)
      setStores(storesData || [])
    } catch (err: any) {
      console.error('データ取得エラー:', err)
      setError(err.message)
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchData()
    }
  }, [profile, roleFilter, storeFilter])

  // ユーザー削除
  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!confirm(`「${userName}」を削除してもよろしいですか？\n※このユーザーの会話履歴・評価データもすべて削除されます。`)) {
      return
    }

    try {
      await deleteUser(userId)
      await fetchData()
    } catch (err: any) {
      console.error('ユーザー削除エラー:', err)
      setError(err.message)
    }
  }

  // 権限変更
  const handleRoleChange = async (userId: string, newRole: 'admin' | 'manager' | 'user') => {
    try {
      await updateUserRole(userId, newRole)
      setEditingUserId(null)
      setEditingField(null)
      await fetchData()
    } catch (err: any) {
      console.error('権限変更エラー:', err)
      setError(err.message)
    }
  }

  // 店舗変更
  const handleStoreChange = async (userId: string, newStoreId: string) => {
    try {
      await updateUserStore(userId, newStoreId)
      setEditingUserId(null)
      setEditingField(null)
      await fetchData()
    } catch (err: any) {
      console.error('店舗変更エラー:', err)
      setError(err.message)
    }
  }

  // 検索フィルター
  const handleSearch = () => {
    fetchData()
  }

  const getRoleBadge = (role: string) => {
    const styles = {
      admin: 'bg-purple-500/20 text-purple-300',
      manager: 'bg-blue-500/20 text-blue-300',
      user: 'bg-gray-500/20 text-gray-300'
    }
    const labels = {
      admin: '管理者',
      manager: 'マネージャー',
      user: 'ユーザー'
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${styles[role as keyof typeof styles]}`}>
        {labels[role as keyof typeof labels]}
      </span>
    )
  }

  if (loading || (profile?.role === 'admin' && loadingData && users.length === 0)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D0E20] via-[#16172B] to-[#272A46]">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">読み込み中...</h2>
        </div>
      </div>
    )
  }

  if (profile?.role !== 'admin') {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0D0E20] via-[#16172B] to-[#272A46] py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/')}
            className="text-[#A29BFE] hover:text-[#B9B0FF] mb-4 flex items-center gap-2 transition-colors"
          >
            ← メイン画面に戻る
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Users className="text-[#A29BFE]" size={36} />
                ユーザー管理
              </h1>
              <p className="text-slate-400 mt-2">全ユーザーの管理・権限変更</p>
            </div>
            <button
              onClick={fetchData}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white transition-all flex items-center gap-2"
            >
              <RefreshCw size={18} />
              更新
            </button>
          </div>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 glass-card border-red-500/30 bg-red-500/10">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* フィルター・検索 */}
        <div className="glass-card p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* 検索 */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                検索（名前・メール）
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="ユーザー名またはメールで検索"
                  className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#6C5CE7]/60"
                />
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] text-white rounded-lg hover:scale-[1.02] transition-all"
                >
                  <Search size={18} />
                </button>
              </div>
            </div>

            {/* 権限フィルター */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                権限
              </label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#6C5CE7]/60"
              >
                <option value="">すべて</option>
                <option value="admin">管理者</option>
                <option value="manager">マネージャー</option>
                <option value="user">ユーザー</option>
              </select>
            </div>

            {/* 店舗フィルター */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                店舗
              </label>
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#6C5CE7]/60"
              >
                <option value="">すべて</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.store_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ユーザー一覧 */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-white">
              ユーザー一覧（{users.length}件）
            </h2>
          </div>

          {loadingData ? (
            <div className="text-center py-12 text-slate-400">
              読み込み中...
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>ユーザーが見つかりません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 font-semibold text-slate-300">ユーザー名</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-300">メール</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-300">店舗</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-300">権限</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-300">登録日</th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-300">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="py-4 px-4 font-medium text-white">
                        {user.display_name}
                      </td>
                      <td className="py-4 px-4 text-slate-300 text-sm">
                        {user.email}
                      </td>
                      <td className="py-4 px-4">
                        {editingUserId === user.id && editingField === 'store' ? (
                          <div className="flex items-center gap-2">
                            <select
                              onChange={(e) => handleStoreChange(user.id, e.target.value)}
                              className="px-2 py-1 bg-white/10 border border-white/20 rounded text-sm text-white"
                              defaultValue={user.store_id}
                            >
                              {stores.map((store) => (
                                <option key={store.id} value={store.id}>
                                  {store.store_name}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                setEditingUserId(null)
                                setEditingField(null)
                              }}
                              className="text-slate-400 hover:text-white"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="text-slate-300">{user.store_name}</div>
                              <code className="text-xs text-slate-500">{user.store_code}</code>
                            </div>
                            <button
                              onClick={() => {
                                setEditingUserId(user.id)
                                setEditingField('store')
                              }}
                              className="text-slate-400 hover:text-[#A29BFE]"
                              title="店舗を変更"
                            >
                              <Edit2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {editingUserId === user.id && editingField === 'role' ? (
                          <div className="flex items-center gap-2">
                            <select
                              onChange={(e) => handleRoleChange(user.id, e.target.value as 'admin' | 'manager' | 'user')}
                              className="px-2 py-1 bg-white/10 border border-white/20 rounded text-sm text-white"
                              defaultValue={user.role}
                            >
                              <option value="user">ユーザー</option>
                              <option value="manager">マネージャー</option>
                              <option value="admin">管理者</option>
                            </select>
                            <button
                              onClick={() => {
                                setEditingUserId(null)
                                setEditingField(null)
                              }}
                              className="text-slate-400 hover:text-white"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {getRoleBadge(user.role)}
                            <button
                              onClick={() => {
                                setEditingUserId(user.id)
                                setEditingField('role')
                              }}
                              className="text-slate-400 hover:text-[#A29BFE]"
                              title="権限を変更"
                            >
                              <Edit2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-4 text-slate-400 text-sm">
                        {new Date(user.created_at).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <button
                          onClick={() => handleDeleteUser(user.id, user.display_name)}
                          className="text-red-400 hover:text-red-300 p-2 transition-colors"
                          title="削除"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
