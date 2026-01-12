# 進捗レポート：2026年1月12日（セッション39）

## 📅 セッション情報
- **日付**: 2026年1月12日
- **セッション番号**: 39
- **実施内容**: OpenAI TTS-1-HDからGoogle Cloud Text-to-Speechへの完全移行
- **作業時間**: 約2.5時間
- **開始時点**: セッション38完了後（68572e9コミット後）

---

## 🎯 実施した作業

### 1. **TTS音声品質問題の調査と試行錯誤**

#### **問題1: 読点後のスペース追加による英語誤認識**

**症状**: 「こちらこそ、よろしくお願いします」が英語で発音される

**試行した対策** (コミット: 2c3344b → 0ccb580):
```python
# 追加: 読点後にスペースを追加
result = re.sub(r'、(?!\s)', '、 ', result)
# 結果: OpenAI TTSが英語と誤認識 → 削除
```

**コミット**: `0ccb580` - 読点後のスペース追加を削除

---

#### **問題2: 「今日」の読み方が不自然**

**試行した対策1** (コミット: 79533b5):
- 「今日」→「きょう」のみ置換
- 結果: 改善されたが、他の単語も不自然

**試行した対策2** (コミット: 519473e):
- 約100単語を網羅的にひらがな変換
- ビジネス用語、動詞、形容詞など
- 結果: **過度にひらがな化すると英語と誤認識される**

**最終対策** (コミット: aca9154):
- ひらがな変換を最小限（3単語のみ）に減らす
- 「今日」「明日」「昨日」のみ
- その他の漢字は残して日本語であることを明示

---

#### **問題3: 日本語を英語で発音してしまう**

**原因**: 過度なひらがな化により、OpenAI TTS-1-HDが英語のローマ字読みと誤認識

**対策**: ひらがな変換を最小限に抑える（上記の最終対策）

---

#### **問題4: 所々日本語をちゃんと発音できない**

**ユーザーからのフィードバック**:
> 「所々日本語でちゃんと発言できていません。ロープレなのに会話が成り立ちません。」

**根本原因の特定**:
- OpenAI TTS-1-HDは英語向けに最適化されている
- 日本語の文脈理解が不完全
- 漢字の読み方を間違えることがある
- **TTS-1-HDではロープレに耐えうる自然な日本語音声は実現不可能**

---

### 2. **Google Cloud Text-to-Speechへの完全移行**

#### **移行の決定**

**選択肢の比較**:
1. OpenAI Realtime API: 自然だがコスト2-3倍
2. **Google Cloud TTS: 自然でコストほぼ同じ（選択）**
3. Azure Speech Service: 自然だが実装変更大
4. 現状維持: 非推奨

**ユーザーの選択**: Google Cloud TTS（コスト据え置きで品質向上）

---

#### **実装手順**

**ステップ1: Google Cloudプロジェクト設定**

1. Google Cloud Consoleでプロジェクト作成: `rollplay-sns-video`
2. Text-to-Speech APIを有効化
3. サービスアカウント作成: `rollplay@rollplay-sns-video.iam.gserviceaccount.com`
4. 役割: Cloud Text-to-Speech 管理者
5. JSONキーをダウンロード

**コミット**: 準備段階（コミットなし）

---

**ステップ2: ライブラリ追加**

**変更内容** (`requirements.txt`):
```diff
+ google-cloud-texttospeech==2.14.1
```

**変更内容** (`.env.example`):
```diff
+ # Google Cloud Text-to-Speech 認証情報（JSON形式）
+ GOOGLE_CLOUD_TTS_CREDENTIALS={"type":"service_account",...}
```

**コミット**: `7636509` の一部

---

**ステップ3: TTS生成関数の置き換え**

**場所**: `blueprints/conversations.py:679-744`

**Before（OpenAI TTS-1-HD）**:
```python
tts_response = openai_client.audio.speech.create(
    model="tts-1-hd",
    voice=selected_voice,
    input=normalized_chunk_text,
    speed=selected_speed
)
audio_data = tts_response.content
```

**After（Google Cloud TTS）**:
```python
from google.cloud import texttospeech

# 認証情報を環境変数から取得
credentials_json = os.getenv('GOOGLE_CLOUD_TTS_CREDENTIALS')
credentials_dict = json.loads(credentials_json)

# 一時ファイルに書き込んで認証
with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as f:
    json.dump(credentials_dict, f, indent=2)
    credentials_path = f.name
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credentials_path

client = texttospeech.TextToSpeechClient()

# 音声パラメータ設定
synthesis_input = texttospeech.SynthesisInput(text=normalized_chunk_text)
voice = texttospeech.VoiceSelectionParams(
    language_code="ja-JP",
    name="ja-JP-Neural2-B",  # 高品質なNeural2音声（女性声）
    ssml_gender=texttospeech.SsmlVoiceGender.FEMALE
)
audio_config = texttospeech.AudioConfig(
    audio_encoding=texttospeech.AudioEncoding.MP3,
    speaking_rate=selected_speed,
    pitch=0.0,
    volume_gain_db=0.0
)

# TTS生成
response = client.synthesize_speech(
    input=synthesis_input,
    voice=voice,
    audio_config=audio_config
)
audio_data = response.audio_content
```

