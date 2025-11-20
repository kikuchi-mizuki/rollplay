# アバターカスタマイズガイド

自分の写真をアバターにして、複数のアバターを管理する方法

## 🎯 機能

✅ **自分の写真をアバターにできる**
- 顔写真をアップロード
- D-IDでリップシンク動画を生成

✅ **複数アバター管理（最大20本以上）**
- アバターを保存・管理
- タグ付けで分類
- シナリオに応じて自動選択
- ランダム表示

## 📋 セットアップ

### 1. Supabaseテーブルを作成

Supabase Dashboardで以下を実行：

1. **SQL Editor** を開く
2. `supabase/migrations/003_create_avatars_table.sql` の内容を貼り付け
3. **Run** をクリック

これで以下が作成されます：
- `avatars` テーブル
- `avatars` ストレージバケット
- RLSポリシー

### 2. アバター写真の準備

**推奨仕様：**
- **解像度**: 512x512px 以上
- **フォーマット**: JPG, PNG
- **ファイルサイズ**: 5MB以下
- **構図**: 正面向き、肩まで写っている
- **表情**: 自然な表情

**NG例：**
❌ 横向き
❌ 集合写真
❌ 顔が小さい
❌ 暗い写真

**OK例：**
✅ 証明写真風
✅ プロフィール写真
✅ 自撮り（正面）

## 🚀 使い方

### 方法A: アバター管理画面を使う

#### RoleplayApp.tsxに統合

