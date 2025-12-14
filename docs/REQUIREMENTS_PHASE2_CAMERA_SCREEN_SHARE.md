# 📋 要件定義書 - Phase 2（カメラ録画 + 画面共有機能）

**プロジェクト名**: SNS動画営業ロープレ自動化システム - Phase 2
**バージョン**: v6.0
**作成日**: 2025年12月14日
**対象期間**: Week 9-10（2週間）

---

## 🎯 1. プロジェクト概要

### 1.1 背景・目的

**現状の課題:**
- 現在のシステムは音声会話のみで、ユーザーの表情や姿勢が確認できない
- 資料を使ったプレゼン練習ができない
- 後から自分の営業姿勢を振り返る手段がない
- 実際のオンライン商談と同じ環境で練習できない

**Phase 2の目的:**
- ✅ カメラ録画機能で表情・姿勢を確認できる
- ✅ Google Meet風の画面共有で資料を使ったプレゼン練習が可能
- ✅ 録画をダウンロードして後から振り返り・フィードバック
- ✅ 実際のオンライン商談と同じ環境でトレーニング

---

## 📐 2. 機能要件（詳細）

### 2.1 カメラ録画機能

#### **FR-001: カメラアクセス**
- **要件**: ユーザーのWebカメラにアクセスして映像を取得
- **技術**: `navigator.mediaDevices.getUserMedia()`
- **対応デバイス**: PC（デスクトップ、ノートPC）のWebカメラ
- **解像度**: 1280×720 (HD)
- **フレームレート**: 30fps
- **音声**: マイク音声も同時録音

**受け入れ基準:**
- [ ] カメラアクセス許可ダイアログが表示される
- [ ] 許可後、カメラ映像がリアルタイムでプレビューされる
- [ ] カメラが見つからない場合、エラーメッセージを表示

---

#### **FR-002: カメラ映像の表示（PinP）**
- **要件**: メイン画面の右下に小窓でカメラ映像を表示
- **サイズ**: 320×240px（小窓）
- **配置**: MediaPanel内の右下
- **UI**: 角丸、影付き、録画中インジケーター表示

**受け入れ基準:**
- [ ] カメラ映像が右下に常時表示される
- [ ] AI応答や資料表示の邪魔にならない
- [ ] ドラッグで位置変更可能（オプション）

---

#### **FR-003: 録画開始/停止**
- **要件**: ボタンクリックで録画開始/停止
- **UI**:
  - 録画開始ボタン: 🎥 アイコン + "録画開始"
  - 録画中: 🔴 アイコン + "録画中 MM:SS"
  - 録画停止ボタン: ⏹️ アイコン + "停止"
- **録画内容**: カメラ映像 + マイク音声
- **録画形式**: WebM (VP9コーデック)

**受け入れ基準:**
- [ ] 録画開始ボタンをクリックすると録画が始まる
- [ ] 録画中は経過時間が表示される（MM:SS形式）
- [ ] 録画停止ボタンで録画が終了する
- [ ] 録画データがBlobとして保持される

---

#### **FR-004: 録画ダウンロード**
- **要件**: 録画停止後、ダウンロードボタンで動画を保存
- **ファイル名**: `roleplay_YYYYMMDD_HHMMSS.webm`
- **ファイルサイズ**: 約90MB/5分（2.5Mbps）
- **UI**: ⬇️ アイコン + "ダウンロード"ボタン

**受け入れ基準:**
- [ ] 録画停止後、ダウンロードボタンが表示される
- [ ] クリックするとWebMファイルがダウンロードされる
- [ ] ファイル名に日時が含まれる
- [ ] ダウンロード後、録画データはクリアされる

---

### 2.2 画面共有機能（Google Meet風）

#### **FR-005: 画面共有開始**
- **要件**: ボタンクリックで画面共有を開始
- **技術**: `navigator.mediaDevices.getDisplayMedia()`
- **共有対象**:
  - デスクトップ全体
  - 特定のウィンドウ（PowerPoint、PDFリーダーなど）
  - Chromeタブ（Webサイト）
- **解像度**: 最大1920×1080 (Full HD)
- **フレームレート**: 30fps

**受け入れ基準:**
- [ ] 画面共有ボタンをクリックすると、ブラウザの選択ダイアログが表示される
- [ ] ユーザーが共有対象を選択できる
- [ ] 選択後、MediaPanel内に画面共有映像が表示される
- [ ] 画面共有中は「共有中」インジケーターが表示される

---

