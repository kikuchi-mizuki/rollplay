#!/usr/bin/env python3
"""
文字起こしデータをRAGデータベースに追加するスクリプト
"""
import os
import sys
import json
import numpy as np
from openai import OpenAI

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    print("❌ Error: faiss-cpu not installed. Run: pip install faiss-cpu")
    sys.exit(1)

# OpenAI APIキーを環境変数から取得
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    print("❌ Error: OPENAI_API_KEY environment variable not set")
    sys.exit(1)

client = OpenAI(api_key=api_key)

# RAGインデックスのパス
RAG_INDEX_DIR = "rag_index"
RAG_INDEX_PATH = os.path.join(RAG_INDEX_DIR, 'sales_patterns.faiss')
RAG_METADATA_PATH = os.path.join(RAG_INDEX_DIR, 'sales_patterns.json')

def load_transcript(transcript_path: str) -> dict:
    """文字起こしJSONを読み込む"""
    with open(transcript_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def extract_scenario_id(filename: str) -> str:
    """
    ファイル名からシナリオIDを抽出

    Args:
        filename: ファイル名（例: meeting_1st_001_compressed.mp3）

    Returns:
        シナリオID（例: meeting_1st）
    """
    import re

    # meeting_1st, meeting_1_5th, meeting_2nd, meeting_3rd, kickoff_meeting, upsell などを抽出
    patterns = [
        r'(meeting_1st)',
        r'(meeting_1_5th)',
        r'(meeting_2nd)',
        r'(meeting_3rd)',
        r'(kickoff_meeting)',
        r'(upsell)',
    ]

    for pattern in patterns:
        match = re.search(pattern, filename)
        if match:
            return match.group(1)

    # デフォルト: ファイル名の最初の部分を使用
    return filename.split('_')[0]

def create_chunks(transcript: dict, chunk_size: int = 5) -> list:
    """
    会話をチャンク化する

    Args:
        transcript: 文字起こしデータ
        chunk_size: 1チャンクあたりのセグメント数

    Returns:
        チャンクのリスト
    """
    chunks = []
    segments = transcript['segments']

    # ファイル名からシナリオIDを抽出
    scenario_id = extract_scenario_id(transcript['source_file'])

    for i in range(0, len(segments), chunk_size):
        chunk_segments = segments[i:i + chunk_size]

        # チャンクのテキストを結合
        chunk_text = "\n".join([
            f"{seg['speaker']}: {seg['text']}"
            for seg in chunk_segments
        ])

        # チャンクの話者タイプを判定（最初のセグメント基準）
        speaker_type = chunk_segments[0]['speaker_type']

        chunks.append({
            "text": chunk_text,
            "speaker_type": speaker_type,
            "scenario_id": scenario_id,  # シナリオIDを追加
            "source_file": transcript['source_file'],
            "start_time": chunk_segments[0]['start'],
            "end_time": chunk_segments[-1]['end'],
            "segment_count": len(chunk_segments)
        })

    return chunks

def generate_embeddings(texts: list) -> np.ndarray:
    """
    OpenAI Embedding APIでベクトルを生成

    Args:
        texts: テキストのリスト

    Returns:
        Embeddingベクトルの配列
    """
    print(f"🔢 Embedding生成中: {len(texts)}個のチャンク")

    embeddings = []
    batch_size = 100  # OpenAI APIのレート制限対策

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        print(f"  バッチ {i//batch_size + 1}/{(len(texts)-1)//batch_size + 1}")

        response = client.embeddings.create(
            model="text-embedding-3-large",
            input=batch
        )

        batch_embeddings = [item.embedding for item in response.data]
        embeddings.extend(batch_embeddings)

    print(f"✅ Embedding生成完了")
    return np.array(embeddings, dtype='float32')

def load_or_create_index(dimension: int = 3072):
    """既存のFAISSインデックスを読み込むか、新規作成"""
    os.makedirs(RAG_INDEX_DIR, exist_ok=True)

    if os.path.exists(RAG_INDEX_PATH) and os.path.exists(RAG_METADATA_PATH):
        print(f"📂 既存のRAGインデックスを読み込み: {RAG_INDEX_PATH}")
        index = faiss.read_index(RAG_INDEX_PATH)

        with open(RAG_METADATA_PATH, 'r', encoding='utf-8') as f:
            metadata = json.load(f)

        print(f"   既存データ数: {len(metadata)}件")
        return index, metadata
    else:
        print(f"🆕 新規FAISSインデックスを作成")
        index = faiss.IndexFlatL2(dimension)
        metadata = []
        return index, metadata

def add_to_rag(transcript_path: str):
    """
    文字起こしデータをRAGに追加

    Args:
        transcript_path: 文字起こしJSONファイルのパス
    """
    print("="*60)
    print("📚 RAGデータベースに追加")
    print("="*60)

    # 1. 文字起こしデータを読み込み
    print(f"📄 文字起こしデータを読み込み: {transcript_path}")
    transcript = load_transcript(transcript_path)

    # 2. チャンク化
    print(f"✂️  チャンク化中...")
    chunks = create_chunks(transcript, chunk_size=5)
    print(f"✅ {len(chunks)}個のチャンクを生成")

    # 3. Embedding生成
    texts = [chunk['text'] for chunk in chunks]
    embeddings = generate_embeddings(texts)

    # 4. 既存のインデックスを読み込み
    index, metadata = load_or_create_index(dimension=embeddings.shape[1])

    # 5. 新しいデータを追加
    print(f"📥 FAISSインデックスに追加中...")
    index.add(embeddings)
    metadata.extend(chunks)

    print(f"✅ 追加完了: {len(chunks)}件")
    print(f"   総データ数: {len(metadata)}件")

    # 6. 保存
    print(f"💾 RAGインデックスを保存中...")
    faiss.write_index(index, RAG_INDEX_PATH)

    with open(RAG_METADATA_PATH, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"✅ 保存完了")
    print("="*60)

    # 統計情報を表示
    print("\n📊 RAGデータベース統計")
    print("="*60)
    print(f"総データ数: {len(metadata)}件")
    print(f"インデックスサイズ: {index.ntotal}件")
    print(f"ベクトル次元: {embeddings.shape[1]}")

    # ソース別の集計
    sources = {}
    for item in metadata:
        source = item.get('source', item.get('source_file', 'unknown'))
        sources[source] = sources.get(source, 0) + 1

    print(f"\nソース別データ数:")
    for source, count in sources.items():
        print(f"  - {source}: {count}件")
    print("="*60)

def main():
    if len(sys.argv) < 2:
        print("Usage: python add_to_rag.py <transcript_json_path>")
        sys.exit(1)

    transcript_path = sys.argv[1]

    if not os.path.exists(transcript_path):
        print(f"❌ Error: File not found: {transcript_path}")
        sys.exit(1)

    add_to_rag(transcript_path)

if __name__ == "__main__":
    main()
