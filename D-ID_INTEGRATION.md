# D-ID 統合ガイド

アバターをセリフに合わせて動かす（リップシンク）機能の実装方法

## 📋 必要なもの

1. **D-ID APIキー**
   - [D-ID](https://www.d-id.com/)でアカウント作成
   - API Keyを取得（無料枠あり）

2. **アバター画像**
   - 顔写真（JPG, PNG）
   - 正面を向いた高解像度画像が最適

## 🚀 セットアップ

### 1. 環境変数を設定

```bash
# .env
D_ID_API_KEY=your_d_id_api_key_here
```

### 2. Pythonパッケージをインストール

```bash
pip install requests  # 既にインストール済みのはず
```

### 3. コードをデプロイ

```bash
git add d_id_client.py app.py src/components/DIDAvatar.tsx D-ID_INTEGRATION.md
git commit -m "feat: D-ID統合を追加"
git push
```

## 💡 使い方

### オプションA: RoleplayApp.tsxに統合（推奨）

AIの応答を受信したら、D-ID動画を生成：

```typescript
// RoleplayApp.tsx
import { useDIDAvatar } from './components/DIDAvatar';

function RoleplayApp() {
  const { videoUrl, loading, generateAndPlayVideo } = useDIDAvatar();
  const [videoSrc, setVideoSrc] = useState<string | undefined>();

  const handleAIResponse = async (aiText: string) => {
    // D-ID動画を生成
    const didVideoUrl = await generateAndPlayVideo(aiText);

    if (didVideoUrl) {
      setVideoSrc(didVideoUrl);
    }
  };

  return (
    <div className="app">
      {/* 動画エリア */}
      <div className="video-container">
        {loading && <div className="loading">動画生成中...</div>}
        {videoSrc && (
          <video
            src={videoSrc}
            autoPlay
            controls
            style={{ width: '100%', maxWidth: '640px' }}
          />
        )}
      </div>

      {/* ... 他のUI ... */}
    </div>
  );
}
```

### オプションB: 既存のチャット処理に統合

```typescript
// 既存のhandleSendMessage関数を修正
const handleSendMessage = async (userMessage: string) => {
  // 1. ユーザーの音声を認識（既存）
  // 2. AIが応答を生成（既存）
  const aiResponse = await generateAIResponse(userMessage);

  // 3. D-ID動画を生成（新規）
  const videoUrl = await fetch('/api/did-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: aiResponse,
      voice_id: 'ja-JP-NanamiNeural'
    })
  }).then(res => res.json());

  if (videoUrl.success) {
    setVideoSrc(videoUrl.video_url);
  }
};
```

## 🎨 アバター画像の準備

### 推奨仕様

- **解像度**: 512x512px 以上
- **フォーマット**: JPG, PNG
- **構図**: 正面向き、肩まで写っている
- **表情**: 自然な表情（無表情でもOK）

### アバター画像のアップロード方法

#### 方法1: Supabase Storageを使用

```typescript
// アバター画像をSupabaseにアップロード
import { supabase } from './lib/supabase';

async function uploadAvatar(file: File) {
  const { data, error } = await supabase.storage
    .from('avatars')
    .upload(`avatar-${Date.now()}.jpg`, file);

  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage
    .from('avatars')
    .getPublicUrl(data.path);

  return publicUrl;
}
```

#### 方法2: D-IDのデフォルトアバターを使用

```typescript
// デフォルトアバター（すぐに使える）
const DEFAULT_AVATARS = {
  alice: 'https://d-id-public-bucket.s3.amazonaws.com/alice.jpg',
  business_woman: 'https://d-id-public-bucket.s3.amazonaws.com/business_woman.jpg',
  // ... 他のD-ID公式アバター
};
```

## ⚙️ カスタマイズオプション

### 音声IDの変更

```typescript
// 日本語音声の選択肢
const VOICE_OPTIONS = {
  nanami: 'ja-JP-NanamiNeural',    // 女性（明るい）
  keita: 'ja-JP-KeitaNeural',      // 男性（落ち着いた）
  ayumi: 'ja-JP-AyumiNeural',      // 女性（優しい）
};

// API呼び出し時に指定
fetch('/api/did-video', {
  body: JSON.stringify({
    text: 'こんにちは',
    voice_id: VOICE_OPTIONS.nanami
  })
});
```

### アニメーションスタイル

D-IDは複数のアニメーションドライバーをサポート：

```python
# d_id_client.pyで変更
driver_options = {
    'lively': 'bank://lively',      # 活発
    'subtle': 'bank://subtle',      # 控えめ
    'stiff': 'bank://stiff',        # 硬め
}
```

## 💰 コストについて

### D-ID価格（2025年現在）

- **無料枠**: 20クレジット/月（約20本の動画）
- **Lite**: $5.9/月（120クレジット）
- **Basic**: $29/月（600クレジット）
- **Advanced**: $196/月（5,000クレジット）

### コスト削減のヒント（重要）

**キャッシング戦略で70-90%コスト削減可能！**

1. **動画キャッシング実装（推奨）**
   ```typescript
   import crypto from 'crypto';

   // テキスト+アバターのハッシュ値でキャッシュキー生成
   function getCacheKey(text: string, avatarUrl: string): string {
     return crypto
       .createHash('md5')
       .update(`${text}:${avatarUrl}`)
       .digest('hex');
   }

   // Supabase Storageでキャッシュ管理
   async function getCachedVideo(text: string, avatarUrl: string): Promise<string | null> {
     const cacheKey = getCacheKey(text, avatarUrl);

     const { data } = await supabase.storage
       .from('did-videos')
       .download(`cache/${cacheKey}.mp4`);

     if (data) {
       return URL.createObjectURL(data);
     }
     return null;
   }

   // 動画生成後にキャッシュ保存
   async function cacheVideo(text: string, avatarUrl: string, videoBlob: Blob) {
     const cacheKey = getCacheKey(text, avatarUrl);

     await supabase.storage
       .from('did-videos')
       .upload(`cache/${cacheKey}.mp4`, videoBlob);
   }

   // 使用例
   async function generateOrGetVideo(text: string, avatarUrl: string) {
     // キャッシュチェック
     const cached = await getCachedVideo(text, avatarUrl);
     if (cached) {
       console.log('キャッシュヒット！API呼び出しなし');
       return cached;
     }

     // 新規生成
     const videoUrl = await generateDIDVideo(text, avatarUrl);

     // キャッシュに保存
     const blob = await fetch(videoUrl).then(r => r.blob());
     await cacheVideo(text, avatarUrl, blob);

     return videoUrl;
   }
   ```

2. **よく使われる応答を事前生成**
   ```typescript
   // 初期構築フェーズで実行
   const COMMON_RESPONSES = [
     'それはどうしてですか？',
     'なるほど、もう少し詳しく教えてください',
     '具体的にはどのようなイメージですか？',
     'ありがとうございます',
     'そうなんですね',
     'わかりました',
     // ... 200-500本
   ];

   async function prebuildCache() {
     for (const text of COMMON_RESPONSES) {
       await generateOrGetVideo(text, DEFAULT_AVATAR);
     }
   }
   ```

3. **コスト試算**
   ```
   キャッシュなし: 100店舗 × 50回 × 4本 = 20,000本/月 = 30-60万円
   キャッシュあり: 20,000本 × 20% = 4,000本/月 = 2-4万円

   削減率: 約80-90%
   ```

4. **短い応答を優先**
   - 長い応答は分割して複数の短い動画に

5. **Webhook を使用**
   - 同期的に待機せず、Webhookで通知を受け取る

## 🔧 トラブルシューティング

### エラー: "D-ID APIが設定されていません"

```bash
# .envファイルを確認
echo $D_ID_API_KEY

# Railwayの場合、環境変数を追加
# Dashboard → Variables → D_ID_API_KEY
```

### エラー: "動画生成がタイムアウトしました"

- D-IDサーバーが混雑している可能性
- `timeout`パラメータを延長（120秒→180秒）
- Webhookを使用して非同期処理に変更

### 動画が表示されない

1. **CORSエラーを確認**
   ```python
   # app.py
   CORS(app, resources={
       r"/api/*": {"origins": "*"}
   })
   ```

2. **動画URLが有効か確認**
   ```typescript
   console.log('Video URL:', videoUrl);
   // ブラウザで直接開いてみる
   ```

## 📊 パフォーマンス最適化

### 1. 非同期処理（Webhook）

```python
# app.py - Webhook版
@app.route('/api/did-video-async', methods=['POST'])
def generate_did_video_async():
    webhook_url = f"{request.host_url}api/did-webhook"

    result = did_client.create_talk_from_text(
        text=text,
        voice_id=voice_id,
        webhook_url=webhook_url  # Webhook指定
    )

    return jsonify(talk_id=result['id'])

@app.route('/api/did-webhook', methods=['POST'])
def did_webhook():
    # 動画完成時の通知を受信
    data = request.json
    talk_id = data['id']
    video_url = data['result_url']

    # WebSocketでフロントエンドに通知
    # または、データベースに保存
```

### 2. プログレス表示

```typescript
// フロントエンド
const [progress, setProgress] = useState(0);

// 生成中のプログレスを表示
const checkProgress = setInterval(async () => {
  const response = await fetch(`/api/did-status/${talkId}`);
  const data = await response.json();

  if (data.status === 'done') {
    clearInterval(checkProgress);
    setVideoUrl(data.result_url);
  }

  setProgress(/* 推定進捗 */);
}, 2000);
```

## 🎯 次のステップ

1. **アバター画像を準備**
2. **D-ID APIキーを取得**
3. **環境変数を設定**
4. **テスト実行**
   ```bash
   curl -X POST http://localhost:5001/api/did-video \
     -H "Content-Type: application/json" \
     -d '{"text": "こんにちは、テストです"}'
   ```
5. **フロントエンドに統合**
6. **本番デプロイ**

---

**質問や問題があれば、お気軽にお問い合わせください！** 🚀