\`\`\`typescript
import { AvatarManager } from './components/AvatarManager';
import { Avatar } from './lib/avatarManager';
import { useState } from 'react';

function RoleplayApp() {
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null);
  const [showAvatarManager, setShowAvatarManager] = useState(false);

  // D-ID動画生成時にselectedAvatarを使用
  const generateVideo = async (text: string) => {
    const response = await fetch('/api/did-video', {
      method: 'POST',
      body: JSON.stringify({
        text,
        avatar_url: selectedAvatar?.image_url || 'default'
      })
    });
    // ...
  };

  return (
    <div>
      {/* アバター管理ボタン */}
      <button onClick={() => setShowAvatarManager(true)}>
        アバター管理
      </button>

      {/* アバター管理モーダル */}
      {showAvatarManager && (
        <div className="modal">
          <AvatarManager
            onSelectAvatar={(avatar) => {
              setSelectedAvatar(avatar);
              setShowAvatarManager(false);
            }}
            currentScenarioTags={['business', 'professional']}
          />
          <button onClick={() => setShowAvatarManager(false)}>
            閉じる
          </button>
        </div>
      )}

      {/* ... 他のコンポーネント ... */}
    </div>
  );
}
\`\`\`

### 方法B: シナリオごとに自動選択

\`\`\`typescript
import { getAvatars, selectAvatarForScenario } from './lib/avatarManager';

// シナリオ変更時にアバターを自動選択
useEffect(() => {
  const loadAvatar = async () => {
    const avatars = await getAvatars();

    // シナリオのタグに応じてアバターを選択
    const scenarioTags = getScenarioTags(selectedScenarioId);
    const avatar = selectAvatarForScenario(avatars, scenarioTags);

    if (avatar) {
      setCurrentAvatar(avatar);
    }
  };

  loadAvatar();
}, [selectedScenarioId]);
\`\`\`

## 📊 アバター管理の例

### 例1: 20人のアバターをアップロード

1. **アバター管理画面を開く**
2. **「新しいアバターを追加」をクリック**
3. **写真を選択**
4. **名前を入力**: 「山田太郎」
5. **タグを入力**: 「male, business, 30s」
6. これを20回繰り返す

### 例2: シナリオごとにアバターを自動選択

\`\`\`typescript
// シナリオとタグのマッピング
const SCENARIO_TAGS = {
  'meeting_1st': ['business', 'professional', 'formal'],
  'sales_call': ['friendly', 'casual', 'sales'],
  'customer_service': ['female', 'friendly', 'service']
};

// シナリオに応じてアバターを選択
const scenario = 'meeting_1st';
const tags = SCENARIO_TAGS[scenario];
const avatar = selectAvatarForScenario(avatars, tags);
\`\`\`

### 例3: ランダム選択

\`\`\`typescript
// ボタンクリックでランダム選択
<button onClick={async () => {
  const avatars = await getAvatars();
  const randomAvatar = avatars[Math.floor(Math.random() * avatars.length)];
  setCurrentAvatar(randomAvatar);
}}>
  ランダム選択
</button>
\`\`\`

## 🎨 タグの使い方

### 推奨タグ

**性別:**
- `male` / `female`

**年齢層:**
- `20s` / `30s` / `40s` / `50s`

**職業/役割:**
- `business` - ビジネスパーソン
- `sales` - 営業
- `service` - サービス業
- `technical` - 技術職

**雰囲気:**
- `professional` - プロフェッショナル
- `friendly` - フレンドリー
- `formal` - フォーマル
- `casual` - カジュアル

**シーン:**
- `meeting` - 会議
- `presentation` - プレゼン
- `negotiation` - 商談

## 💡 活用例

### ケース1: BtoB営業ロープレ

アバター構成:
- 決裁者（50代男性、フォーマル）x 5人
- 担当者（30代男女、ビジネス）x 10人
- 受付（20代女性、フレンドリー）x 5人

シナリオに応じて自動選択：
\`\`\`typescript
const scenario = getScenario();
let tags: string[];

if (scenario.includes('決裁者')) {
  tags = ['male', '50s', 'formal'];
} else if (scenario.includes('担当者')) {
  tags = ['business', '30s'];
} else {
  tags = ['female', 'friendly', '20s'];
}

const avatar = selectAvatarForScenario(avatars, tags);
\`\`\`

### ケース2: 店舗接客ロープレ

アバター構成:
- 顧客（様々な年齢・性別）x 15人
- 上司（40代、フォーマル）x 3人
- 同僚（20-30代、カジュアル）x 2人

ランダム選択で毎回違う顧客を表示

## 🔧 高度な機能

### カスタムアバター選択ロジック

\`\`\`typescript
function selectAvatarIntelligently(
  avatars: Avatar[],
  context: {
    scenario: string;
    time_of_day: 'morning' | 'afternoon' | 'evening';
    difficulty: 'easy' | 'medium' | 'hard';
  }
): Avatar | null {
  let tags: string[] = [];

  // シナリオベース
  if (context.scenario.includes('negotiation')) {
    tags.push('business', 'professional');
  }

  // 難易度ベース
  if (context.difficulty === 'hard') {
    tags.push('formal', 'senior');
  }

  // 時間帯ベース
  if (context.time_of_day === 'evening') {
    tags.push('casual');
  }

  return selectAvatarForScenario(avatars, tags);
}
\`\`\`

### アバター使用履歴を記録

\`\`\`typescript
interface AvatarUsage {
  avatar_id: string;
  used_at: Date;
  scenario: string;
}

// 最近使ったアバターを避ける
function selectUnusedAvatar(
  avatars: Avatar[],
  recentUsage: AvatarUsage[]
): Avatar | null {
  const recentlyUsedIds = recentUsage.map(u => u.avatar_id);
  const availableAvatars = avatars.filter(
    a => !recentlyUsedIds.includes(a.id)
  );

  if (availableAvatars.length > 0) {
    return availableAvatars[Math.floor(Math.random() * availableAvatars.length)];
  }

  return avatars[Math.floor(Math.random() * avatars.length)];
}
\`\`\`

## 📝 注意事項

1. **肖像権**
   - 自分の写真のみ使用してください
   - 他人の写真を無断で使用しないでください

2. **D-IDコスト**
   - アバター数が多いと生成コストが増えます
   - キャッシュを活用して同じ動画を再利用しましょう

3. **画質**
   - 高解像度の写真を使用すると、より自然な動画になります
   - 正面向きの写真が最適です

## 🎯 次のステップ

1. **Supabaseテーブルを作成**
2. **アバター写真を20枚準備**
3. **アバター管理画面で写真をアップロード**
4. **タグを設定**
5. **RoleplayAppに統合**
6. **テスト実行**

---

**質問や問題があれば、お気軽にお問い合わせください！** 🚀
