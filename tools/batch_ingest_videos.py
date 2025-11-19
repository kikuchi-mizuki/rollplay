#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
動画ファイルを一括取り込みしてシナリオJSONとRAGインデックスを生成するスクリプト
"""

import os
import sys
import json
import re
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional
import tiktoken

# プロジェクトルートをパスに追加
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
from openai import OpenAI
import faiss
import numpy as np

# pydubのインポート（オプション）
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False
    AudioSegment = None

# 環境変数を読み込み
load_dotenv()

# OpenAIクライアント初期化
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    print("エラー: OPENAI_API_KEYが設定されていません")
    sys.exit(1)

client = OpenAI(api_key=api_key)

# ディレクトリ設定
PROJECT_ROOT = Path(__file__).parent.parent
VIDEOS_DIR = PROJECT_ROOT / 'videos'
SCENARIOS_DIR = PROJECT_ROOT / 'scenarios'
RAG_INDEX_DIR = PROJECT_ROOT / 'rag_index'
INDEX_JSON_PATH = SCENARIOS_DIR / 'index.json'

# ディレクトリ作成
SCENARIOS_DIR.mkdir(exist_ok=True)
RAG_INDEX_DIR.mkdir(exist_ok=True)

# Tokenizer初期化（GPT-4o-mini用：cl100k_baseを使用）
try:
    encoding = tiktoken.encoding_for_model("gpt-4o-mini")
except KeyError:
    # tiktoken 0.5.2ではgpt-4o-miniが未対応のため、cl100k_baseを直接使用
    encoding = tiktoken.get_encoding("cl100k_base")
MAX_TOKENS_PER_CHUNK = 24000  # 安全マージンを考慮


def transcribe_video(video_path: Path) -> str:
    """Whisperで動画を文字起こし"""
    print(f"[文字起こし開始] {video_path.name}")
    
    # ファイルサイズチェック（Whisper APIは25MB制限）
    file_size = video_path.stat().st_size
    max_size = 25 * 1024 * 1024  # 25MB
    
    try:
        # まず直接送信を試行
        try:
            with open(video_path, 'rb') as f:
                transcript = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=f,
                    language="ja",
                    response_format="text"
                )
            # response_format="text"の場合、transcriptはstr型
            text = transcript.strip() if isinstance(transcript, str) else getattr(transcript, 'text', str(transcript)).strip()
            print(f"[文字起こし完了] {len(text)}文字")
            return text
        except Exception as direct_err:
            print(f"[直接送信失敗] {direct_err}")
            
            # ファイルサイズが大きい場合、または直接送信失敗時はWAV変換を試行
            if file_size > max_size or not PYDUB_AVAILABLE:
                if file_size > max_size:
                    print(f"[警告] ファイルサイズが大きすぎます ({file_size / 1024 / 1024:.1f}MB > 25MB)")
                    print("[推奨] 動画ファイルを分割するか、音声のみを抽出してください")
                raise direct_err
            
            # pydubでWAVに変換して再送信
            print("[WAV変換して再送信...]")
            wav_path = None
            try:
                audio = AudioSegment.from_file(str(video_path))
                # 16kHz、モノラルに変換（Whisper推奨形式）
                audio = audio.set_frame_rate(16000).set_channels(1)
                
                # 一時ファイルに保存
                with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
                    wav_path = tmp.name
                    audio.export(wav_path, format='wav')
                
                # WAVファイルサイズチェック
                wav_size = os.path.getsize(wav_path)
                if wav_size > max_size:
                    print(f"[警告] WAV変換後もファイルサイズが大きすぎます ({wav_size / 1024 / 1024:.1f}MB > 25MB)")
                    raise Exception(f"変換後のファイルサイズが大きすぎます: {wav_size / 1024 / 1024:.1f}MB")
                
                with open(wav_path, 'rb') as f:
                    transcript = client.audio.transcriptions.create(
                        model="whisper-1",
                        file=f,
                        language="ja",
                        response_format="text"
                    )
                text = transcript.strip() if isinstance(transcript, str) else getattr(transcript, 'text', str(transcript)).strip()
                print(f"[文字起こし完了] {len(text)}文字")
                return text
            finally:
                # 一時ファイルを削除
                if wav_path and os.path.exists(wav_path):
                    try:
                        os.remove(wav_path)
                    except Exception:
                        pass
    except Exception as e:
        print(f"[文字起こしエラー] {video_path.name}: {e}")
        raise


def chunk_text_by_tokens(text: str, max_tokens: int) -> List[str]:
    """テキストをトークン数でチャンク分割"""
    tokens = encoding.encode(text)
    chunks = []
    for i in range(0, len(tokens), max_tokens):
        chunk_tokens = tokens[i:i + max_tokens]
        chunk_text = encoding.decode(chunk_tokens)
        chunks.append(chunk_text)
    return chunks


def format_transcript_with_gpt(transcript: str) -> Dict[str, Any]:
    """GPT-4o-miniで文字起こしを二者会話形式に整形"""
    print("[GPT整形開始]")
    
    # 長文対策: チャンク分割
    if len(encoding.encode(transcript)) > MAX_TOKENS_PER_CHUNK:
        print(f"[長文検出] チャンク分割して処理します")
        chunks = chunk_text_by_tokens(transcript, MAX_TOKENS_PER_CHUNK)
        all_turns = []
        persona_notes = ""
        skills = []
        
        for i, chunk in enumerate(chunks):
            print(f"[チャンク {i+1}/{len(chunks)} 処理中]")
            result = format_chunk_with_gpt(chunk)
            if result:
                all_turns.extend(result.get('turns', []))
                if not persona_notes and result.get('persona_notes'):
                    persona_notes = result['persona_notes']
                if not skills and result.get('skills'):
                    skills = result['skills']
        
        # 結合後、40ターンに要約圧縮
        if len(all_turns) > 40:
            print(f"[ターン数超過] {len(all_turns)}ターン → 40ターンに圧縮")
            all_turns = compress_turns(all_turns)
        
        return {
            'turns': all_turns,
            'persona_notes': persona_notes,
            'skills': skills
        }
    else:
        return format_chunk_with_gpt(transcript)


def format_chunk_with_gpt(chunk: str) -> Optional[Dict[str, Any]]:
    """チャンク単位でGPT整形"""
    prompt = f"""以下の文字起こしテキストを営業とお客様の二者会話形式に整形してください。

