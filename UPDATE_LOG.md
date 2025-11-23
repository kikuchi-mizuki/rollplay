# 更新履歴

## 2025-11-23 - UI/UX改善 & 音声自然化

### 実装内容

#### 1. 音声の自然化改善
**変更内容**
- OpenAI TTS音声を `alloy` → `nova` に変更（日本語に最適化）
- 会話速度を `0.95` → `0.90` に調整（より自然なペース）
- フロントエンド・バックエンド両方で設定を統一

**変更ファイル**
- `app.py`: TTS設定（line 594, 612）
- `src/lib/expressionSelector.ts`: voice設定（line 130, 133）

**コミット**: `5ebecf7`

---

#### 2. アバター位置の固定
**変更内容**
- アバター表示エリアを固定高さ（40vh）に設定
- `flex-shrink-0` を追加（縮小しないように）
- チャットエリアを `flex-1` でスクロール可能に

**変更ファイル**
- `src/RoleplayApp.tsx`: レイアウト設定（line 613, 627）

**効果**
- チャットメッセージが増えてもアバターが動かない
- チャットエリアのみがスクロール

**コミット**: `dee7c54`

---

#### 3. 話し方の流暢化
**変更内容**
- 不必要な相槌やフィラー（「あ」「えっと」「んー」）を削除
- より簡潔で流暢な会話に変更
- 会話例を自然な表現に修正

**変更ファイル**
- `app.py`: SALES_ROLEPLAY_PROMPT（line 333-353）

**変更詳細**
```diff
Before: 「あ、はい。えっと、InstagramとTikTokをやってるんですけど...」
After:  「InstagramとTikTokをやっているんですけど、正直あまり反応が良くなくて困っています」
```

**コミット**: `50b2e23`

---

#### 4. モバイルでのアバター中央配置（複数試行）

##### 試行1: objectPosition 追加
**変更内容**
- video と img に `objectPosition: 'center'` を追加

**変更ファイル**
- `src/components/MediaPanel.tsx`（line 64, 78）

**結果**: 不十分（まだ右に寄る）

**コミット**: `a46d582`

##### 試行2: margin/display 追加
**変更内容**
- `margin: 'auto'` と `display: 'block'` を追加
- `w-full h-full` → `max-w-full max-h-full` に変更

**変更ファイル**
- `src/components/MediaPanel.tsx`（line 76-82）

**結果**: 不十分（まだ右に寄る）

**コミット**: `f3e48c5`

##### 試行3: 正方形コンテナ
**変更内容**
- モバイルでアバターエリアを正方形に変更
- `h-[40vh]` → `max-w-[90vw] aspect-square mx-auto`

**変更ファイル**
- `src/RoleplayApp.tsx`（line 613）

**コミット**: `8299f44`

##### 試行4: アスペクト比設定削除（最終解決）
**変更内容**
- MediaPanel内の `aspect-[16/9]` と `md:aspect-video` を削除
- 親コンテナ（正方形）に合わせて表示

**変更ファイル**
- `src/components/MediaPanel.tsx`（line 59）

**効果**
- 左右の黒い余白を完全に解消
- アバターが正方形エリア全体に表示

**コミット**: `abec29c`

---

### システム状態

#### RAGデータ
- **総エントリ数**: 898件
- **シナリオ内訳**:
  - meeting_1st: 40%
  - meeting_2nd, meeting_3rd, kickoff, upsell: 各100+ エントリ
  - meeting_1_5th: 0件（音声ファイルなし）

#### 技術仕様
- **音声合成**: OpenAI TTS `nova` (速度: 0.90)
- **対話生成**: GPT-4
- **音声認識**: Whisper-1
- **ベクトル検索**: FAISS IndexFlatL2 (3072次元)
- **埋め込み**: text-embedding-3-large

#### UI/UX
- **モバイルレイアウト**: 正方形アバター表示（画面幅90%）
- **アバター位置**: 固定（スクロールしても動かない）
- **話し方**: 自然で流暢（フィラーなし）
- **表情切り替え**: 6種類（listening, smile, confused, thinking, nodding, interested）

#### デプロイ
- **サーバー**: http://127.0.0.1:5001
- **本番URL**: https://rollplay-production.up.railway.app

---

### 未解決の課題
- meeting_1_5th シナリオの音声データ収集

---

### 次回の改善候補
- アバターの出し分け実装（現在は avatar_03 固定）
- より多様な表情パターンの追加
- 音声速度の動的調整
