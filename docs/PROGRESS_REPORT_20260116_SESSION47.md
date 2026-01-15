# 進捗レポート - セッション47

**日時**: 2026年1月16日
**セッション**: 47
**担当**: Claude (Sonnet 4.5)

---

## 📋 セッション概要

ユーザーからの要望「10個のペルソナがランダムで出ますが、最初の画面でペルソナを選択できるようにできますか？」に対応し、ペルソナ選択機能を実装しました。

**主要な実装**:
1. ✅ ペルソナ選択モーダルUI（10個のペルソナから選択）
2. ✅ バックエンドAPIエンドポイント追加（`/api/scenarios/personas`）
3. ✅ ペルソナID指定による選択ロジック実装
4. ✅ Reactクロージャー問題の修正

---

## 🎯 実装内容

### 1. フロントエンド - ペルソナ選択UI

**新規ファイル**: `src/components/PersonaSelector.tsx`

**機能**:
- 10個のペルソナを美しいモーダルUIで表示
- 各ペルソナの詳細情報を表示:
  - 業種、地域、役職
  - 事業詳細
  - 課題（pain_points）
  - 予算感
  - 企業規模（従業員数、年商）
- ダークテーマのグラデーション背景
- ガラスカードエフェクト
- レスポンシブデザイン

**UI/UX**:
```tsx
// ペルソナカードの表示
- 選択状態: 紫色ボーダー + チェックマーク
- 未選択状態: グレーボーダー + ホバーエフェクト
- 業種・地域・役職をタグで表示
- 課題を箇条書きで表示（最大2件）
- 予算感と企業規模を下部に表示
```

**API連携**:
```typescript
fetch('/api/scenarios/personas')
  .then(res => res.json())
  .then(data => {
    setPersonas(data.personas || []);
  });
```

---

### 2. バックエンド - ペルソナAPI

#### 2.1 ペルソナ一覧APIエンドポイント

**ファイル**: `blueprints/scenarios.py`

**エンドポイント**: `GET /api/scenarios/personas`

**レスポンス例**:
```json
{
  "success": true,
  "personas": [
    {
      "persona_id": "beauty_salon_recruitment",
      "persona_name": "美容サロン経営者（採用目的）",
      "base_profile": {
        "business_type": "美容サロン",
        "location": "新宿",
        "business_detail": "新宿で美容サロンを経営している。スタッフ不足で新規予約を断っている状態。若い世代にアピールして採用を強化したい。",
        "current_video_status": "月0本（未経験）",
        "budget_sense": "月15-20万円",
        "pain_points": [
          "応募者が全然来ない",
          "若い世代にアピールできない",
          "採用サイトだけでは限界",
          "サロンの雰囲気が伝わらない"
        ]
      },
      "company_details": {
        "employees": "50名",
        "revenue": "年商8億円",
        "role": "人事部長"
      }
    }
    // ... 他9個のペルソナ
  ]
}
```

**実装内容**:
```python
@scenarios_bp.route('/personas', methods=['GET'])
def get_personas():
    """ペルソナ一覧を取得"""
    try:
        return jsonify({
            'success': True,
            'personas': SHARED_PERSONAS
        })
    except Exception as e:
        logger.exception(f"ペルソナ一覧取得 - 予期しないエラー: {type(e).__name__}: {e}")
        return jsonify({
            'success': False,
            'error': 'ペルソナ一覧の取得に失敗しました'
        }), 500
```

#### 2.2 ペルソナID指定選択機能

**ファイル**: `app.py`

**新規関数**: `select_persona_by_id(persona_id, scene_id)`