【文字起こしテキスト】
{chunk}

【出力形式】JSON形式で以下の構造で出力してください：
{{
    "turns": [
        {{"speaker": "営業", "text": "発話内容"}},
        {{"speaker": "お客様", "text": "発話内容"}}
    ],
    "persona_notes": "口調と頻出パターンを一段落で記述",
    "skills": ["良い質問例", "異論処理の型", "クロージングの型"]
}}

【要件】
- 最大40ターンまで
- 個人情報は一般化（名前→「お客様」、具体的な金額→「費用」「予算」など）
- 曖昧な部分は自然に推定して補完
- 発話は簡潔に（1-2文程度）
- 営業とお客様が交互に話す形式
"""
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "あなたは会話整形の専門家です。JSON形式で正確に出力してください。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0,
            response_format={"type": "json_object"}
        )
        
        content = response.choices[0].message.content.strip()
        
        # JSON抽出
        json_text = extract_json(content)
        if json_text:
            return json.loads(json_text)
        else:
            print("[警告] JSON抽出失敗、```ブロックを試行")
            return None
            
    except Exception as e:
        print(f"[GPT整形エラー] {e}")
        return None


def extract_json(text: str) -> Optional[str]:
    """テキストからJSONを抽出"""
    # まず通常のJSONを試す
    try:
        json.loads(text)
        return text
    except:
        pass
    
    # ```json``` または ```{...}``` ブロックを探す
    patterns = [
        r'```json\s*(\{.*?\})\s*```',
        r'```\s*(\{.*?\})\s*```',
        r'(\{.*\})',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                json_text = match.group(1)
                json.loads(json_text)  # バリデーション
                return json_text
            except:
                continue
    
    return None


def compress_turns(turns: List[Dict[str, str]], target: int = 40) -> List[Dict[str, str]]:
    """ターン数を圧縮（GPTで要約）"""
    if len(turns) <= target:
        return turns
    
    print(f"[圧縮開始] {len(turns)}ターン → {target}ターン")
    
    # 会話テキストを作成
    conversation_text = "\n".join([
        f"{t['speaker']}: {t['text']}" for t in turns
    ])
    
    prompt = f"""以下の会話を要約圧縮して、重要な発話を残しながら{target}ターン程度にしてください。

