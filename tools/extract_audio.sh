#!/bin/bash
# 動画から音声を抽出して圧縮するスクリプト

INPUT_VIDEO="$1"
OUTPUT_AUDIO="${INPUT_VIDEO%.*}_audio.wav"

if [ -z "$INPUT_VIDEO" ]; then
    echo "使用方法: ./extract_audio.sh <動画ファイル>"
    exit 1
fi

if [ ! -f "$INPUT_VIDEO" ]; then
    echo "エラー: ファイルが見つかりません: $INPUT_VIDEO"
    exit 1
fi

echo "音声抽出中: $INPUT_VIDEO → $OUTPUT_AUDIO"
ffmpeg -i "$INPUT_VIDEO" -ar 16000 -ac 1 -y "$OUTPUT_AUDIO"

# ファイルサイズ確認
SIZE=$(stat -f%z "$OUTPUT_AUDIO" 2>/dev/null || stat -c%s "$OUTPUT_AUDIO" 2>/dev/null)
SIZE_MB=$(echo "scale=2; $SIZE / 1024 / 1024" | bc)

echo "完了: $OUTPUT_AUDIO (${SIZE_MB}MB)"

if (( $(echo "$SIZE > 25000000" | bc -l) )); then
    echo "警告: ファイルサイズが25MBを超えています。さらに圧縮します..."
    ffmpeg -i "$OUTPUT_AUDIO" -ar 16000 -ac 1 -acodec pcm_s16le -y "${OUTPUT_AUDIO%.wav}_compressed.wav"
    mv "${OUTPUT_AUDIO%.wav}_compressed.wav" "$OUTPUT_AUDIO"
    SIZE=$(stat -f%z "$OUTPUT_AUDIO" 2>/dev/null || stat -c%s "$OUTPUT_AUDIO" 2>/dev/null)
    SIZE_MB=$(echo "scale=2; $SIZE / 1024 / 1024" | bc)
    echo "圧縮後: ${SIZE_MB}MB"
fi



