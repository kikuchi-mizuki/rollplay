#!/usr/bin/env python3
"""
音声ファイルの文字起こしツール（Whisper API使用）

使い方:
    python tools/transcribe_videos.py

機能:
- videos/内の音声/動画ファイルを自動検出
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

# 環境変数読み込み
load_dotenv()

# OpenAI クライアント初期化
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

# ディレクトリ設定
BASE_DIR = Path(__file__).parent.parent
VIDEOS_DIR = BASE_DIR / 'videos'
TRANSCRIPTS_DIR = BASE_DIR / 'transcripts'
TRANSCRIPTS_DIR.mkdir(exist_ok=True)

# 対応する音声/動画形式
SUPPORTED_FORMATS = ['.mp3', '.mp4', '.wav', '.m4a', '.webm', '.mpeg', '.mpga']


def transcribe_audio(file_path: Path) -> dict:
    """
    Whisper APIで音声ファイルを文字起こし

    Args:
        file_path: 音声ファイルのパス

    Returns:
        文字起こし結果（dict）
    """
    print(f"📝 文字起こし開始: {file_path.name}")

    try:
        # ファイルサイズチェック（25MB制限）
        file_size_mb = file_path.stat().st_size / (1024 * 1024)
        print(f"   ファイルサイズ: {file_size_mb:.2f}MB")

        if file_size_mb > 25:
            print(f"⚠️  ファイルサイズが25MBを超えています。分割が必要です。")
            return None

        # Whisper APIで文字起こし
        with open(file_path, 'rb') as audio_file:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json",
                language="ja"
            )

        print(f"✅ 文字起こし完了: {len(transcript.text)}文字")

        return {
            'text': transcript.text,
            'duration': transcript.duration if hasattr(transcript, 'duration') else None,
            'language': transcript.language if hasattr(transcript, 'language') else 'ja',
            'segments': transcript.segments if hasattr(transcript, 'segments') else [],
        }

    except Exception as e:
        print(f"❌ エラー: {e}")
        return None


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
        'ご説明', 'ご案内', 'お伺い', 'ご質問', 'ご確認'
    ]

    # 顧客の特徴的なフレーズ
    customer_patterns = [
        '検討', '予算', '費用', '悩み', '困って', '考えて',
        '他社', '比較', 'どうなん', '分からない'
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
    transcript_data = transcribe_audio(video_path)
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
音声文字起こしツール - Whisper API
{'='*60}
対応形式: {', '.join(SUPPORTED_FORMATS)}
入力ディレクトリ: {VIDEOS_DIR}
出力ディレクトリ: {TRANSCRIPTS_DIR}
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
        print(f"   {i}. {vf.name} ({size_mb:.2f}MB)")

    print()

    # 処理実行
    success_count = 0
    for video_file in video_files:
        if process_video_file(video_file):
            success_count += 1

    # 結果サマリー
    print(f"\n{'='*60}")
    print(f"処理完了: {success_count}/{len(video_files)}件成功")
    print(f"{'='*60}\n")

    # 出力ファイル一覧
    transcripts = list(TRANSCRIPTS_DIR.glob('*.json'))
    if transcripts:
        print(f"📄 生成された文字起こしファイル:\n")
        for t in transcripts:
            print(f"   - {t.name}")


if __name__ == '__main__':
    main()