【会話】
{conversation_text}

【出力形式】JSON形式で以下の構造で出力してください：
{{
    "turns": [
        {{"speaker": "営業", "text": "発話内容"}},
        {{"speaker": "お客様", "text": "発話内容"}}
    ]
}}
"""
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "あなたは会話要約の専門家です。重要発話を残しつつ要約してください。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0,
            response_format={"type": "json_object"}
        )
        
        content = response.choices[0].message.content.strip()
        json_text = extract_json(content)
        if json_text:
            result = json.loads(json_text)
            return result.get('turns', turns[:target])
    except Exception as e:
        print(f"[圧縮エラー] {e}、先頭{target}ターンを返します")
    
    # フォールバック: 先頭から抽出
    return turns[:target]


def create_scenario_json(video_name: str, formatted_data: Dict[str, Any]) -> Dict[str, Any]:
    """シナリオJSONを作成"""
    # ファイル名からIDを生成（拡張子除去、プレフィックス追加）
    file_stem = Path(video_name).stem
    scenario_id = f"rp_{file_stem}"
    
    # ターンからexpected_flowを推定
    turns_text = " ".join([t['text'] for t in formatted_data.get('turns', [])])
    expected_flow = infer_expected_flow(turns_text)
    
    persona_notes = formatted_data.get('persona_notes', '')
    skills = formatted_data.get('skills', [])
    
    scenario = {
        "id": scenario_id,
        "title": f"実録ロープレ：{file_stem}",
        "persona": {
            "customer_role": "無料相談の見込み客",
            "tone": persona_notes.split('。')[0] if persona_notes else "動画実例に準拠",
            "pain_points": extract_pain_points(turns_text),
            "business_size": "不明"
        },
        "guidelines": [
            "実例の口調を模倣して自然に応対する",
            "費用・納期の不安を丁寧に言語化する",
            "最後は次アクションを明確化する"
        ],
        "style_notes": persona_notes,
        "utterances": formatted_data.get('turns', []),
        "expected_flow": expected_flow
    }
    
    return scenario


def infer_expected_flow(text: str) -> List[str]:
    """会話テキストからexpected_flowを推定"""
    flow = []
    if re.search(r'(こんにちは|はじめまして|お世話)', text):
        flow.append('greeting')
    if re.search(r'(困って|課題|問題|悩み|どのような|現状)', text):
        flow.append('needs_analysis')
    if re.search(r'(提案|おすすめ|解決|サービス|プラン)', text):
        flow.append('proposal')
    if re.search(r'(でも|しかし|心配|不安|懸念|高い|難しい)', text):
        flow.append('objection_handling')
    if re.search(r'(いかがでしょうか|ご検討|次回|後日|ご連絡)', text):
        flow.append('closing')
    
    # デフォルト
    if not flow:
        flow = ['greeting', 'needs_analysis', 'proposal', 'closing']
    
    return flow


def extract_pain_points(text: str) -> List[str]:
    """会話テキストからpain_pointsを抽出"""
    pain_points = []
    if re.search(r'(費用|価格|予算|コスト|高い|安い)', text):
        pain_points.append('費用感')
    if re.search(r'(納期|期間|いつ|時間)', text):
        pain_points.append('納期')
    if re.search(r'(効果|成果|メリット|改善)', text):
        pain_points.append('具体的効果')
    if not pain_points:
        pain_points = ['費用感', '納期', '具体的効果']
    return pain_points


def save_scenario_json(scenario: Dict[str, Any]) -> Path:
    """シナリオJSONを保存"""
    scenario_id = scenario['id']
    file_path = SCENARIOS_DIR / f"{scenario_id}.json"
    
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(scenario, f, ensure_ascii=False, indent=2)
    
    print(f"[シナリオ保存] {file_path.name}")
    return file_path


def update_index_json(scenario_id: str, scenario_title: str, is_first: bool = False):
    """scenarios/index.jsonを更新"""
    if INDEX_JSON_PATH.exists():
        with open(INDEX_JSON_PATH, 'r', encoding='utf-8') as f:
            index_data = json.load(f)
    else:
        index_data = {
            "default_id": None,
            "scenarios": []
        }
    
    # 既存エントリをチェック
    existing_ids = [s['id'] for s in index_data.get('scenarios', [])]
    if scenario_id not in existing_ids:
        index_data['scenarios'].append({
            "id": scenario_id,
            "file": f"{scenario_id}.json",
            "title": scenario_title,
            "enabled": True
        })
        
        # 最初のエントリをdefault_idに設定
        if is_first and not index_data.get('default_id'):
            index_data['default_id'] = scenario_id
    
    with open(INDEX_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)
    
    print(f"[インデックス更新] {INDEX_JSON_PATH.name}")


def extract_sales_patterns(utterances: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """営業発話からパターンを抽出"""
    patterns = []
    
    for u in utterances:
        if u.get('speaker') != '営業':
            continue
        
        text = u.get('text', '')
        pattern_type = None
        pattern_text = None
        
        # (a) 良い質問
        if re.search(r'(なぜ|理由|目的|課題|ゴール|懸念|不安|どのように|どうして)', text):
            pattern_type = 'good_question'
            pattern_text = text
        
        # (b) 異論処理
        elif re.search(r'(たしかに|とはいえ|一方で|ご安心|もし.*なら)', text):
            pattern_type = 'objection_handling'
            pattern_text = text
        
        # (c) クロージング
        elif re.search(r'(次|日程|進め|合意|ご提案|いかが)', text):
            pattern_type = 'closing'
            pattern_text = text
        
        if pattern_type and pattern_text:
            patterns.append({
                'type': pattern_type,
                'text': pattern_text,
                'scenario_id': None  # 後で設定
            })
    
    return patterns


def create_rag_index(all_patterns: List[Dict[str, Any]]):
    """RAGインデックスを作成"""
    if not all_patterns:
        print("[警告] 抽出パターンがありません、RAGインデックスは作成しません")
        return 0
    
    print(f"[RAGインデックス作成開始] {len(all_patterns)}件")
    
    # テキストを取得
    texts = [p['text'] for p in all_patterns]
    
    # Embedding生成
    print("[Embedding生成中...]")
    embeddings = []
    batch_size = 100
    
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        try:
            response = client.embeddings.create(
                model="text-embedding-3-large",
                input=batch
            )
            batch_embeddings = [e.embedding for e in response.data]
            embeddings.extend(batch_embeddings)
            print(f"[Embedding進捗] {min(i + batch_size, len(texts))}/{len(texts)}")
        except Exception as e:
            print(f"[Embeddingエラー] {e}")
            continue
    
    if not embeddings:
        print("[警告] Embeddingが生成できませんでした")
        return 0
    
    # NumPy配列に変換
    embeddings_array = np.array(embeddings, dtype=np.float32)
    
    # L2正規化
    faiss.normalize_L2(embeddings_array)
    
    # FAISSインデックス作成（内積、L2正規化済み）
    dimension = embeddings_array.shape[1]
    index = faiss.IndexFlatIP(dimension)  # 内積
    index.add(embeddings_array)
    
    # 保存
    faiss_path = RAG_INDEX_DIR / 'sales_patterns.faiss'
    json_path = RAG_INDEX_DIR / 'sales_patterns.json'
    
    faiss.write_index(index, str(faiss_path))
    
    # メタデータをJSONで保存
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(all_patterns, f, ensure_ascii=False, indent=2)
    
    print(f"[RAGインデックス保存完了] {faiss_path.name}, {json_path.name}")
    return len(all_patterns)


def process_video(video_path: Path) -> Optional[Dict[str, Any]]:
    """1つの動画を処理"""
    print(f"\n{'='*60}")
    print(f"[処理開始] {video_path.name}")
    print(f"{'='*60}")
    
    try:
        # 1. 文字起こし
        transcript = transcribe_video(video_path)
        if not transcript:
            print(f"[スキップ] 文字起こし結果が空です: {video_path.name}")
            return None
        
        # 2. GPT整形
        formatted_data = format_transcript_with_gpt(transcript)
        if not formatted_data or not formatted_data.get('turns'):
            print(f"[スキップ] GPT整形失敗: {video_path.name}")
            return None
        
        # 3. シナリオJSON作成
        scenario = create_scenario_json(video_path.name, formatted_data)
        
        # 4. 保存
        save_scenario_json(scenario)
        
        # 5. パターン抽出
        patterns = extract_sales_patterns(formatted_data.get('turns', []))
        for p in patterns:
            p['scenario_id'] = scenario['id']
        
        return {
            'scenario': scenario,
            'patterns': patterns
        }
        
    except Exception as e:
        print(f"[エラー] {video_path.name}: {e}")
        import traceback
        traceback.print_exc()
        return None


def main():
    """メイン処理"""
    print("=" * 60)
    print("動画取り込みスクリプト開始")
    print("=" * 60)
    
    # videosディレクトリの存在確認
    if not VIDEOS_DIR.exists():
        print(f"[エラー] {VIDEOS_DIR} が見つかりません")
        sys.exit(1)
    
    # MP4およびWAVファイルを取得
    mp4_files = list(VIDEOS_DIR.glob('*.mp4'))
    wav_files = list(VIDEOS_DIR.glob('*.wav'))
    video_files = mp4_files + wav_files
    
    if not video_files:
        print(f"[警告] {VIDEOS_DIR} にMP4/WAVファイルが見つかりません")
        sys.exit(0)
    
    print(f"[検出] {len(video_files)}本の動画/音声ファイル (MP4: {len(mp4_files)}, WAV: {len(wav_files)})")
    
    # 各動画を処理
    all_patterns = []
    scenarios_created = 0
    
    for i, video_path in enumerate(video_files, 1):
        print(f"\n[{i}/{len(video_files)}]")
        result = process_video(video_path)
        
        if result:
            scenario = result['scenario']
            patterns = result['patterns']
            
            # インデックス更新（最初の1つをdefault_idに）
            is_first = (scenarios_created == 0)
            update_index_json(scenario['id'], scenario['title'], is_first)
            
            all_patterns.extend(patterns)
            scenarios_created += 1
    
    # RAGインデックス作成
    rag_items = 0
    if all_patterns:
        rag_items = create_rag_index(all_patterns)
    
    # 結果表示
    print("\n" + "=" * 60)
    print("処理完了")
    print("=" * 60)
    print(f"作成シナリオ数: {scenarios_created}")
    print(f"RAGアイテム数: {rag_items}")
    print("=" * 60)


if __name__ == '__main__':
    main()