```python
def select_persona_by_id(persona_id, scene_id):
    """
    指定されたpersona_idのペルソナを選択し、
    ベースプロフィールとシーン状況を統合して返す

    Args:
        persona_id: ペルソナID
        scene_id: シーンID (meeting_1st, meeting_1_5th, meeting_2nd, meeting_3rd, kickoff, upsell)

    Returns:
        dict: ペルソナ情報（base_profile + scene_variation）
    """
    if not SHARED_PERSONAS:
        logger.warning("[ペルソナ選択] 共有ペルソナが読み込まれていません")
        return None

    # persona_idが一致するペルソナを検索
    persona = next((p for p in SHARED_PERSONAS if p.get('persona_id') == persona_id), None)

    if not persona:
        logger.warning(f"[ペルソナ選択] 指定されたpersona_id '{persona_id}' が見つかりません")
        return None

    persona_name = persona.get('persona_name', '不明')
    logger.debug(f"[ペルソナ選択] ID指定選択: {persona_name} (ID: {persona_id})")

    # シーンに応じた状況設定を取得
    base_profile = persona.get('base_profile', {})
    scene_variations = persona.get('scene_variations', {})

    # シーンIDに対応する状況設定を取得（デフォルトはmeeting_1st）
    scene_variation = scene_variations.get(scene_id, scene_variations.get('meeting_1st', {}))

    if not scene_variation:
        logger.warning(f"[ペルソナ選択] 警告: シーンID '{scene_id}' の状況設定が見つかりません")

    # ベースプロフィールとシーン状況を統合
    combined_persona = {
        'persona_id': persona_id,
        'persona_name': persona_name,
        **base_profile,
        **scene_variation
    }

    logger.debug(f"[ペルソナ選択] シーン: {scene_id}, 態度: {scene_variation.get('tone', '不明')}")

    return combined_persona
```

**app.configへの登録**:
```python
app.config['select_persona_by_id'] = select_persona_by_id
app.config['SHARED_PERSONAS'] = SHARED_PERSONAS  # ペルソナ一覧
```

#### 2.3 会話エンドポイントの修正

**ファイル**: `blueprints/conversations.py`

**受信パラメータ追加**:
```python
data = request.get_json()
user_message = data.get('message', '')
conversation_history = data.get('history', [])
scenario_id = data.get('scenario_id') or DEFAULT_SCENARIO_ID
conversation_id = data.get('conversation_id')  # 会話ID
request_persona = data.get('persona')  # フロントエンドから送信されたペルソナ
persona_id = data.get('persona_id')  # 新規: フロントエンドから送信されたペルソナID
```

**ペルソナ選択ロジック修正**:
```python
if is_first_message:
    # 会話開始時: persona_idが指定されている場合はそのペルソナを使用、なければランダム選択
    if persona_id:
        persona = select_persona_by_id(persona_id, scenario_id)
        logger.info(f"[ペルソナ選択/ストリーミング] 新規会話: ID指定選択 - {persona.get('persona_name', 'Unknown') if persona else 'None'} (ID: {persona_id})")
    else:
        persona = select_random_persona_for_scene(scenario_id)
        logger.info(f"[ペルソナ選択/ストリーミング] 新規会話: ランダム選択 - {persona.get('persona_name', 'Unknown') if persona else 'None'}")
```

---

### 3. RoleplayApp.tsx の修正

#### 3.1 ステート追加

```typescript
const [showPersonaSelector, setShowPersonaSelector] = useState(false); // ペルソナ選択モーダルの表示状態
const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null); // 選択されたペルソナID
const selectedPersonaIdRef = useRef<string | null>(null); // クロージャー問題回避用Ref
```

#### 3.2 シナリオ選択時の処理

```typescript
// シナリオ選択時に、会話をリセット（ユーザーが最初に話しかける形式）
useEffect(() => {
  if (selectedScenarioId) {
    // シナリオが切り替わったら会話をリセット
    setMessages([]);
    messagesRef.current = [];
    setEvaluation(null);
    setShowEvaluation(false);
    setConversationId(null);
    setCurrentPersona(null); // ペルソナ情報もリセット
    setSelectedPersonaId(null); // ペルソナ選択もリセット
    conversationStartTime.current = new Date();

    // デフォルト表情（listening）の静止画を表示
    const defaultExpression = getDefaultExpression(currentAvatarId);
    setImageSrc(defaultExpression);
    setVideoSrc(undefined);
    lastExpressionRef.current = defaultExpression;

    // 字幕をクリア
    setMediaSubtitle('');

    // ペルソナ選択モーダルを表示
    setShowPersonaSelector(true);
  }
}, [selectedScenarioId]);
```

#### 3.3 Ref同期

```typescript
// selectedPersonaIdの変更を監視してRefに同期
useEffect(() => {
  selectedPersonaIdRef.current = selectedPersonaId;
  console.log('[ペルソナID監視] selectedPersonaIdが更新されました:', selectedPersonaId);
}, [selectedPersonaId]);
```

