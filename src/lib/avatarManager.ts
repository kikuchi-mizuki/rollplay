/**
 * アバター管理
 * 複数のアバターを管理し、シナリオに応じて選択
 */
import { supabase } from './supabase';

export interface Avatar {
  id: string;
  name: string;
  image_url: string;
  description?: string;
  tags?: string[]; // ['male', 'female', 'business', 'casual', etc.]
  created_at?: string;
}

/**
 * ファイル名をサニタイズ（英数字とハイフン、アンダースコアのみ）
 */
function sanitizeFileName(fileName: string): string {
  // 日本語や特殊文字を削除し、英数字とハイフン、アンダースコアのみ残す
  return fileName
    .normalize('NFD') // Unicode正規化
    .replace(/[\u0300-\u036f]/g, '') // アクセント記号を削除
    .replace(/[^a-zA-Z0-9-_\.]/g, '-') // 英数字以外をハイフンに変換
    .replace(/--+/g, '-') // 連続するハイフンを1つに
    .replace(/^-|-$/g, '') // 先頭と末尾のハイフンを削除
    .toLowerCase();
}

/**
 * アバター画像をSupabaseにアップロード
 */
export async function uploadAvatarImage(file: File, name: string): Promise<string | null> {
  try {
    const fileExt = file.name.split('.').pop();
    // ファイル名をサニタイズ（日本語を削除）
    const sanitizedName = sanitizeFileName(name || 'avatar');
    // タイムスタンプとランダム文字列でユニークなファイル名を生成
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const fileName = `${sanitizedName}-${uniqueId}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    const { data, error } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) throw error;

    // 公開URLを取得
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(data.path);

    return publicUrl;
  } catch (error) {
    console.error('Avatar upload error:', error);
    return null;
  }
}

/**
 * アバターをデータベースに登録
 */
export async function createAvatar(avatar: Omit<Avatar, 'id' | 'created_at'>): Promise<Avatar | null> {
  try {
    const { data, error } = await supabase
      .from('avatars')
      .insert([{
        name: avatar.name,
        image_url: avatar.image_url,
        description: avatar.description,
        tags: avatar.tags
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Create avatar error:', error);
    return null;
  }
}

/**
 * すべてのアバターを取得
 */
export async function getAvatars(): Promise<Avatar[]> {
  try {
    const { data, error } = await supabase
      .from('avatars')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Get avatars error:', error);
    return [];
  }
}

/**
 * タグでアバターをフィルター
 */
export async function getAvatarsByTags(tags: string[]): Promise<Avatar[]> {
  try {
    const { data, error } = await supabase
      .from('avatars')
      .select('*')
      .overlaps('tags', tags);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Get avatars by tags error:', error);
    return [];
  }
}

/**
 * シナリオに合ったアバターをランダム選択
 */
export function selectAvatarForScenario(
  avatars: Avatar[],
  scenarioTags?: string[]
): Avatar | null {
  if (avatars.length === 0) return null;

  // シナリオタグが指定されている場合、マッチするアバターから選択
  if (scenarioTags && scenarioTags.length > 0) {
    const matchingAvatars = avatars.filter(avatar =>
      avatar.tags?.some(tag => scenarioTags.includes(tag))
    );

    if (matchingAvatars.length > 0) {
      return matchingAvatars[Math.floor(Math.random() * matchingAvatars.length)];
    }
  }

  // マッチしない場合はランダムに選択
  return avatars[Math.floor(Math.random() * avatars.length)];
}

/**
 * デフォルトアバター一覧
 */
export const DEFAULT_AVATARS: Avatar[] = [
  {
    id: 'default-alice',
    name: 'Alice',
    image_url: 'https://d-id-public-bucket.s3.amazonaws.com/alice.jpg',
    tags: ['female', 'business', 'professional']
  },
  {
    id: 'default-john',
    name: 'John',
    image_url: 'https://d-id-public-bucket.s3.amazonaws.com/john.jpg',
    tags: ['male', 'business', 'professional']
  }
];

/**
 * アバターを削除
 */
export async function deleteAvatar(avatarId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('avatars')
      .delete()
      .eq('id', avatarId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Delete avatar error:', error);
    return false;
  }
}
