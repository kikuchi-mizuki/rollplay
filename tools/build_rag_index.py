#!/usr/bin/env python3
"""
RAGインデックス構築ツール

使い方:
    python tools/build_rag_index.py

機能:
- transcripts/から文字起こしデータ読み込み
- 顧客発言を抽出
- シーン判定（挨拶/ヒアリング/提案/クロージング）
- Embedding生成（OpenAI text-embedding-3-large）
- FAISSインデックス構築
"""

import os
import sys
import json
from pathlib import Path
from typing import List, Dict
import numpy as np
import faiss
from openai import OpenAI
from dotenv import load_dotenv

# 環境変数読み込み
load_dotenv()

# OpenAI クライアント初期化
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

# ディレクトリ設定
BASE_DIR = Path(__file__).parent.parent
TRANSCRIPTS_DIR = BASE_DIR / 'transcripts'
RAG_INDEX_DIR = BASE_DIR / 'rag_index'
RAG_INDEX_DIR.mkdir(exist_ok=True)


def detect_scene(text: str, position: float) -> str:
    """
    発話内容とposition（会話全体の何%の位置か）からシーンを判定

    Args:
        text: 発話内容
        position: 0.0-1.0の位置（0=最初、1=最後）

    Returns:
        シーン名
    """
    # 挨拶（最初の10%）
    if position < 0.1:
        return 'greeting'

    # クロージング（最後の20%）
    if position > 0.8:
        return 'closing'

    # キーワードベースの判定
    if any(kw in text for kw in ['はじめまして', 'よろしく', 'ご紹介', 'お名前']):
        return 'greeting'

    if any(kw in text for kw in ['ありがとう', 'それでは', 'よろしくお願い', '今後']):
        return 'closing'

    if any(kw in text for kw in ['提案', 'プラン', 'サービス', 'こちら', '例えば', 'ご覧']):
        return 'proposal'

    # デフォルトはニーズ分析
    return 'needs_analysis'


def extract_topics(text: str) -> List[str]:
    """
    発話内容からトピックを抽出

    Args:
        text: 発話内容

    Returns:
        トピックのリスト
    """
    topics = []

    # トピック辞書
    topic_keywords = {
        'budget': ['予算', '費用', '価格', '金額', 'コスト'],
        'timeline': ['期間', 'いつ', 'スケジュール', '納期', '時間'],
        'examples': ['事例', '実績', '他社', '例', 'ケース'],
        'features': ['機能', 'サービス', 'プラン', 'できる', 'できます'],
        'concerns': ['不安', '心配', '懸念', '悩み', '困って'],
        'social_media': ['SNS', 'インスタ', 'TikTok', 'Twitter', 'Facebook'],
        'video': ['動画', 'ビデオ', '映像', 'コンテンツ'],
        'results': ['効果', '成果', '実績', '数字', '反応'],
    }

    for topic, keywords in topic_keywords.items():
        if any(kw in text for kw in keywords):
            topics.append(topic)

    return topics if topics else ['general']


def generate_embedding(text: str) -> List[float]:
    """
    テキストのEmbeddingを生成

    Args:
        text: テキスト

    Returns:
        Embeddingベクトル
    """
    try:
        response = client.embeddings.create(
            model="text-embedding-3-large",
            input=text
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"❌ Embedding生成エラー: {e}")
        return None


def detect_scenario_from_filename(filename: str) -> str:
    """
    ファイル名からシナリオIDを判定

    命名規則:
    - meeting_1st_XXX.* → meeting_1st
    - meeting_1_5th_XXX.* → meeting_1_5th
    - meeting_2nd_XXX.* → meeting_2nd
    - meeting_3rd_XXX.* → meeting_3rd
    - kickoff_XXX.* → kickoff_meeting
    - upsell_XXX.* → upsell
    - その他 → unknown

    Args:
        filename: ファイル名

    Returns:
        シナリオID
    """
    filename_lower = filename.lower()

    # シナリオパターンマッチング
    scenario_patterns = {
        'meeting_1st': ['meeting_1st', '1次面談', '1st_meeting', 'first_meeting'],
        'meeting_1_5th': ['meeting_1_5th', '1.5次面談', '1_5th_meeting'],
        'meeting_2nd': ['meeting_2nd', '2次面談', '2nd_meeting', 'second_meeting'],
        'meeting_3rd': ['meeting_3rd', '3次面談', '3rd_meeting', 'third_meeting'],
        'kickoff_meeting': ['kickoff', 'キックオフ', 'kick_off'],
        'upsell': ['upsell', '追加営業', 'additional_sales', 'cross_sell'],
    }

    for scenario_id, patterns in scenario_patterns.items():
        if any(pattern in filename_lower for pattern in patterns):
            return scenario_id

    # パターンが見つからない場合は unknown
    return 'unknown'