#### 3.4 API送信時の修正

```typescript
// SSEでストリーミング受信
const personaIdToSend = selectedPersonaIdRef.current; // Refから最新値を取得
console.log(`[API送信] persona_id: ${personaIdToSend ? personaIdToSend : 'なし'}`);

const response = await fetch('/api/chat-stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: text,
    history: historyToSend,
    scenario_id: selectedScenarioId,
    conversation_id: conversationId,
    persona: personaToSend,
    persona_id: personaIdToSend // 選択されたペルソナID
  }),
});
```

#### 3.5 ペルソナ選択モーダルの統合

```typescript
{/* ペルソナ選択モーダル */}
<PersonaSelector
  isOpen={showPersonaSelector}
  onSelect={(personaId) => {
    setSelectedPersonaId(personaId);
    setShowPersonaSelector(false);
  }}
  onClose={() => setShowPersonaSelector(false)}
/>
```

---

## 🐛 バグ修正

### 問題: Reactクロージャー問題

**症状**:
- ペルソナを選択しても、バックエンドにpersona_idが送信されない
- `[API送信] persona_id: なし` とログに表示される
- 選んだペルソナと異なる内容（ランダムペルソナ）が返ってくる

**原因**:
`handleSendStream`関数が定義された時点の`selectedPersonaId`の値（null）をキャプチャし、後で`setSelectedPersonaId`で更新されても反映されない。

**解決策**:
1. `selectedPersonaIdRef`を追加（useRef）
2. `selectedPersonaId`が変更されたらRefを同期するuseEffectを追加
3. `handleSendStream`内でRefから最新値を取得して送信

**修正後のフロー**:
```
1. ペルソナ選択モーダル表示
2. ユーザーがペルソナを選択
3. setSelectedPersonaId(personaId) 実行
4. useEffectでselectedPersonaIdRef.currentを更新
5. ユーザーがメッセージ送信
6. handleSendStream内でselectedPersonaIdRef.currentから最新値を取得
7. persona_idをAPIに送信 ✅
```

---

## 📊 ペルソナ一覧（10個）

| No | persona_id | ペルソナ名 | 業種 | 予算感 |
|----|-----------|----------|------|--------|
| 1 | beauty_salon_recruitment | 美容サロン経営者（採用目的） | 美容サロン | 月15-20万円 |
| 2 | multi_store_restaurant | 多店舗展開飲食店オーナー | 多店舗展開飲食店 | 月20-25万円 |
| 3 | ec_business_limited_assets | EC事業者（素材が少ない、コスト高） | アパレルEC | 月15-18万円 |
| 4 | real_estate_local | 不動産会社（地域に特化して集客したい） | 不動産仲介 | 月18-22万円 |
| 5 | matching_app | マッチングアプリ運営（インストール伸びない） | マッチングアプリ運営 | 月25-30万円 |
| 6 | ad_agency_resources | 広告代理店（制作のリソースが足りない） | 広告代理店 | 月30-35万円 |
| 7 | recruitment_agency_competition | 人材紹介（競合に負けている） | 人材紹介会社 | 月15-20万円 |
| 8 | driver_recruitment | 運送会社（ドライバー採用、応募を増やしたい） | 運送会社 | 月18-23万円 |
| 9 | construction_recruitment_creative | 建設会社（採用、面白い撮影をしたい） | 建設会社 | 月15-20万円 |
| 10 | btob_saas_ad_performance | BtoB SaaS企業（広告の訴求力を高めたい） | BtoB SaaS企業 | 月25-30万円 |

---

## 🎓 動作フロー

