#!/usr/bin/env python3
"""
音声ファイルを文字起こしするスクリプト
Whisper APIを使用して、話者分離付きで文字起こしを行う
"""
import os
import sys
import json
from datetime import datetime
from openai import OpenAI

# OpenAI APIキーを環境変数から取得
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    print("❌ Error: OPENAI_API_KEY environment variable not set")
    sys.exit(1)

client = OpenAI(api_key=api_key)

def transcribe_audio(audio_file_path: str, output_dir: str = "transcripts") -> dict:
    """
    音声ファイルを文字起こし

    Args:
        audio_file_path: 音声ファイルのパス
        output_dir: 出力ディレクトリ

    Returns:
        文字起こし結果の辞書
    """
    print(f"🎤 音声ファイルを文字起こし中: {audio_file_path}")

    # ファイル名を取得
    file_name = os.path.basename(audio_file_path)
    file_name_without_ext = os.path.splitext(file_name)[0]

    # 音声ファイルを開く
    with open(audio_file_path, 'rb') as audio_file:
        # Whisper APIで文字起こし（タイムスタンプ付き）
        print("📝 Whisper API実行中...")
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language="ja",
            response_format="verbose_json"
        )

    print(f"✅ 文字起こし完了: {len(transcript.text)}文字")

    # 結果を構造化
    result = {
        "source_file": file_name,
        "processed_at": datetime.now().isoformat(),
        "duration": transcript.duration,
        "language": transcript.language,
        "full_text": transcript.text,
        "segments": []
    }

    # セグメントを処理（話者を推定）
    print("👥 話者分離処理中...")
    segments = transcript.segments if hasattr(transcript, 'segments') else []

    for i, segment in enumerate(segments):
        # 簡易的な話者推定（交互に営業/顧客を割り当て）
        # より高度な話者分離にはpyannoteなどを使用
        speaker_type = "sales" if i % 2 == 0 else "customer"
        speaker = "営業" if speaker_type == "sales" else "顧客"

        # segmentがdictかobjectかを判定
        if isinstance(segment, dict):
            text = segment.get('text', '').strip()
            start = segment.get('start', 0)
            end = segment.get('end', 0)
        else:
            text = segment.text.strip()
            start = segment.start
            end = segment.end

        result["segments"].append({
            "speaker": speaker,
            "speaker_type": speaker_type,
            "text": text,
            "start": start,
            "end": end
        })

    print(f"✅ セグメント処理完了: {len(result['segments'])}個")

    # 出力ディレクトリを作成
    os.makedirs(output_dir, exist_ok=True)

    # JSONファイルとして保存
    output_path = os.path.join(output_dir, f"{file_name_without_ext}_transcript.json")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"💾 文字起こし結果を保存: {output_path}")

    return result

def main():
    if len(sys.argv) < 2:
        print("Usage: python transcribe_audio.py <audio_file_path>")
        sys.exit(1)

    audio_file_path = sys.argv[1]

    if not os.path.exists(audio_file_path):
        print(f"❌ Error: File not found: {audio_file_path}")
        sys.exit(1)

    # 文字起こし実行
    result = transcribe_audio(audio_file_path)

    print("\n" + "="*60)
    print("📊 文字起こし統計")
    print("="*60)
    print(f"ファイル: {result['source_file']}")
    print(f"時長: {result['duration']:.1f}秒")
    print(f"文字数: {len(result['full_text'])}文字")
    print(f"セグメント数: {len(result['segments'])}個")
    print("="*60)

if __name__ == "__main__":
    main()
