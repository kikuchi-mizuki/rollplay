import { AvatarManager } from '../components/AvatarManager';
import { Avatar } from '../lib/avatarManager';
import { useState } from 'react';

/**
 * アバター管理ページ
 * /avatar-management でアクセス可能
 */
export function AvatarManagementPage() {
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F3F4F6',
      padding: '20px'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        background: 'white',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <div style={{
          marginBottom: '24px',
          borderBottom: '1px solid #E5E7EB',
          paddingBottom: '16px'
        }}>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '600' }}>
            アバター管理
          </h1>
          <p style={{ margin: '8px 0 0', color: '#6B7280', fontSize: '14px' }}>
            アバター写真をアップロードして管理します
          </p>
        </div>

        {selectedAvatar && (
          <div style={{
            padding: '16px',
            background: '#EEF2FF',
            borderRadius: '8px',
            marginBottom: '20px',
            border: '1px solid #C7D2FE'
          }}>
            <strong>選択中のアバター:</strong> {selectedAvatar.name}
            {selectedAvatar.tags && (
              <span style={{ marginLeft: '12px', color: '#6B7280' }}>
                タグ: {selectedAvatar.tags.join(', ')}
              </span>
            )}
          </div>
        )}

        <AvatarManager
          onSelectAvatar={setSelectedAvatar}
        />

        <div style={{
          marginTop: '32px',
          padding: '16px',
          background: '#F9FAFB',
          borderRadius: '8px',
          border: '1px solid #E5E7EB'
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>使い方</h3>
          <ol style={{ margin: 0, paddingLeft: '20px', color: '#4B5563' }}>
            <li>「新しいアバターを追加」をクリック</li>
            <li>顔写真を選択（512x512px以上、正面向き推奨）</li>
            <li>アバター名を入力</li>
            <li>タグを入力（例: male, business, 30s）</li>
            <li>アップロード完了！</li>
          </ol>
          <p style={{ margin: '12px 0 0', fontSize: '14px', color: '#6B7280' }}>
            💡 タグを使用することで、シナリオに応じて適切なアバターを自動選択できます
          </p>
        </div>
      </div>
    </div>
  );
}
