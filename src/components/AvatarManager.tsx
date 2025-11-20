import { useState, useEffect } from 'react';
import {
  Avatar,
  getAvatars,
  uploadAvatarImage,
  createAvatar,
  deleteAvatar,
  selectAvatarForScenario,
  DEFAULT_AVATARS
} from '../lib/avatarManager';

interface AvatarManagerProps {
  onSelectAvatar?: (avatar: Avatar) => void;
  currentScenarioTags?: string[];
}

export function AvatarManager({ onSelectAvatar, currentScenarioTags }: AvatarManagerProps) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null);

  // アバター一覧を読み込み
  useEffect(() => {
    loadAvatars();
  }, []);

  const loadAvatars = async () => {
    const data = await getAvatars();
    setAvatars([...DEFAULT_AVATARS, ...data]);
  };

  // 写真をアップロード
  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // ファイルサイズチェック（5MB以下）
    if (file.size > 5 * 1024 * 1024) {
      alert('ファイルサイズは5MB以下にしてください');
      return;
    }

    // 画像形式チェック
    if (!file.type.startsWith('image/')) {
      alert('画像ファイルを選択してください');
      return;
    }

    setIsUploading(true);

    try {
      // 1. 画像をアップロード
      const imageUrl = await uploadAvatarImage(file, 'custom');

      if (!imageUrl) {
        alert('アップロードに失敗しました');
        return;
      }

      // 2. アバターをデータベースに登録
      const name = prompt('アバター名を入力してください:', 'カスタムアバター');
      if (!name) return;

      const tagsInput = prompt('タグを入力してください（カンマ区切り）:', 'custom');
      const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()) : ['custom'];

      const newAvatar = await createAvatar({
        name,
        image_url: imageUrl,
        tags
      });

      if (newAvatar) {
        alert('アバターを登録しました！');
        await loadAvatars();
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('エラーが発生しました');
    } finally {
      setIsUploading(false);
    }
  };

  // アバターを選択
  const handleSelect = (avatar: Avatar) => {
    setSelectedAvatar(avatar);
    if (onSelectAvatar) {
      onSelectAvatar(avatar);
    }
  };

  // ランダム選択
  const handleRandomSelect = () => {
    const avatar = selectAvatarForScenario(avatars, currentScenarioTags);
    if (avatar) {
      handleSelect(avatar);
    }
  };

  // アバターを削除
  const handleDelete = async (avatarId: string) => {
    if (!confirm('このアバターを削除しますか？')) return;

    const success = await deleteAvatar(avatarId);
    if (success) {
      alert('削除しました');
      await loadAvatars();
    }
  };

  return (
    <div className="avatar-manager">
      <div className="header">
        <h3>アバター管理</h3>
        <div className="actions">
          <label className="upload-btn">
            <input
              type="file"
              accept="image/*"
              onChange={handleUpload}
              disabled={isUploading}
              style={{ display: 'none' }}
            />
            {isUploading ? 'アップロード中...' : '新しいアバターを追加'}
          </label>
          <button onClick={handleRandomSelect}>
            ランダム選択
          </button>
        </div>
      </div>

      <div className="avatar-grid">
        {avatars.map((avatar) => (
          <div
            key={avatar.id}
            className={`avatar-card ${selectedAvatar?.id === avatar.id ? 'selected' : ''}`}
            onClick={() => handleSelect(avatar)}
          >
            <img src={avatar.image_url} alt={avatar.name} />
            <div className="avatar-info">
              <h4>{avatar.name}</h4>
              {avatar.tags && (
                <div className="tags">
                  {avatar.tags.map(tag => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>
            {!avatar.id.startsWith('default-') && (
              <button
                className="delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(avatar.id);
                }}
              >
                削除
              </button>
            )}
          </div>
        ))}
      </div>

      <style>{`
        .avatar-manager {
          padding: 20px;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .actions {
          display: flex;
          gap: 10px;
        }

        .upload-btn, button {
          padding: 8px 16px;
          background: #4F46E5;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        }

        .upload-btn:hover, button:hover {
          background: #4338CA;
        }

        .avatar-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 16px;
        }

        .avatar-card {
          border: 2px solid #E5E7EB;
          border-radius: 8px;
          padding: 12px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }

        .avatar-card:hover {
          border-color: #4F46E5;
          transform: translateY(-2px);
        }

        .avatar-card.selected {
          border-color: #4F46E5;
          background: #EEF2FF;
        }

        .avatar-card img {
          width: 100%;
          aspect-ratio: 1;
          object-fit: cover;
          border-radius: 6px;
        }

        .avatar-info {
          margin-top: 8px;
        }

        .avatar-info h4 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
        }

        .tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 4px;
        }

        .tag {
          font-size: 11px;
          padding: 2px 6px;
          background: #E5E7EB;
          border-radius: 4px;
        }

        .delete-btn {
          position: absolute;
          top: 8px;
          right: 8px;
          padding: 4px 8px;
          background: #EF4444;
          font-size: 12px;
        }

        .delete-btn:hover {
          background: #DC2626;
        }
      `}</style>
    </div>
  );
}
