#!/usr/bin/env python3
"""
音声ファイルの文字起こしツール（大容量ファイル対応版）

使い方:
    python tools/transcribe_videos_chunked.py

機能:
- videos/内の音声/動画ファイルを自動検出
- 25MB超のファイルを自動分割
- Whisper APIで文字起こし
- 話者分離（営業・顧客）の推定
- transcripts/にJSON形式で保存
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime
from openai import OpenAI
from dotenv import load_dotenv
from pydub import AudioSegment

# 環境変数読み込み
load_dotenv()

# OpenAI クライアント初期化
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

# ディレクトリ設定
BASE_DIR = Path(__file__).parent.parent
VIDEOS_DIR = BASE_DIR / 'videos'
TRANSCRIPTS_DIR = BASE_DIR / 'transcripts'
TEMP_DIR = BASE_DIR / 'temp_chunks'
TRANSCRIPTS_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

# 対応する音声/動画形式
SUPPORTED_FORMATS = ['.mp3', '.mp4', '.wav', '.m4a', '.webm', '.mpeg', '.mpga']

# Whisper API制限
MAX_FILE_SIZE_MB = 24  # 25MBではなく24MBで安全マージン
CHUNK_DURATION_MS = 10 * 60 * 1000  # 10分チャンク


def split_audio(file_path: Path, chunk_duration_ms: int = CHUNK_DURATION_MS) -> list:
    """
    音声ファイルを分割

    Args:
        file_path: 音声ファイルのパス
        chunk_duration_ms: チャンクの長さ（ミリ秒）

    Returns:
        分割されたファイルのパスのリスト
    """
    print(f"🔪 音声ファイルを分割中...")

    # 音声ファイルを読み込み
    audio = AudioSegment.from_file(file_path)
    total_duration_ms = len(audio)

    print(f"   総時間: {total_duration_ms / 1000 / 60:.2f}分")

    # チャンクに分割
    chunks = []
    chunk_files = []

    for i, start_ms in enumerate(range(0, total_duration_ms, chunk_duration_ms)):
        end_ms = min(start_ms + chunk_duration_ms, total_duration_ms)
        chunk = audio[start_ms:end_ms]

        # 一時ファイルに保存
        chunk_filename = TEMP_DIR / f"{file_path.stem}_chunk_{i:03d}.mp3"
        chunk.export(chunk_filename, format="mp3", bitrate="64k")

        # ファイルが確実に書き込まれるまで待つ
        import time
        time.sleep(0.5)

        if not chunk_filename.exists():
            print(f"❌ チャンク{i+1}の作成に失敗しました")
            continue

        chunk_size_mb = chunk_filename.stat().st_size / (1024 * 1024)
        print(f"   チャンク {i+1}: {chunk_size_mb:.2f}MB ({start_ms/1000:.1f}s - {end_ms/1000:.1f}s)")

        chunk_files.append((chunk_filename, start_ms, end_ms))

    return chunk_files


def transcribe_audio_chunk(file_path: Path, start_ms: int = 0) -> dict:
    """
    音声チャンクを文字起こし

    Args:
        file_path: 音声ファイルのパス
        start_ms: チャンクの開始時間（ミリ秒）

    Returns:
        文字起こし結果（dict）
    """
    try:
        # Whisper APIで文字起こし
        with open(file_path, 'rb') as audio_file:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json",
                language="ja"
            )

        # セグメントのタイムスタンプを調整
        segments = []
        if hasattr(transcript, 'segments'):
            for seg in transcript.segments:
                segments.append({
                    'text': seg.text,
                    'start': seg.start + (start_ms / 1000),
                    'end': seg.end + (start_ms / 1000),
                })

        return {
            'text': transcript.text,
            'duration': transcript.duration if hasattr(transcript, 'duration') else None,
            'language': transcript.language if hasattr(transcript, 'language') else 'ja',
            'segments': segments,
        }

    except Exception as e:
        print(f"❌ エラー: {e}")
        return None


def transcribe_large_audio(file_path: Path) -> dict:
    """
    大容量音声ファイルを分割して文字起こし

    Args:
        file_path: 音声ファイルのパス

    Returns:
        文字起こし結果（dict）
    """
    print(f"📝 文字起こし開始: {file_path.name}")

    file_size_mb = file_path.stat().st_size / (1024 * 1024)
    print(f"   ファイルサイズ: {file_size_mb:.2f}MB")

    # ファイルサイズチェック
    if file_size_mb <= MAX_FILE_SIZE_MB:
        # 25MB以下の場合は直接処理
        print(f"   直接処理します")
        return transcribe_audio_chunk(file_path, 0)

    # 25MB超の場合は分割処理
    print(f"   ファイルサイズが{MAX_FILE_SIZE_MB}MBを超えているため、分割処理します")

    chunk_files = split_audio(file_path)
    print(f"✅ {len(chunk_files)}個のチャンクに分割完了")

    # 各チャンクを文字起こし
    all_text = []
    all_segments = []
    total_duration = 0

    for i, (chunk_file, start_ms, end_ms) in enumerate(chunk_files):
        print(f"\n📝 チャンク {i+1}/{len(chunk_files)} を文字起こし中...")

        chunk_result = transcribe_audio_chunk(chunk_file, start_ms)

        if chunk_result:
            all_text.append(chunk_result['text'])
            if chunk_result.get('segments'):
                all_segments.extend(chunk_result['segments'])
            if chunk_result.get('duration'):
                total_duration += chunk_result['duration']

            print(f"✅ チャンク {i+1} 完了: {len(chunk_result['text'])}文字")

        # 一時ファイルを削除
        chunk_file.unlink()

    # 統合結果
    print(f"\n✅ 全チャンク文字起こし完了")
    print(f"   総文字数: {sum(len(t) for t in all_text)}文字")

    return {
        'text': '\n'.join(all_text),
        'duration': total_duration,
        'language': 'ja',
        'segments': all_segments,
    }


def detect_speaker(text: str, previous_speaker: str = None) -> str:
    """
    発話内容から話者を推定（簡易版）

    Args:
        text: 発話内容
        previous_speaker: 前の話者

    Returns:
        'sales' または 'customer'
    """
    # 営業の特徴的なフレーズ
    sales_patterns = [
        'ご提案', 'お手伝い', 'サービス', 'プラン', 'お見積',
        'ご説明', 'ご案内', 'お伺い', 'ご質問', 'ご確認',
        'させていただ', 'いかがでしょ', 'よろしければ'
    ]

    # 顧客の特徴的なフレーズ
    customer_patterns = [
        '検討', '予算', '費用', '悩み', '困って', '考えて',
        '他社', '比較', 'どうなん', '分からない', 'ですね',
        'そうですか', 'なるほど'
    ]

    sales_score = sum(1 for pattern in sales_patterns if pattern in text)
    customer_score = sum(1 for pattern in customer_patterns if pattern in text)

    if sales_score > customer_score:
        return 'sales'
    elif customer_score > sales_score:
        return 'customer'
    else:
        # スコアが同じ場合は前の話者と交互に
        return 'customer' if previous_speaker == 'sales' else 'sales'


def segment_conversation(transcript_data: dict) -> list:
    """
    文字起こし結果を会話セグメントに分割

    Args:
        transcript_data: Whisper APIの結果

    Returns:
        会話セグメントのリスト
    """
    segments = []
    previous_speaker = None

    # セグメント情報がある場合
    if transcript_data.get('segments'):
        for seg in transcript_data['segments']:
            text = seg.get('text', '').strip()
            if not text:
                continue

            speaker = detect_speaker(text, previous_speaker)
            previous_speaker = speaker

            segments.append({
                'speaker': '営業' if speaker == 'sales' else '顧客',
                'speaker_type': speaker,
                'text': text,
                'start': seg.get('start'),
                'end': seg.get('end'),
            })
    else:
        # セグメント情報がない場合は全文を分割
        text = transcript_data.get('text', '')
        sentences = text.split('。')

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            speaker = detect_speaker(sentence, previous_speaker)
            previous_speaker = speaker

            segments.append({
                'speaker': '営業' if speaker == 'sales' else '顧客',
                'speaker_type': speaker,
                'text': sentence + '。',
            })

    return segments


def process_video_file(video_path: Path) -> bool:
    """
    動画/音声ファイルを処理

    Args:
        video_path: ファイルパス

    Returns:
        成功したかどうか
    """
    print(f"\n{'='*60}")
    print(f"処理開始: {video_path.name}")
    print(f"{'='*60}")

    # 出力ファイル名
    output_filename = video_path.stem + '_transcript.json'
    output_path = TRANSCRIPTS_DIR / output_filename

    # 既に処理済みの場合はスキップ
    if output_path.exists():
        print(f"⏭️  スキップ: 既に文字起こし済みです")
        print(f"   出力ファイル: {output_path}")
        return True

    # 文字起こし
    transcript_data = transcribe_large_audio(video_path)
    if not transcript_data:
        return False

    # 会話セグメント化
    print(f"🔍 会話セグメント化中...")
    segments = segment_conversation(transcript_data)
    print(f"✅ {len(segments)}個のセグメントに分割")

    # 統計情報
    sales_count = sum(1 for s in segments if s['speaker_type'] == 'sales')
    customer_count = sum(1 for s in segments if s['speaker_type'] == 'customer')
    print(f"   営業発言: {sales_count}件")
    print(f"   顧客発言: {customer_count}件")

    # 結果を保存
    result = {
        'source_file': video_path.name,
        'processed_at': datetime.now().isoformat(),
        'duration': transcript_data.get('duration'),
        'language': transcript_data.get('language'),
        'full_text': transcript_data.get('text'),
        'segments': segments,
        'stats': {
            'total_segments': len(segments),
            'sales_segments': sales_count,
            'customer_segments': customer_count,
        }
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"💾 保存完了: {output_path}")
    return True


def main():
    """メイン処理"""
    print(f"""
{'='*60}
音声文字起こしツール - Whisper API（大容量ファイル対応）
{'='*60}
対応形式: {', '.join(SUPPORTED_FORMATS)}
入力ディレクトリ: {VIDEOS_DIR}
出力ディレクトリ: {TRANSCRIPTS_DIR}
最大ファイルサイズ: {MAX_FILE_SIZE_MB}MB（超える場合は自動分割）
{'='*60}
    """)

    # OpenAI APIキーの確認
    if not os.getenv('OPENAI_API_KEY'):
        print("❌ エラー: OPENAI_API_KEYが設定されていません")
        print("   .envファイルに設定してください")
        sys.exit(1)

    # 動画/音声ファイルを検索
    video_files = []
    for ext in SUPPORTED_FORMATS:
        video_files.extend(VIDEOS_DIR.glob(f'*{ext}'))

    if not video_files:
        print(f"⚠️  {VIDEOS_DIR} に音声/動画ファイルが見つかりませんでした")
        sys.exit(0)

    print(f"📁 {len(video_files)}件のファイルを検出しました:\n")
    for i, vf in enumerate(video_files, 1):
        size_mb = vf.stat().st_size / (1024 * 1024)
        status = "要分割" if size_mb > MAX_FILE_SIZE_MB else "直接処理"
        print(f"   {i}. {vf.name} ({size_mb:.2f}MB) [{status}]")

    print()

    # 処理実行
    success_count = 0
    for video_file in video_files:
        try:
            if process_video_file(video_file):
                success_count += 1
        except Exception as e:
            print(f"❌ エラー: {video_file.name} - {e}")
            continue

    # 一時ディレクトリをクリーンアップ
    if TEMP_DIR.exists():
        for temp_file in TEMP_DIR.glob('*'):
            temp_file.unlink()

    # 結果サマリー
    print(f"\n{'='*60}")
    print(f"処理完了: {success_count}/{len(video_files)}件成功")
    print(f"{'='*60}\n")

    # 出力ファイル一覧
    transcripts = list(TRANSCRIPTS_DIR.glob('*.json'))
    if transcripts:
        print(f"📄 生成された文字起こしファイル: {len(transcripts)}件\n")


if __name__ == '__main__':
    main()