```
1. ユーザーがシナリオを選択（例: meeting_1st）
   ↓
2. useEffectが発火してペルソナ選択モーダルを自動表示
   ↓
3. /api/scenarios/personas から10個のペルソナを取得
   ↓
4. モーダルに10個のペルソナカードを表示
   ↓
5. ユーザーがペルソナを選択（例: beauty_salon_recruitment）
   ↓
6. setSelectedPersonaId('beauty_salon_recruitment')
   ↓
7. useEffectでselectedPersonaIdRef.currentを更新
   ↓
8. モーダルを閉じる
   ↓
9. ユーザーがメッセージを送信
   ↓
10. handleSendStream内でselectedPersonaIdRef.currentから値を取得
    ↓
11. /api/chat-stream に以下を送信:
    {
      message: "御社の課題などの内容を教えていただけますか?",
      history: [],
      scenario_id: "meeting_1st",
      conversation_id: null,
      persona: null,
      persona_id: "beauty_salon_recruitment" ✅
    }
    ↓
12. バックエンドでselect_persona_by_id('beauty_salon_recruitment', 'meeting_1st')を呼び出し
    ↓
13. 選択されたペルソナの情報を取得
    ↓
14. ペルソナに応じた音声設定を追加（voice_name, speaking_rate）
    ↓
15. GPT-4o-miniで応答生成（ペルソナの性格・課題を反映）
    ↓
16. TTS（tts-1-hd）で音声生成（ペルソナの音声設定を使用）
    ↓
17. フロントエンドに応答をストリーミング
    ↓
18. ペルソナ情報をcurrentPersonaに保存
    ↓
19. 以降の会話では保存されたペルソナを継続使用
```

---

## 📈 技術詳細

### Reactクロージャー問題とは

**問題**:
```typescript
const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);

const handleSendStream = async (text: string) => {
  // この時点でselectedPersonaIdの値（null）がキャプチャされる
  console.log(selectedPersonaId); // → null

  // APIに送信
  fetch('/api/chat-stream', {
    body: JSON.stringify({
      persona_id: selectedPersonaId // → 常にnull
    })
  });
};

// useEffectの外で関数が定義されているため、
// 後でsetSelectedPersonaId('beauty_salon_recruitment')を呼んでも
// handleSendStream内のselectedPersonaIdは更新されない
```

**解決策（useRef使用）**:
```typescript
const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
const selectedPersonaIdRef = useRef<string | null>(null); // Ref追加

// selectedPersonaIdが変更されたらRefを同期
useEffect(() => {
  selectedPersonaIdRef.current = selectedPersonaId;
}, [selectedPersonaId]);

const handleSendStream = async (text: string) => {
  // Refから最新値を取得（常に最新の値が取れる）
  const personaIdToSend = selectedPersonaIdRef.current;
  console.log(personaIdToSend); // → 'beauty_salon_recruitment'

  // APIに送信
  fetch('/api/chat-stream', {
    body: JSON.stringify({
      persona_id: personaIdToSend // → 正しく送信される ✅
    })
  });
};
```

---

## 🧪 テスト結果

### フロントエンドビルド
- ✅ ビルド成功
- ✅ 最終サイズ: 566.89 kB
- ✅ TypeScriptエラーなし

### APIテスト
```bash
$ curl http://localhost:5001/api/scenarios/personas | jq '.personas | length'
10  # ✅ 10個のペルソナが正常に返される
```

### デバッグログ確認
```
[ペルソナID監視] selectedPersonaIdが更新されました: beauty_salon_recruitment
[API送信] persona_id: beauty_salon_recruitment ✅
[リクエスト受信] conversation_id=null, request_persona=なし, persona_id=beauty_salon_recruitment ✅
[ペルソナ選択/ストリーミング] 新規会話: ID指定選択 - 美容サロン経営者（採用目的） (ID: beauty_salon_recruitment) ✅
```

---

## 🚀 デプロイ状況

**コミット数**: 2件

### コミット1: ペルソナ選択機能実装
- **コミットID**: `a3a8fd2`
- **メッセージ**: feat: ペルソナ選択機能を追加
- **変更ファイル**: 5ファイル
- **追加行数**: 286行

### コミット2: クロージャー問題修正
- **コミットID**: `a9c57b6`
- **メッセージ**: fix: ペルソナID送信のクロージャー問題を修正
- **変更ファイル**: 1ファイル
- **追加行数**: 11行

**ブランチ**: main
**プッシュ**: 完了 ✅

---

## 📝 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/components/PersonaSelector.tsx` | 新規作成: ペルソナ選択モーダルUI |
| `src/RoleplayApp.tsx` | ペルソナ選択モーダル統合、Ref追加 |
| `app.py` | select_persona_by_id()関数追加、config設定 |
| `blueprints/scenarios.py` | /api/scenarios/personas エンドポイント追加 |
| `blueprints/conversations.py` | persona_idパラメータ対応、選択ロジック修正 |