#### **FR-006: 画面共有の表示**
- **要件**: MediaPanel内に画面共有映像を全画面表示
- **レイアウト**:
  - 画面共有がメイン（全体）
  - AIアバターは非表示 or 小窓（オプション）
  - カメラは右下に小窓（PinP）
- **画質**: 自動調整（ネットワーク状況に応じて）

**受け入れ基準:**
- [ ] 画面共有がMediaPanel全体に表示される
- [ ] カメラ映像は右下に小窓で表示される
- [ ] 画質が鮮明で文字が読める

---

#### **FR-007: 画面共有停止**
- **要件**: ボタンクリックまたはユーザーの共有停止で終了
- **UI**: ⏹️ アイコン + "画面共有停止"
- **動作**:
  - 画面共有ストリームを停止
  - AIアバター表示に戻る

**受け入れ基準:**
- [ ] 停止ボタンで画面共有が終了する
- [ ] ブラウザの共有停止ボタンでも検知して終了
- [ ] MediaPanelがAIアバター表示に戻る

---

### 2.3 合成録画機能

#### **FR-008: 画面共有 + カメラの合成録画**
- **要件**: 画面共有とカメラを合成して1つの動画として録画
- **レイアウト**:
  - 画面共有がメイン（1920×1080）
  - カメラが右下に小窓（320×180、PinP）
- **技術**: Canvas APIで合成 → MediaRecorder
- **フレームレート**: 30fps

**受け入れ基準:**
- [ ] 画面共有中に録画すると、画面共有がメインで録画される
- [ ] カメラ映像が右下に小窓として合成される
- [ ] 再生時にPowerPointのスライド + 自分の顔が同時に見える

---

#### **FR-009: カメラのみの録画**
- **要件**: 画面共有なしの場合、カメラのみを録画
- **解像度**: 1280×720 (HD)
- **レイアウト**: カメラ映像が全画面

**受け入れ基準:**
- [ ] 画面共有なしで録画すると、カメラのみが記録される
- [ ] ファイルサイズが小さくなる（約90MB/5分）

---

### 2.4 UI/UX要件

#### **FR-010: コントロールパネル**
- **配置**: Footer内に横並びで配置
- **ボタン一覧**:
  1. 🎤 会話モード（既存）
  2. 🖥️ 画面共有 / ⏹️ 画面共有停止
  3. 🎥 録画開始 / 🔴 録画中 MM:SS / ⏹️ 録画停止
  4. ⬇️ ダウンロード（録画停止後のみ表示）
  5. 🗑️ クリア（既存）
  6. 📊 講評（既存）

**受け入れ基準:**
- [ ] すべてのボタンが視認しやすい
- [ ] ボタンの状態が明確（有効/無効/実行中）
- [ ] ホバー時にツールチップが表示される

---

#### **FR-011: 録画中インジケーター**
- **要件**: 録画中であることを明確に表示
- **表示内容**:
  - 🔴 録画中
  - 経過時間（MM:SS）
  - 点滅アニメーション
- **配置**: カメラ小窓の上部

**受け入れ基準:**
- [ ] 録画中は常時表示される
- [ ] 赤色で目立つデザイン
- [ ] 経過時間が正確に表示される

---

#### **FR-012: エラーハンドリング**
- **要件**: カメラ/画面共有のエラーを適切に処理
- **エラーケース**:
  1. カメラが見つからない → "カメラが検出されませんでした"
  2. カメラアクセス拒否 → "カメラへのアクセスが拒否されました。ブラウザ設定を確認してください"
  3. 画面共有キャンセル → "画面共有がキャンセルされました"
  4. 録画失敗 → "録画に失敗しました。ブラウザを再起動してください"

**受け入れ基準:**
- [ ] すべてのエラーケースで適切なメッセージが表示される
- [ ] エラー後も他の機能が正常に動作する

---

## 🏗️ 3. 技術仕様

### 3.1 技術スタック

| 項目 | 技術 |
|-----|------|
| **カメラアクセス** | `navigator.mediaDevices.getUserMedia()` |
| **画面共有** | `navigator.mediaDevices.getDisplayMedia()` |
| **録画** | MediaRecorder API |
| **合成** | Canvas API |
| **ダウンロード** | Blob + URL.createObjectURL() |
| **対応ブラウザ** | Chrome 72+, Firefox 66+, Safari 13+ |

---

### 3.2 実装詳細（TypeScript）

#### **3.2.1 カメラアクセス**