**使用する音声**: `ja-JP-Neural2-B`（標準的な女性声、自然で明瞭）

**コミット**: `7636509`

---

**ステップ4: Railway環境変数設定**

**Railway Dashboard** → **Variables** → **New Variable**

**Variable Name**: `GOOGLE_CLOUD_TTS_CREDENTIALS`

**Value**: JSON形式（1行）
```json
{"type":"service_account","project_id":"rollplay-sns-video",...}
```

**実施**: ユーザーが手動で設定完了

---

**ステップ5: JSONパースエラーの修正**

**問題** (Railway初回デプロイ時):
```
ERROR: [TTS 最終エラー] チャンク1: ('File /tmp/tmp4beep_yj.json is not a valid json file.', JSONDecodeError('Invalid control character at: line 1 column 109 (char 108)'))
```

**原因**: 環境変数のJSON文字列に含まれる改行文字(`\n`)が正しく処理されない

**修正** (`blueprints/conversations.py:690-695`):
```python
# Before: 直接文字列を書き込み
f.write(credentials_json)

# After: JSONとしてパースして正しくフォーマット
credentials_dict = json.loads(credentials_json)
json.dump(credentials_dict, f, indent=2)
```

**コミット**: `6670f42`

---

### 3. **デバッグログの追加（Railway本番確認用）**

セッション38からの継続作業として、以下のデバッグログを追加：

**追加箇所**:
1. `generate()` 関数開始時 (line 628)
2. ThreadPoolExecutor初期化後 (line 633)
3. GPT API呼び出し前後 (lines 947, 958, 969)
4. チャンク分割時 (line 991)
5. TTS送信時 (lines 673, 676)
6. 最終チャンク処理時 (line 1021)
7. ストリーミング完了時 (line 1039)

**目的**: Railway本番環境でのデバッグ（logger.info()が出力されないため、print()を使用）

**コミット**: `e1f004e`, `8041f92`

---

## 📊 **コミット履歴**

```
6670f42 fix: Google Cloud TTS認証情報のJSONパースエラーを修正
7636509 feat: OpenAI TTS-1-HDからGoogle Cloud Text-to-Speechに移行
aca9154 fix: ひらがな変換を最小限に抑えて英語誤認識を防ぐ
519473e fix: ビジネス用語・頻出単語を網羅的にひらがな変換（TTS音声品質向上）
79533b5 fix: 読み間違えやすい日本語単語をひらがなに置換（今日→きょう等）
0ccb580 fix: 読点後のスペース追加を削除（OpenAI TTSが英語として解釈する問題）
67b8ad6 fix: 最終チャンク処理後にtext_bufferをクリア+デバッグログ追加
e1f004e debug: print()デバッグログを追加（logger.info()が出力されないため）
8041f92 debug: ストリーミング処理の詳細ログを追加（Railway本番デバッグ用）
```

---

## 🔍 **技術的な発見**

### **発見1: OpenAI TTS-1-HDの日本語対応の限界**

**問題点**:
1. 英語向けに最適化されており、日本語の文脈理解が不完全
2. 漢字の読み方を頻繁に間違える（「今日」→「こんにち」）
3. ひらがな化しすぎると英語と誤認識される
4. 読点+スペースを英語の句読点と判断する
5. **ロープレのような自然な会話には向かない**

**結論**: TTS-1-HDでは、どれだけテキスト正規化を工夫しても、自然な日本語音声は実現困難

---

### **発見2: ひらがな変換のジレンマ**

**問題**:
- 漢字のまま → TTS-1-HDが誤読する
- ひらがな化 → 英語と誤認識される

**試行錯誤**:
1. 3単語のみ変換 → 一部改善（79533b5）
2. 100単語変換 → 英語誤認識（519473e）
3. 3単語に戻す → バランス改善（aca9154）

**結論**: TTS-1-HDでは最適解が存在しない → Google Cloud TTSへ移行

---

### **発見3: Google Cloud TTSの認証方法**

**学んだこと**:
- 環境変数に直接JSON文字列を格納すると、改行文字(`\n`)の処理が問題になる
- `json.loads()` → `json.dump()` で正しくフォーマットする必要がある
- 一時ファイルに書き込んで `GOOGLE_APPLICATION_CREDENTIALS` 環境変数で指定

