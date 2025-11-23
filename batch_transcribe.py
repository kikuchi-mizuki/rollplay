#!/usr/bin/env python3
"""
複数の音声ファイルを一括で文字起こしするスクリプト
"""
import os
import sys
import time
from pathlib import Path
from compress_and_transcribe import compress_audio, transcribe_audio

def batch_transcribe(file_list_path: str, base_dir: str = ".."):
    """
    ファイルリストから音声ファイルを一括文字起こし

    Args:
        file_list_path: ファイルリストのパス
        base_dir: 音声ファイルのベースディレクトリ
    """
    # ファイルリストを読み込み
    with open(file_list_path, 'r', encoding='utf-8') as f:
        files = [line.strip() for line in f if line.strip() and not line.startswith('#')]

    total = len(files)
    print("="*70)
    print(f"📚 一括文字起こし開始: {total}本")
    print("="*70)

    successful = []
    failed = []
    skipped = []

    for i, relative_path in enumerate(files, 1):
        # フルパスを構築
        audio_path = os.path.join(base_dir, relative_path)

        # ファイル名を取得
        filename = os.path.basename(audio_path)
        filename_without_ext = os.path.splitext(filename)[0]

        # 既に文字起こし済みかチェック
        transcript_path = f"transcripts/{filename_without_ext}_transcript.json"
        if os.path.exists(transcript_path):
            print(f"\n[{i}/{total}] ⏭️  スキップ（既に処理済み）: {relative_path}")
            skipped.append(relative_path)
            continue

        print(f"\n{'='*70}")
        print(f"[{i}/{total}] 処理中: {relative_path}")
        print(f"{'='*70}")

        try:
            # ファイルの存在確認
            if not os.path.exists(audio_path):
                print(f"❌ ファイルが見つかりません: {audio_path}")
                failed.append((relative_path, "ファイルが見つかりません"))
                continue

            # 圧縮
            compressed_path = compress_audio(audio_path)

            # 文字起こし
            result = transcribe_audio(compressed_path, output_dir="transcripts")

            # 元のファイル名でリネーム
            temp_transcript = f"transcripts/{os.path.splitext(os.path.basename(compressed_path))[0]}_transcript.json"
            final_transcript = f"transcripts/{filename_without_ext}_transcript.json"

            if os.path.exists(temp_transcript) and temp_transcript != final_transcript:
                # source_fileを修正
                import json
                with open(temp_transcript, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                data['source_file'] = filename
                with open(final_transcript, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                os.remove(temp_transcript)

            # 一時ファイルを削除
            if compressed_path != audio_path and os.path.exists(compressed_path):
                os.unlink(compressed_path)

            print(f"✅ 完了: {filename}")
            successful.append(relative_path)

            # API レート制限対策（少し待機）
            if i < total:
                print("⏳ 次のファイル処理まで3秒待機...")
                time.sleep(3)

        except Exception as e:
            print(f"❌ エラー: {relative_path}")
            print(f"   {str(e)}")
            failed.append((relative_path, str(e)))
            continue

    # 結果サマリー
    print("\n" + "="*70)
    print("📊 一括文字起こし結果")
    print("="*70)
    print(f"✅ 成功: {len(successful)}本")
    print(f"⏭️  スキップ: {len(skipped)}本")
    print(f"❌ 失敗: {len(failed)}本")
    print(f"📝 総処理数: {total}本")
    print("="*70)

    if successful:
        print("\n✅ 成功したファイル:")
        for f in successful:
            print(f"  - {f}")

    if skipped:
        print("\n⏭️  スキップしたファイル:")
        for f in skipped:
            print(f"  - {f}")

    if failed:
        print("\n❌ 失敗したファイル:")
        for f, error in failed:
            print(f"  - {f}")
            print(f"    エラー: {error}")

    print("\n" + "="*70)

def main():
    if len(sys.argv) < 2:
        print("Usage: python batch_transcribe.py <file_list>")
        sys.exit(1)

    file_list = sys.argv[1]
    batch_transcribe(file_list)

if __name__ == "__main__":
    main()