```typescript
const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
const [isCameraActive, setIsCameraActive] = useState(false);
const cameraVideoRef = useRef<HTMLVideoElement>(null);

const startCamera = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: true
    });

    setCameraStream(stream);
    setIsCameraActive(true);

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = stream;
    }
  } catch (error) {
    if (error.name === 'NotFoundError') {
      setError('カメラが検出されませんでした');
    } else if (error.name === 'NotAllowedError') {
      setError('カメラへのアクセスが拒否されました');
    }
  }
};

const stopCamera = () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    setCameraStream(null);
    setIsCameraActive(false);
  }
};
```

---

#### **3.2.2 画面共有**

```typescript
const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
const [isScreenSharing, setIsScreenSharing] = useState(false);
const screenVideoRef = useRef<HTMLVideoElement>(null);

const startScreenShare = async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'window',
        width: { max: 1920 },
        height: { max: 1080 },
        frameRate: { max: 30 },
        cursor: 'always'
      },
      audio: false
    });

    setScreenStream(stream);
    setIsScreenSharing(true);

    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = stream;
    }

    // 画面共有が停止されたら自動検知
    stream.getVideoTracks()[0].onended = () => {
      stopScreenShare();
    };

  } catch (error) {
    if (error.name === 'NotAllowedError') {
      console.log('画面共有がキャンセルされました');
    }
  }
};

const stopScreenShare = () => {
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    setScreenStream(null);
    setIsScreenSharing(false);
  }
};
```

---

#### **3.2.3 合成録画**

```typescript
const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
const [isRecording, setIsRecording] = useState(false);
const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
const [recordingTime, setRecordingTime] = useState(0);
const canvasRef = useRef<HTMLCanvasElement>(null);

const startRecording = () => {
  if (!canvasRef.current) return;

  const canvas = canvasRef.current;
  const ctx = canvas.getContext('2d');

  // Canvas サイズ設定
  if (isScreenSharing) {
    canvas.width = 1920;
    canvas.height = 1080;
  } else {
    canvas.width = 1280;
    canvas.height = 720;
  }

  // 描画ループ
  const drawFrame = () => {
    if (!isRecording) return;

    if (isScreenSharing && screenVideoRef.current) {
      // 画面共有をメインに描画
      ctx?.drawImage(screenVideoRef.current, 0, 0, 1920, 1080);

      // カメラを右下に小窓として描画
      if (cameraVideoRef.current) {
        ctx?.drawImage(cameraVideoRef.current, 1600, 900, 320, 180);
      }
    } else if (cameraVideoRef.current) {
      // カメラのみ
      ctx?.drawImage(cameraVideoRef.current, 0, 0, 1280, 720);
    }

    requestAnimationFrame(drawFrame);
  };

  drawFrame();

  // Canvas を MediaStream として取得
  const canvasStream = canvas.captureStream(30);

  // カメラの音声トラックを追加
  if (cameraStream) {
    const audioTrack = cameraStream.getAudioTracks()[0];
    if (audioTrack) {
      canvasStream.addTrack(audioTrack);
    }
  }

  // MediaRecorder で録画
  const mediaRecorder = new MediaRecorder(canvasStream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 2500000  // 2.5Mbps
  });

  const chunks: Blob[] = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  mediaRecorder.onstop = () => {
    setRecordedChunks(chunks);
    setIsRecording(false);
  };

  mediaRecorder.start(1000);  // 1秒ごとにチャンク保存
  setRecorder(mediaRecorder);
  setIsRecording(true);

  // 録画時間のカウント
  const startTime = Date.now();
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    setRecordingTime(elapsed);
  }, 1000);
};

const stopRecording = () => {
  if (recorder) {
    recorder.stop();
    setIsRecording(false);
  }
};
```

---

#### **3.2.4 ダウンロード**

```typescript
const downloadRecording = () => {
  if (recordedChunks.length === 0) return;

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const filename = `roleplay_${
    now.getFullYear()
  }${String(now.getMonth() + 1).padStart(2, '0')}${
    String(now.getDate()).padStart(2, '0')
  }_${
    String(now.getHours()).padStart(2, '0')
  }${String(now.getMinutes()).padStart(2, '0')}${
    String(now.getSeconds()).padStart(2, '0')
  }.webm`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
  setRecordedChunks([]);
};
```

---

### 3.3 UI実装（React + Tailwind CSS）

