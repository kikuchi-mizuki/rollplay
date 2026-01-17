# 進捗レポート - Session 50 (2026-01-17)

## 概要
背景ぼかし機能の実装において、MediaPipeからBodyPixへの完全移行と、各種最適化を実施。
人物検出精度、チカチカ防止、境界の自然さ、動きへの追従性を大幅に改善。

---

## 実施内容

### 1. MediaPipe → BodyPix への完全移行

#### 問題
- MediaPipe SelfieSegmentationで繰り返し発生する `Cannot read properties of undefined (reading 'length')` エラー
- CDNからのアセット読み込みが不安定
- 内部video要素の設定問題（visibility:hiddenやopacity:0、画面外配置など）
- 人物セグメンテーションが正しく動作しない

#### 解決策
```bash
# パッケージ変更
npm uninstall @mediapipe/selfie_segmentation
npm install @tensorflow/tfjs @tensorflow-models/body-pix
```

**BodyPix設定:**
- architecture: MobileNetV1
- outputStride: 16
- multiplier: 1.0（0.75→1.0で精度向上）
- quantBytes: 4（2→4で精度向上）
- internalResolution: medium
- segmentationThreshold: 0.5

**関連コミット:**
- `e0cd105`: MediaPipeをBodyPixに置き換えて背景ぼかし機能を安定化
- `ca000ec`: TypeScriptビルドエラーを修正 - 未使用変数を削除

---

### 2. Content Security Policy (CSP) 設定

#### 問題
```
Refused to connect to 'https://storage.googleapis.com/...'
violates the document's Content Security Policy
```

#### 解決策
`app.py`のCSPに `https://storage.googleapis.com` を追加

```python
response.headers['Content-Security-Policy'] = "...; connect-src 'self' https://*.supabase.co https://api.openai.com https://cdn.jsdelivr.net https://storage.googleapis.com;"
```

**関連コミット:**
- `0d9d630`: CSPにstorage.googleapis.comを追加してBodyPixモデル読み込みを許可

---

### 3. UI/UX の簡素化

#### 変更内容
**削除した機能:**
- 背景色モード（'color'）
- 背景色選択UI
- BACKGROUND_COLORS定数

**新しいUI:**
- シンプルなON/OFFトグル
- ぼかし強度スライダー（5-30px）

**関連コミット:**
- `79929d5`: 背景ぼかし機能を大幅改善（チカチカ防止・境界精度向上）

---

### 4. チカチカ防止（時間的安定化）

#### 実装内容

**基本的な時間的安定化:**
```typescript
function stabilizeMask(currentMask: Uint8Array, previousMask: Uint8Array | null): Uint8Array {
  const stabilized = new Uint8Array(currentMask.length);
  const alpha = 0.85; // 85%現在、15%前フレーム

  for (let i = 0; i < currentMask.length; i++) {
    stabilized[i] = currentMask[i] * alpha + previousMask[i] * (1 - alpha);
  }

  return stabilized;
}
```

**適応的な安定化（動き検出時）:**
```typescript
// 大きな変化がある場合は現在フレームを優先
const diff = Math.abs(currentMask[i] - previousMask[i]);
const adaptiveAlpha = diff > 0.5 ? 0.95 : alpha;

stabilized[i] = currentMask[i] * adaptiveAlpha + previousMask[i] * (1 - adaptiveAlpha);
```

**特徴:**
- 静止時: 15%前フレームでチカチカ抑制
- 動作時: 5%前フレームで追従性向上
- 自動的に切り替え

**関連コミット:**
- `79929d5`: 背景ぼかし機能を大幅改善（チカチカ防止・境界精度向上）
- `f361f8c`: 動きに対する追従性を大幅改善

---

### 5. 境界精度の向上

#### エッジブレンディング実装

**Smoothstep関数による滑らかな補間:**
```typescript
function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
```

**適用方法:**
```typescript
for (let i = 0; i < maskData.length; i++) {
  const pixelIndex = i * 4;
  const personValue = maskData[i];
  const blendFactor = smoothstep(personValue);

  // RGB値をブレンド
  blurredImageData.data[pixelIndex] =
    originalImageData.data[pixelIndex] * blendFactor +
    blurredImageData.data[pixelIndex] * (1 - blendFactor);
  // ... G, B も同様
}
```

**効果:**
- 境界のジャギー（ギザギザ）を軽減
- 人物と背景の自然な融合
- 軽量な処理（7x7カーネルの境界検出を削除）

**関連コミット:**
- `79929d5`: 背景ぼかし機能を大幅改善（チカチカ防止・境界精度向上）
- `f361f8c`: 動きに対する追従性を大幅改善

---

### 6. パフォーマンス最適化

#### Canvas2D最適化
```typescript
const ctx = canvas.getContext('2d', { willReadFrequently: true });
```

**効果:**
- `getImageData()`の頻繁な呼び出しに最適化
- ブラウザがキャッシュ戦略を改善
- 処理速度向上

#### フレームスキップ防止
```typescript
const isProcessingRef = useRef(false);

const processFrame = async () => {
  if (isProcessingRef.current) {
    animationFrameRef.current = requestAnimationFrame(processFrame);
    return;
  }

  isProcessingRef.current = true;

  try {
    // セグメンテーション処理
  } finally {
    isProcessingRef.current = false;
    animationFrameRef.current = requestAnimationFrame(processFrame);
  }
};
```