def process_transcript(transcript_path: Path) -> List[Dict]:
    """
    文字起こしファイルからRAGデータを抽出

    Args:
        transcript_path: 文字起こしJSONのパス

    Returns:
        RAGデータのリスト
    """
    print(f"\n📄 処理中: {transcript_path.name}")

    with open(transcript_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # ファイル名からシナリオIDを判定
    source_file = data.get('source_file', transcript_path.stem)
    scenario_id = detect_scenario_from_filename(source_file)
    print(f"   シナリオID: {scenario_id}")

    segments = data.get('segments', [])
    total_segments = len(segments)

    print(f"   総セグメント数: {total_segments}")

    # 顧客発言のみ抽出
    rag_data = []
    customer_segments = [s for s in segments if s.get('speaker_type') == 'customer']

    print(f"   顧客発言: {len(customer_segments)}件")

    for i, seg in enumerate(customer_segments):
        text = seg.get('text', '').strip()
        if not text or len(text) < 5:  # 短すぎる発言はスキップ
            continue

        # シーン判定
        position = i / len(customer_segments) if customer_segments else 0
        scene = detect_scene(text, position)

        # トピック抽出
        topics = extract_topics(text)

        rag_data.append({
            'type': 'customer_response',
            'text': text,
            'scene': scene,
            'topics': topics,
            'scenario_id': scenario_id,  # ファイル名から判定したシナリオID
            'source_file': data.get('source_file'),
        })

    print(f"✅ {len(rag_data)}件のRAGデータを抽出")

    return rag_data


def build_faiss_index(rag_data: List[Dict]) -> tuple:
    """
    FAISSインデックスを構築

    Args:
        rag_data: RAGデータのリスト

    Returns:
        (index, metadata)
    """
    print(f"\n🔧 FAISSインデックス構築中...")
    print(f"   データ件数: {len(rag_data)}")

    # Embedding生成
    embeddings = []
    metadata = []

    for i, item in enumerate(rag_data):
        if (i + 1) % 10 == 0:
            print(f"   進捗: {i + 1}/{len(rag_data)}")

        embedding = generate_embedding(item['text'])
        if embedding:
            embeddings.append(embedding)
            metadata.append(item)

    print(f"✅ {len(embeddings)}件のEmbeddingを生成")

    # FAISSインデックス作成
    if not embeddings:
        print("❌ エラー: Embeddingが生成されませんでした")
        return None, []

    dimension = len(embeddings[0])
    embeddings_array = np.array(embeddings).astype('float32')

    # IndexFlatL2: L2距離で検索（正確だが遅い、小規模データ向け）
    index = faiss.IndexFlatL2(dimension)
    index.add(embeddings_array)

    print(f"✅ FAISSインデックス構築完了")
    print(f"   次元数: {dimension}")
    print(f"   インデックス件数: {index.ntotal}")

    return index, metadata


def main():
    """メイン処理"""
    print(f"""
{'='*60}
RAGインデックス構築ツール
{'='*60}
入力ディレクトリ: {TRANSCRIPTS_DIR}
出力ディレクトリ: {RAG_INDEX_DIR}
{'='*60}
    """)

    # OpenAI APIキーの確認
    if not os.getenv('OPENAI_API_KEY'):
        print("❌ エラー: OPENAI_API_KEYが設定されていません")
        sys.exit(1)

    # 文字起こしファイルを検索
    transcript_files = list(TRANSCRIPTS_DIR.glob('*_transcript.json'))

    if not transcript_files:
        print(f"⚠️  {TRANSCRIPTS_DIR} に文字起こしファイルが見つかりませんでした")
        print("   先に transcribe_videos.py を実行してください")
        sys.exit(0)

    print(f"📁 {len(transcript_files)}件の文字起こしファイルを検出\n")

    # RAGデータ抽出
    all_rag_data = []
    for tf in transcript_files:
        rag_data = process_transcript(tf)
        all_rag_data.extend(rag_data)

    if not all_rag_data:
        print("❌ RAGデータが抽出できませんでした")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"総RAGデータ件数: {len(all_rag_data)}")
    print(f"{'='*60}")

    # シナリオ別集計
    from collections import Counter
    scenario_counts = Counter(item['scenario_id'] for item in all_rag_data)
    print("\n📊 シナリオ別件数:")
    for scenario, count in scenario_counts.items():
        print(f"   {scenario}: {count}件")

    # シーン別集計
    scene_counts = Counter(item['scene'] for item in all_rag_data)
    print("\n📊 シーン別件数:")
    for scene, count in scene_counts.items():
        print(f"   {scene}: {count}件")

    # FAISSインデックス構築
    index, metadata = build_faiss_index(all_rag_data)

    if not index:
        sys.exit(1)

    # 保存
    index_path = RAG_INDEX_DIR / 'sales_patterns.faiss'
    metadata_path = RAG_INDEX_DIR / 'sales_patterns.json'

    faiss.write_index(index, str(index_path))
    print(f"💾 インデックス保存: {index_path}")

    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    print(f"💾 メタデータ保存: {metadata_path}")

    print(f"\n{'='*60}")
    print(f"✅ RAGインデックス構築完了！")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