```tsx
<div className="footer-controls">
  {/* 画面共有ボタン */}
  <button
    onClick={isScreenSharing ? stopScreenShare : startScreenShare}
    className={`btn ${isScreenSharing ? 'btn-danger' : 'btn-primary'}`}
    title={isScreenSharing ? '画面共有を停止' : '画面を共有'}
  >
    {isScreenSharing ? (
      <>⏹️ 画面共有停止</>
    ) : (
      <>🖥️ 画面共有</>
    )}
  </button>

  {/* 録画ボタン */}
  <button
    onClick={isRecording ? stopRecording : startRecording}
    className={`btn ${isRecording ? 'btn-danger' : 'btn-primary'}`}
    disabled={!isCameraActive}
    title={isRecording ? '録画を停止' : '録画を開始'}
  >
    {isRecording ? (
      <>🔴 録画中 {formatTime(recordingTime)}</>
    ) : (
      <>🎥 録画開始</>
    )}
  </button>

  {/* ダウンロードボタン */}
  {recordedChunks.length > 0 && (
    <button
      onClick={downloadRecording}
      className="btn btn-success"
      title="録画をダウンロード"
    >
      ⬇️ ダウンロード
    </button>
  )}
</div>

{/* カメラ小窓（PinP） */}
{isCameraActive && (
  <div className="camera-pip">
    <video
      ref={cameraVideoRef}
      autoPlay
      muted
      playsInline
      className="camera-video"
    />
    {isRecording && (
      <div className="recording-indicator">
        🔴 録画中 {formatTime(recordingTime)}
      </div>
    )}
  </div>
)}

{/* 画面共有表示 */}
{isScreenSharing && (
  <video
    ref={screenVideoRef}
    autoPlay
    playsInline
    className="screen-share-video"
  />
)}

{/* Canvas（非表示、録画用） */}
<canvas ref={canvasRef} style={{ display: 'none' }} />
```

---

## 📅 4. 実装スケジュール（Week 9-10）

### **Week 9: カメラ録画 + 画面共有（基本機能）**

| Day | 作業内容 | 成果物 |
|-----|---------|--------|
| **Day 1** | カメラアクセス実装 | getUserMedia() 動作確認 |
| **Day 2** | カメラPinP表示 | カメラ小窓の表示完了 |
| **Day 3** | 画面共有実装 | getDisplayMedia() 動作確認 |
| **Day 4** | 録画機能（カメラのみ） | MediaRecorder 動作確認 |
| **Day 5** | テスト・バグ修正 | Week 9 完了 |

---

### **Week 10: 合成録画 + UI/UX改善**

| Day | 作業内容 | 成果物 |
|-----|---------|--------|
| **Day 6** | Canvas合成実装 | 画面共有 + カメラ合成 |
| **Day 7** | ダウンロード機能 | WebMダウンロード動作確認 |
| **Day 8** | UI/UX改善 | ボタン配置、デザイン調整 |
| **Day 9** | 統合テスト | 全機能の動作確認 |
| **Day 10** | ドキュメント作成 | ユーザーガイド、技術ドキュメント |

---

## 💰 5. 開発費用見積もり

### 5.1 工数見積もり

| タスク | 工数（人日） | 備考 |
|-------|-----------|------|
| **カメラアクセス実装** | 1日 | getUserMedia() API |
| **カメラPinP表示** | 1日 | UI実装 |
| **画面共有実装** | 1.5日 | getDisplayMedia() API |
| **録画機能（基本）** | 1.5日 | MediaRecorder API |
| **Canvas合成録画** | 2日 | 画面共有 + カメラ合成 |
| **ダウンロード機能** | 0.5日 | Blob処理 |
| **UI/UX実装** | 1.5日 | ボタン、デザイン調整 |
| **エラーハンドリング** | 0.5日 | エラーケース対応 |
| **テスト** | 1日 | ブラウザ互換性テスト |
| **ドキュメント作成** | 0.5日 | ユーザーガイド |
| **合計** | **10日** | **2週間** |

---

### 5.2 費用見積もり

#### **パターン1: 中級エンジニア（フリーランス）**
```
単価: 6万円/日
工数: 10日
────────────────
合計: 60万円
```

#### **パターン2: 上級エンジニア（フリーランス）**
```
単価: 10万円/日
工数: 10日
────────────────
合計: 100万円
```

#### **パターン3: 社内開発（時給換算）**
```
時給: 5,000円
時間: 80時間（10日 × 8時間）
────────────────
合計: 40万円
```

---

### 5.3 運用コスト（追加なし）