**効果:**
- 処理キューが溜まらない
- 安定したフレームレート
- スムーズな映像

**関連コミット:**
- `c8b2703`: Canvas2DにwillReadFrequently属性を追加してパフォーマンス改善
- `f361f8c`: 動きに対する追従性を大幅改善

---

### 7. 人物検出精度の改善

#### デバッグ機能追加
```typescript
const personPixelCount = segmentation.data.filter((v: number) => v === 1).length;
const totalPixels = segmentation.data.length;
const personRatio = personPixelCount / totalPixels;

if (personRatio < 0.05) {
  console.warn('[BodyPix] 人物検出率が低い:', {
    personRatio: (personRatio * 100).toFixed(2) + '%',
    personPixels: personPixelCount,
    totalPixels
  });
}
```

**関連コミット:**
- `4e4586e`: 人物検出精度を改善してセグメンテーション設定を最適化

---

## 技術的な課題と解決

### 課題1: 内部video要素の扱い

**試行錯誤:**
1. `opacity: 0, visibility: 'hidden'` → MediaPipeがフレーム読み取れず
2. `left: '-9999px'` → MediaPipeが画像データ取得できず
3. `opacity: 0, zIndex: -1` → 同様の問題
4. **最終解決:** `cameraStream`をpropsで直接渡す方式に変更

**関連ファイル:**
- `src/components/CameraPip.tsx`
- `src/hooks/useBackgroundSegmentation.ts`

---

### 課題2: ストリームのコピータイミング

**問題:**
`useEffect`の依存配列に`backgroundMode`が含まれていたため、backgroundModeが変更されるまでストリームがコピーされない

**解決:**
```typescript
// 修正前
useEffect(() => {
  // ...
}, [cameraVideoRef, backgroundMode]);

// 修正後
useEffect(() => {
  // ...
}, [cameraStream]); // cameraStreamを直接監視
```

**関連コミット:**
- `35d36e3`: 内部video要素へのストリームコピーを初期化時に実行
- `e876163`: cameraStreamをpropsで直接渡してMediaPipe処理を確実に実行

---

## コミット履歴

| コミットID | 説明 |
|-----------|------|
| `e28058a` | fix: 背景ぼかし時のカメラ真っ黒問題を修正 |
| `2a5f573` | fix: セグメンテーション用video要素を画面外に配置してMediaPipe処理を修正 |
| `35d36e3` | fix: 内部video要素へのストリームコピーを初期化時に実行 |
| `e876163` | fix: cameraStreamをpropsで直接渡してMediaPipe処理を確実に実行 |
| `bd1e190` | fix: 内部video要素をopacity:0で非表示にしてMediaPipeエラーを解消 |
| `aac0682` | fix: MediaPipe locateFileにバージョン番号を指定してアセット読み込みを修正 |
| `e0cd105` | feat: MediaPipeをBodyPixに置き換えて背景ぼかし機能を安定化 |
| `ca000ec` | fix: TypeScriptビルドエラーを修正 - 未使用変数を削除 |
| `0d9d630` | fix: CSPにstorage.googleapis.comを追加してBodyPixモデル読み込みを許可 |
| `79929d5` | feat: 背景ぼかし機能を大幅改善（チカチカ防止・境界精度向上） |
| `4e4586e` | fix: 人物検出精度を改善してセグメンテーション設定を最適化 |
| `c8b2703` | perf: Canvas2DにwillReadFrequently属性を追加してパフォーマンス改善 |
| `f361f8c` | fix: 動きに対する追従性を大幅改善 |

---

## 成果

### 機能面
- ✅ 背景のみをぼかし、人物は鮮明に保持
- ✅ チカチカがほぼ解消
- ✅ 人物と背景の境界が自然でスムーズ
- ✅ 動きに素早く追従
- ✅ UIがシンプルで使いやすい（ON/OFFトグル）

### 技術面
- ✅ MediaPipeの不安定性を解消（BodyPixに移行）
- ✅ 処理速度向上（軽量化、フレームスキップ防止）
- ✅ 安定したフレームレート
- ✅ デバッグ機能の追加（人物検出率表示）

---

## 今後の改善案

### 1. パフォーマンス
- WebGL バックエンドの使用（TensorFlow.js）
- Web Workerでの並列処理
- 解像度の動的調整

### 2. 精度
- より高精度なモデル（ResNet50など）の検討
- モーフォロジー処理によるマスクの平滑化
- 二値化閾値の動的調整

### 3. 機能
- ぼかし以外のエフェクト（背景画像、仮想背景など）
- リアルタイムプレビュー
- エフェクトのプリセット

---

## 参考資料

### TensorFlow.js BodyPix
- [公式ドキュメント](https://github.com/tensorflow/tfjs-models/tree/master/body-pix)
- [デモ](https://storage.googleapis.com/tfjs-models/demos/body-pix/index.html)

### 関連技術
- Canvas API
- MediaStream API
- Web Workers
- WebGL

---

## 変更ファイル一覧

### 新規作成
なし（既存ファイルの修正のみ）

### 修正
- `src/hooks/useBackgroundSegmentation.ts` - MediaPipe→BodyPix完全書き換え
- `src/components/CameraPip.tsx` - UI簡素化、cameraStream props追加
- `app.py` - CSP設定追加
- `package.json` - 依存関係変更

### 削除
なし

---

**作成日:** 2026-01-17
**セッション:** Session 50
**担当:** Claude Code
