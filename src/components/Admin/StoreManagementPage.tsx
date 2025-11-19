import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { Plus, Copy, Check, Trash2, RefreshCw } from 'lucide-react'

interface Store {
  id: string
  store_code: string
  store_name: string
  created_at: string
}

/**
 * 店舗管理ページ（本部管理者専用）
 * 店舗コードの発行・管理を行う
 */
export function StoreManagementPage() {
  const navigate = useNavigate()
  const { profile, loading } = useAuth()
  const [stores, setStores] = useState<Store[]>([])
  const [loadingStores, setLoadingStores] = useState(true)
  const [storeName, setStoreName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // 権限チェック
  useEffect(() => {
    if (!loading && profile?.role !== 'admin') {
      navigate('/')
    }
  }, [loading, profile, navigate])

  // 店舗一覧を取得
  const fetchStores = async () => {
    try {
      setLoadingStores(true)
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setStores(data || [])
    } catch (err: any) {
      console.error('店舗一覧取得エラー:', err)
      setError(err.message)
    } finally {
      setLoadingStores(false)
    }
  }

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchStores()
    }
  }, [profile])

  // 店舗コードを自動生成（8桁の英数字）
  const generateStoreCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 紛らわしい文字を除外
    let code = ''
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
  }

  // 店舗を作成
  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeName.trim()) {
      setError('店舗名を入力してください')
      return
    }

    try {
      setCreating(true)
      setError(null)

      const storeCode = generateStoreCode()

      const { error } = await supabase
        .from('stores')
        .insert({
          store_code: storeCode,
          store_name: storeName.trim()
        })

      if (error) throw error

      // 成功したら一覧を再取得
      await fetchStores()
      setStoreName('')

      // 自動的にコピー
      copyToClipboard(storeCode)
    } catch (err: any) {
      console.error('店舗作成エラー:', err)
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  // クリップボードにコピー
  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  // 店舗を削除
  const handleDeleteStore = async (storeId: string, storeName: string) => {
    if (!confirm(`「${storeName}」を削除してもよろしいですか？\n※この店舗に紐付くユーザーデータも削除されます。`)) {
      return
    }

    try {
      const { error } = await supabase
        .from('stores')
        .delete()
        .eq('id', storeId)

      if (error) throw error

      await fetchStores()
    } catch (err: any) {
      console.error('店舗削除エラー:', err)
      setError(err.message)
    }
  }

  if (loading || (profile?.role === 'admin' && loadingStores)) {
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
      <div className="max-w-6xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/')}
            className="text-[#A29BFE] hover:text-[#B9B0FF] mb-4 flex items-center gap-2 transition-colors"
          >
            ← メイン画面に戻る
          </button>
          <h1 className="text-3xl font-bold text-white">店舗管理</h1>
          <p className="text-slate-400 mt-2">店舗コードの発行・管理</p>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 glass-card border-red-500/30 bg-red-500/10">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* 新規店舗作成フォーム */}
        <div className="glass-card p-6 mb-8">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Plus size={24} className="text-[#A29BFE]" />
            新規店舗を作成
          </h2>
          <form onSubmit={handleCreateStore} className="space-y-4">
            <div>
              <label htmlFor="storeName" className="block text-sm font-medium text-slate-300 mb-2">
                店舗名
              </label>
              <input
                id="storeName"
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="例: 新宿店"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#6C5CE7]/60 focus:border-transparent transition-all backdrop-blur-sm"
                disabled={creating}
              />
            </div>
            <button
              type="submit"
              disabled={creating || !storeName.trim()}
              className="w-full px-6 py-3 bg-gradient-to-r from-[#6C5CE7] to-[#A29BFE] text-white rounded-2xl font-semibold hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all shadow-lg flex items-center justify-center gap-2"
            >
              {creating ? (
                <>
                  <RefreshCw size={20} className="animate-spin" />
                  作成中...
                </>
              ) : (
                <>
                  <Plus size={20} />
                  店舗コードを発行
                </>
              )}
            </button>
          </form>
          <p className="mt-4 text-sm text-slate-400">
            ※ 店舗コードは8桁の英数字で自動生成されます
          </p>
        </div>

        {/* 店舗一覧 */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">
              発行済み店舗コード（{stores.length}件）
            </h2>
            <button
              onClick={fetchStores}
              className="text-[#A29BFE] hover:text-[#B9B0FF] flex items-center gap-2 transition-colors"
            >
              <RefreshCw size={18} />
              更新
            </button>
          </div>

          {stores.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>まだ店舗が登録されていません</p>
              <p className="text-sm mt-2">上のフォームから新規店舗を作成してください</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 font-semibold text-slate-300">店舗名</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-300">店舗コード</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-300">作成日時</th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-300">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.map((store) => (
                    <tr key={store.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-4 px-4 font-medium text-white">{store.store_name}</td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <code className="px-3 py-1.5 bg-white/10 rounded-lg font-mono text-sm text-slate-200 border border-white/10">
                            {store.store_code}
                          </code>
                          <button
                            onClick={() => copyToClipboard(store.store_code)}
                            className="text-[#A29BFE] hover:text-[#B9B0FF] p-1 transition-colors"
                            title="コピー"
                          >
                            {copiedCode === store.store_code ? (
                              <Check size={18} className="text-green-400" />
                            ) : (
                              <Copy size={18} />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-slate-400 text-sm">
                        {new Date(store.created_at).toLocaleDateString('ja-JP', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <button
                          onClick={() => handleDeleteStore(store.id, store.store_name)}
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