| 項目 | 月額費用 | 備考 |
|-----|---------|------|
| **ストレージ** | 0円 | サーバー保存なし |
| **API** | 0円 | ブラウザ標準API使用 |
| **合計** | **0円** | 追加コストなし |

---

### 5.4 総開発費用まとめ

```
┌────────────────────────────────┐
│ Phase 2 開発費用見積もり        │
├────────────────────────────────┤
│ 工数: 10日（2週間）             │
│                                │
│ 費用レンジ:                     │
│  - 最安: 40万円（社内開発）     │
│  - 標準: 60万円（中級FL）       │
│  - 高品質: 100万円（上級FL）    │
│                                │
│ 運用コスト: 0円/月              │
└────────────────────────────────┘
```

**推奨**: 中級エンジニア **60万円**（品質とコストのバランスが最適）

---

## 🎯 6. 期待される効果

### 6.1 ビジネス効果

| 効果 | 詳細 | 期待値 |
|-----|------|--------|
| **トレーニング品質向上** | 表情・姿勢を確認できる | 30%向上 |
| **プレゼン力強化** | 資料を使った練習が可能 | 40%向上 |
| **フィードバック精度** | 録画で振り返りが可能 | 50%向上 |
| **実践力向上** | 実際のMTGと同じ環境 | 60%向上 |

---

### 6.2 ユーザー体験向上

**Before（Phase 1）:**
- 音声会話のみ
- 表情が見えない
- 資料が使えない

**After（Phase 2）:**
- ✅ 自分の表情・姿勢を確認
- ✅ PowerPoint、PDFを使ったプレゼン練習
- ✅ 録画で後から振り返り
- ✅ Google Meet風の実践的な環境

---

## 📋 7. 受け入れ基準（全体）

### 7.1 機能面

- [ ] カメラアクセスが正常に動作する
- [ ] 画面共有が正常に動作する
- [ ] カメラのみの録画ができる
- [ ] 画面共有 + カメラの合成録画ができる
- [ ] WebM形式でダウンロードできる
- [ ] ファイル名に日時が含まれる

### 7.2 UI/UX面

- [ ] すべてのボタンが視認しやすい
- [ ] 録画中インジケーターが明確
- [ ] エラーメッセージが分かりやすい
- [ ] レスポンシブデザイン（PC限定）

### 7.3 パフォーマンス

- [ ] 録画開始が1秒以内
- [ ] ダウンロードが10秒以内（5分動画）
- [ ] CPU使用率が80%以下
- [ ] メモリリークがない

### 7.4 ブラウザ互換性

- [ ] Chrome 72+ で動作
- [ ] Firefox 66+ で動作
- [ ] Safari 13+ で動作

---

## 📝 8. ドキュメント

### 8.1 作成するドキュメント

1. **ユーザーガイド**
   - カメラ録画の使い方
   - 画面共有の使い方
   - トラブルシューティング

2. **技術ドキュメント**
   - API仕様
   - コード構造
   - ブラウザ互換性

3. **テスト仕様書**
   - テストケース
   - 動作確認手順

---

## 🚀 9. デプロイメント

### 9.1 デプロイ手順

1. フロントエンド（React）をビルド
2. GitHubにプッシュ
3. Railwayが自動デプロイ
4. 動作確認テスト

### 9.2 ロールバック計画

- 問題発生時は前バージョンにロールバック
- Git revert で即座に対応可能

---

## 📌 10. リスクと対策

| リスク | 影響度 | 対策 |
|-------|--------|------|
| **ブラウザ非対応** | 中 | Chromeを推奨ブラウザとして明示 |
| **録画ファイルが大きい** | 低 | ビットレート調整で削減 |
| **CPU負荷が高い** | 中 | フレームレート30fps制限 |
| **モバイル非対応** | 低 | PC限定と割り切る |

---

## ✅ 11. まとめ

### 11.1 Phase 2 で実現すること

- ✅ Google Meet風の画面共有機能
- ✅ カメラ録画機能（PinP表示）
- ✅ 画面共有 + カメラの合成録画
- ✅ WebMダウンロード機能
- ✅ 実際のオンライン商談と同じ環境でトレーニング

### 11.2 開発期間・費用

- **期間**: 2週間（10営業日）
- **費用**: **60万円**（推奨）
- **運用コスト**: 0円/月

### 11.3 次のアクション

要件定義の承認後、すぐに開発を開始できます。

---

**以上、Phase 2（カメラ録画 + 画面共有機能）の要件定義書でした。**