**修正**: コミット `6670f42`

---

### **発見4: Railway本番環境でのロギング**

**問題**: `logger.debug()` や `logger.info()` が出力されない

**原因**: Railwayのログレベル設定

**解決策**:
- 重要なログは `print(flush=True)` を使用
- これにより標準出力に即座に出力される

**実装**: コミット `e1f004e`, `8041f92`

---

## 📝 **次のステップ**

### **優先度: 高（即時対応）**

1. **Google Cloud TTS動作確認**
   - Railwayデプロイ完了後、音声品質をテスト
   - 「よろしくお願いします」と話しかけて確認
   - 期待: 自然な日本語発音、誤読なし、英語混在なし

2. **JSONパースエラーの確認**
   - コミット `6670f42` でエラーが解消されているか確認
   - エラーログに `JSONDecodeError` が出ないことを確認

### **優先度: 中**

3. **デバッグログのクリーンアップ**
   - Google Cloud TTS動作確認後
   - `print()` デバッグログを削除
   - `logger.info()` を `logger.debug()` に戻す

4. **音声の微調整**（必要に応じて）
   - 話速（speaking_rate）の調整
   - ピッチ（pitch）の調整
   - 他のNeural2音声の試用（ja-JP-Neural2-C, ja-JP-Neural2-Dなど）

### **優先度: 低**

5. **コスト監視**
   - Google Cloud Consoleでコスト確認
   - 月あたりの使用量を監視

6. **最終的なセッション39レポート完成**
   - Google Cloud TTS動作確認結果を追記
   - 音声品質改善の成果を記録

---

## 🎉 **セッション39の成果**

### **実装完了**
- ✅ OpenAI TTS-1-HDからGoogle Cloud Text-to-Speechへの完全移行
- ✅ Google Cloudプロジェクトとサービスアカウント設定
- ✅ requirements.txtにライブラリ追加
- ✅ TTS生成関数の全面書き換え
- ✅ Railway環境変数設定
- ✅ JSONパースエラーの修正
- ✅ デバッグログの追加

### **試行錯誤で学んだこと**
- ❌ 読点後のスペース追加 → 英語誤認識（削除）
- ❌ 100単語のひらがな変換 → 英語誤認識（削除）
- ✅ 最小限のひらがな変換（3単語のみ）→ バランス改善
- ✅ Google Cloud TTSへの移行 → 根本的解決

### **期待される効果**
- ✅ ChatGPTレベルの自然な日本語音声
- ✅ 誤読の解消
- ✅ 英語混在の解消
- ✅ ロープレに耐えうる自然な会話

---

## 📊 **統計**

- **修正ファイル数**: 3ファイル
  - requirements.txt
  - .env.example
  - blueprints/conversations.py
- **追加行数**: 約60行
- **削除行数**: 約130行（過度なひらがな変換辞書を削除）
- **コミット数**: 9件
- **作業時間**: 約2.5時間

---

## 📌 **重要な決定事項**

1. **TTS APIの選択**: Google Cloud Text-to-Speech（ja-JP-Neural2-B）
2. **ひらがな変換**: 最小限（3単語のみ：今日、明日、昨日）
3. **認証方法**: 環境変数からJSON取得 → 一時ファイル経由で認証
4. **デバッグログ**: print(flush=True)を使用（Railway本番確認用）

---

## 🔄 **現在の状態**

### **ローカル環境**
- ✅ 全修正完了
- ✅ GitHubにプッシュ済み

### **Railway本番環境**
- 🔄 デプロイ中（コミット `6670f42`）
- ⏳ Google Cloud TTS動作確認待ち
- ⏳ JSONパースエラー解消確認待ち
- ⏳ 音声品質確認待ち

---

## 🚨 **未解決の問題**

### **Railway本番環境の確認待ち**

**現状**:
- 最新コード（`6670f42`）がデプロイ中
- JSONパースエラーの修正が反映されるか確認待ち
- Google Cloud TTSの音声品質が期待通りか確認待ち

**次回セッションで確認すべきこと**:
1. Railwayログで `JSONDecodeError` が出ないか
2. TTS生成が成功しているか
3. AI音声が自然な日本語になっているか
4. 誤読や英語混在が解消されているか

---

**2026年1月12日時点でのプロジェクトは、OpenAI TTS-1-HDからGoogle Cloud Text-to-Speechへの完全移行を実装済み。Railway本番環境での動作確認待ちです！** ✨

**次のセッションでGoogle Cloud TTSの音声品質を確認し、ロープレに耐えうる自然な日本語会話が実現できているか検証します！** 🚀
