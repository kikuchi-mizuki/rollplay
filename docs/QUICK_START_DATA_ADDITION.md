# 🚀 RAGデータ追加 - クイックスタート

所要時間: **20-30分**（動画5本の場合）

---

## ⚡ 3ステップで完了

### ステップ1: 動画を配置（2分）

```bash
# 動画をtranscriptsディレクトリにコピー
cd /Users/kikuchimizuki/Desktop/04_池田さん_ロープレ/rollplay

# 例: デスクトップから5本コピー
cp ~/Desktop/meeting_1st_*.mp4 transcripts/
```

**ファイル名の例**:
```
meeting_1st_005_budget_concern.mp4
meeting_1st_006_question_heavy.mp4
meeting_2nd_003_cautious.mp4
upsell_003_fast_decision.mp4
kickoff_002_detailed_question.mp4
```

### ステップ2: 文字起こし実行（10-20分）

```bash
# 文字起こし実行
python tools/transcribe_videos.py
```

**待機中に表示される内容**:
```
処理中: meeting_1st_005_budget_concern.mp4
Whisper API呼び出し中...
✅ 文字起こし完了: meeting_1st_005_transcript.json
```

### ステップ3: RAGインデックス再構築（5-10分）

```bash
# RAGインデックス構築
python tools/build_rag_index.py
```

**完了時の表示**:
```
✅ RAGインデックス構築完了！
総RAGデータ件数: 1247
meeting_1st: 450件
upsell: 280件
...
```

---

## 🎯 動作確認

### バックエンド再起動

```bash
# Ctrl+C で既存プロセス停止
python3 app.py 5001
```

起動ログで確認：
```
RAGインデックス読込完了: 1247件のパターン  ← 件数が増えていればOK✅
```

### ブラウザリロード

`Cmd+Shift+R` でハードリロード

### 会話で確認

営業「予算はどのくらいですか？」

**Before（898件）**:
```
顧客: 「そうですね、月3-5万円くらいです」
```

**After（1,247件）**:
```
顧客: 「えーと...正直、そこまで予算がなくて。
       月3-5万円くらいを考えてるんですけど...
       効果次第ではもうちょっと検討できるかなって」
```

→ **より自然でリアルな応答！**

---

## 💡 推奨する最初の5-10本

1. **予算交渉が難航した面談** × 2本
2. **質問が多かった面談** × 2本
3. **即決した面談** × 1本
4. **検討期間が長かった面談** × 2本
5. **異なる業種の面談** × 2-3本

→ **合計: 約+400-600件** のパターンが追加されます

---

## 📊 効果の目安

| 追加動画数 | データ件数 | 精度向上 | 費用 |
|-----------|-----------|---------|------|
| 5本 | +400件 | +15-20% | $3-5 |
| 10本 | +700件 | +25-35% | $6-10 |
| 20本 | +1400件 | +35-45% | $12-18 |

---

## ⚠️ トラブルシューティング

### エラー: "OpenAI API key not found"

```bash
# .envファイルを確認
cat .env | grep OPENAI_API_KEY

# なければ追加
echo "OPENAI_API_KEY=sk-..." >> .env
```

### エラー: "No audio files found"

```bash
# transcriptsディレクトリを確認
ls transcripts/*.mp4

# ファイルがなければコピー
cp ~/Downloads/*.mp4 transcripts/
```

### 処理が止まったように見える

→ **正常です！** Embedding生成は時間がかかります（5-15分待ってください）

---

## 次のステップ

✅ データ追加完了後:
1. 会話の質を確認
2. さらに5-10本追加（合計20本目標）
3. フィードバックを元に動画を選定

詳細は `DATA_ADDITION_GUIDE.md` を参照してください。
