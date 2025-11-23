#!/usr/bin/env python3
"""
大きな音声ファイルを圧縮してから文字起こしするスクリプト
"""
import os
import sys
import subprocess
import tempfile
from transcribe_audio import transcribe_audio

def compress_audio(input_path: str, max_size_mb: float = 24.5) -> str:
    """
    音声ファイルを圧縮

    Args:
        input_path: 入力音声ファイルのパス
        max_size_mb: 目標サイズ（MB）

    Returns:
        圧縮後のファイルパス
    """
    # ファイルサイズを確認
    file_size_mb = os.path.getsize(input_path) / (1024 * 1024)
    print(f"📊 元のファイルサイズ: {file_size_mb:.2f} MB")

    if file_size_mb <= max_size_mb:
        print("✅ 圧縮不要です")
        return input_path

    # 一時ファイルを作成
    temp_file = tempfile.NamedTemporaryFile(suffix='.mp3', delete=False)
    temp_path = temp_file.name
    temp_file.close()

    # 圧縮率を計算（ビットレートを下げる）
    target_bitrate = int((max_size_mb / file_size_mb) * 128)  # 元が128kbpsと仮定
    target_bitrate = max(32, min(target_bitrate, 128))  # 32-128kbps

    print(f"🔧 ffmpegで圧縮中（目標ビットレート: {target_bitrate}kbps）...")

    # ffmpegで圧縮
    cmd = [
        'ffmpeg', '-i', input_path,
        '-ac', '1',  # モノラル化
        '-ar', '16000',  # サンプリングレート16kHz
        '-b:a', f'{target_bitrate}k',  # ビットレート
        '-y',  # 上書き
        temp_path
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        compressed_size_mb = os.path.getsize(temp_path) / (1024 * 1024)
        print(f"✅ 圧縮完了: {compressed_size_mb:.2f} MB ({file_size_mb/compressed_size_mb:.1f}x圧縮)")
        return temp_path
    except subprocess.CalledProcessError as e:
        print(f"❌ 圧縮エラー: {e.stderr}")
        raise
    except FileNotFoundError:
        print("❌ ffmpegがインストールされていません。brew install ffmpeg を実行してください")
        raise

def main():
    if len(sys.argv) < 2:
        print("Usage: python compress_and_transcribe.py <audio_file_path>")
        sys.exit(1)

    audio_file_path = sys.argv[1]

    if not os.path.exists(audio_file_path):
        print(f"❌ Error: File not found: {audio_file_path}")
        sys.exit(1)

    # 圧縮
    compressed_path = compress_audio(audio_file_path)

    try:
        # 文字起こし
        result = transcribe_audio(compressed_path)

        print("\n" + "="*60)
        print("📊 文字起こし統計")
        print("="*60)
        print(f"ファイル: {result['source_file']}")
        print(f"時長: {result['duration']:.1f}秒")
        print(f"文字数: {len(result['full_text'])}文字")
        print(f"セグメント数: {len(result['segments'])}個")
        print("="*60)
    finally:
        # 一時ファイルを削除
        if compressed_path != audio_file_path and os.path.exists(compressed_path):
            os.unlink(compressed_path)
            print(f"🗑️  一時ファイルを削除: {compressed_path}")

if __name__ == "__main__":
    main()