---

## 🎯 達成した機能

### ユーザー体験
1. ✅ シナリオ選択後、自動的にペルソナ選択モーダルが表示
2. ✅ 10個のペルソナの詳細情報を確認できる
3. ✅ 希望するペルソナを選択して会話開始
4. ✅ 選択したペルソナの性格・課題に基づいた応答が返る
5. ✅ 会話内でペルソナの音声・話し方が一貫

### 技術的達成
1. ✅ APIエンドポイント追加（/api/scenarios/personas）
2. ✅ ペルソナID指定選択機能実装
3. ✅ Reactクロージャー問題の解決
4. ✅ デバッグログの充実
5. ✅ レスポンシブUIの実装

---

## 🔧 既知の問題と制限

### データベースマイグレーション（Session 43より継続）

**未適用**: `database/14_add_persona_to_conversations.sql`

**適用手順**:
```sql
-- Supabase Dashboard → SQL Editor で実行
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS persona JSONB;
CREATE INDEX IF NOT EXISTS idx_conv_persona ON conversations USING GIN (persona);
```

**影響**:
- マイグレーション未適用でも、フロントエンドからのpersona送信でフォールバックするため、基本的な動作は可能
- ただし、DB永続化が完全に機能するためには適用が望ましい

---

## 📅 次のステップ（推奨）

### 優先度: 高
1. **本番環境での動作確認**
   - ペルソナ選択モーダルの表示確認
   - 10個のペルソナが正常に取得できるか確認
   - 選択したペルソナで正しく会話が開始されるか確認

2. **データベースマイグレーション実行**
   - `database/14_add_persona_to_conversations.sql`を本番に適用
   - persona永続化を完全に有効化

### 優先度: 中
3. **ペルソナ選択UIの改善検討**
   - 検索機能の追加（業種、予算感でフィルター）
   - お気に入りペルソナの保存機能
   - 最近使用したペルソナの表示

4. **ペルソナ情報の拡充**
   - さらに詳細なペルソナ情報の追加
   - 業種別のカスタマイズ

### 優先度: 低
5. **ペルソナのカスタマイズ機能**
   - ユーザーが独自のペルソナを作成できる機能
   - ペルソナのエクスポート/インポート機能

---

## 📊 セッション統計

- **時間**: 約2時間
- **コミット数**: 2件
- **新規ファイル**: 1ファイル（PersonaSelector.tsx）
- **変更ファイル数**: 5ファイル
- **追加/修正行数**: 約297行
- **ビルド回数**: 2回（全て成功）
- **バグ修正**: 1件（クロージャー問題）

---

## ✅ 完了チェックリスト

- [x] ペルソナ選択モーダルUI実装
- [x] /api/scenarios/personas エンドポイント追加
- [x] select_persona_by_id()関数実装
- [x] フロントエンドとバックエンドの連携
- [x] Reactクロージャー問題の修正
- [x] デバッグログの追加
- [x] フロントエンドビルド成功
- [x] GitHubにプッシュ
- [x] 進捗レポート作成
- [ ] データベースマイグレーション実行（要対応）
- [ ] 本番環境での動作確認

---

## 🔗 関連セッション

- **セッション45**: ペルソナ音声機能の基本実装
- **セッション46**: ペルソナ音声機能の完成（業種判定順序最適化、クロージャー問題解決、テンポ改善）
- **セッション47** (本セッション): ペルソナ選択機能の実装
  - ペルソナ選択モーダルUI
  - ペルソナID指定選択
  - Reactクロージャー問題の修正

---

**レポート作成日時**: 2026年1月16日
**次回セッション**: セッション48

---

## 📞 サポート

問題や質問がある場合は、以下を確認してください：

1. **ブラウザコンソールログ**: フロントエンドの動作確認
   - `[ペルソナID監視]` - selectedPersonaId更新確認
   - `[API送信]` - persona_id送信確認
2. **サーバーログ**: バックエンドの動作確認
   - `[ペルソナ選択/ストリーミング]` - ペルソナ選択確認
   - `[リクエスト受信]` - persona_id受信確認
3. **ペルソナ一覧API**: `/api/scenarios/personas`
   - 10個のペルソナが返されるか確認
4. **GitHub Issues**: バグ報告・機能要望

---

**End of Report**
