/**
 * Supabaseストレージバケットの状態を確認するスクリプト
 */

const SUPABASE_URL = 'https://guargnhnblhiupjumkhe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1YXJnbmhuYmxoaXVwanVta2hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjAxMTIsImV4cCI6MjA3ODMzNjExMn0.UYmflAhojEj_N_tGei_L4DgqSrTMPCVtWbiQQ8DQTMM';

async function checkStorage() {
  console.log('🔍 Supabaseストレージバケットを確認中...\n');

  try {
    // バケット一覧を取得
    const response = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buckets = await response.json();

    console.log('📦 バケット一覧:');
    console.log(JSON.stringify(buckets, null, 2));

    // avatarsバケットの確認
    const avatarsBucket = buckets.find(b => b.id === 'avatars' || b.name === 'avatars');

    if (avatarsBucket) {
      console.log('\n✅ avatarsバケットが見つかりました:');
      console.log(JSON.stringify(avatarsBucket, null, 2));
    } else {
      console.log('\n❌ avatarsバケットが見つかりません！');
      console.log('\n📝 解決方法:');
      console.log('1. Supabase Dashboard → Storage → New bucket');
      console.log('2. Name: avatars');
      console.log('3. Public bucket: ON');
      console.log('4. Save');
      console.log('\nまたは、SQL Editorで以下を実行:');
      console.log(`
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;
      `);
    }

  } catch (error) {
    console.error('❌ エラー:', error.message);
    console.error('\n📝 確認事項:');
    console.error('- Supabase URLが正しいか');
    console.error('- Anon Keyが正しいか');
    console.error('- ネットワーク接続が正常か');
  }
}

checkStorage();
