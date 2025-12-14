#!/usr/bin/env python3
"""
AIペルソナ設定の壁打ちテストツール

使い方:
    python tools/test_ai_persona.py

機能:
- 営業役として質問を入力
- AI（顧客役）が応答
- 設定やプロンプトの動作を確認
- RAGパターンの活用状況を可視化
- Ctrl+C で終了
"""

import os
import sys
import json
import numpy as np
import faiss
from pathlib import Path
from openai import OpenAI
from dotenv import load_dotenv

# プロジェクトルートをパスに追加
sys.path.insert(0, str(Path(__file__).parent.parent))

# 環境変数読み込み
load_dotenv()

# OpenAI クライアント初期化
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

# RAGインデックス読み込み
RAG_INDEX_DIR = Path(__file__).parent.parent / 'rag_index'
RAG_INDEX_PATH = RAG_INDEX_DIR / 'sales_patterns.faiss'
RAG_METADATA_PATH = RAG_INDEX_DIR / 'sales_patterns.json'
RAG_INDEX = None
RAG_METADATA = []

def load_rag_index():
    """RAGインデックスを読み込み"""
    global RAG_INDEX, RAG_METADATA

    if not RAG_INDEX_PATH.exists() or not RAG_METADATA_PATH.exists():
        print(f"⚠️  RAGインデックスが見つかりません")
        return False

    try:
        RAG_INDEX = faiss.read_index(str(RAG_INDEX_PATH))
        with open(RAG_METADATA_PATH, 'r', encoding='utf-8') as f:
            RAG_METADATA = json.load(f)
        print(f"✅ RAGインデックス読込: {len(RAG_METADATA)}件")
        return True
    except Exception as e:
        print(f"❌ RAGインデックス読込エラー: {e}")
        return False

def search_rag_patterns(query: str, top_k: int = 10, scenario_id: str = None):
    """RAGパターンを検索"""
    if not RAG_INDEX or not RAG_METADATA:
        return []

    try:
        # シナリオIDでフィルタリング
        if scenario_id:
            filtered_indices = [i for i, m in enumerate(RAG_METADATA) if m.get('scenario_id') == scenario_id]
            if not filtered_indices:
                filtered_indices = list(range(len(RAG_METADATA)))
        else:
            filtered_indices = list(range(len(RAG_METADATA)))

        # クエリをEmbedding化
        response = client.embeddings.create(
            model="text-embedding-3-large",
            input=[query]
        )
        query_embedding = np.array([response.data[0].embedding], dtype=np.float32)

        # L2正規化
        faiss.normalize_L2(query_embedding)

        # FAISSで検索
        search_k = min(top_k * 10, len(RAG_METADATA))
        if search_k == 0:
            return []

        distances, indices = RAG_INDEX.search(query_embedding, search_k)

        # メタデータから結果を取得
        results = []
        for i, idx in enumerate(indices[0]):
            if idx < len(RAG_METADATA) and idx in filtered_indices:
                pattern = RAG_METADATA[idx].copy()
                pattern['similarity'] = float(distances[0][i])
                results.append(pattern)
                if len(results) >= top_k:
                    break

        return results
    except Exception as e:
        print(f"❌ RAG検索エラー: {e}")
        return []

# ディレクトリ設定
BASE_DIR = Path(__file__).parent.parent
SCENARIOS_DIR = BASE_DIR / 'scenarios'


def load_scenario(scenario_id: str):
    """シナリオファイルを読み込み"""
    scenario_path = SCENARIOS_DIR / f"{scenario_id}.json"
    if not scenario_path.exists():
        print(f"⚠️  シナリオファイルが見つかりません: {scenario_path}")
        return None

    with open(scenario_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def build_system_prompt(scenario_obj):
    """システムプロンプトを構築（app.pyと同じロジック）"""
    from app import SALES_ROLEPLAY_PROMPT

    system_prompt = SALES_ROLEPLAY_PROMPT

    # ペルソナ情報を追加
    if scenario_obj:
        # persona_variationsがある場合は最初のペルソナを使用
        if 'persona_variations' in scenario_obj and scenario_obj['persona_variations']:
            persona = scenario_obj['persona_variations'][0]
        else:
            persona = scenario_obj.get('persona') or {}

        guidelines = scenario_obj.get('guidelines') or []
        persona_txt = []

        # ペルソナ情報を詳細に追加
        if 'customer_role' in persona:
            persona_txt.append(f"顧客役: {persona['customer_role']}")
        if 'business_detail' in persona:
            persona_txt.append(f"事業詳細: {persona['business_detail']}")
        if 'tone' in persona:
            persona_txt.append(f"トーン・態度: {persona['tone']}")
        if 'relationship' in persona:
            persona_txt.append(f"営業との関係性: {persona['relationship']}")
        if 'knowledge_level' in persona:
            persona_txt.append(f"知識レベル: {persona['knowledge_level']}")
        if 'decision_power' in persona:
            persona_txt.append(f"意思決定権: {persona['decision_power']}")
        if 'current_sns_status' in persona:
            sns_status = persona['current_sns_status']
            if isinstance(sns_status, dict):
                persona_txt.append("現在のSNS運用状況:")
                if 'status' in sns_status:
                    persona_txt.append(f"  - 状況: {sns_status['status']}")
                if 'video_production' in sns_status:
                    persona_txt.append(f"  - 動画制作: {sns_status['video_production']}")
                if 'instagram' in sns_status:
                    persona_txt.append(f"  - Instagram: {sns_status['instagram']}")
                if 'tiktok' in sns_status:
                    persona_txt.append(f"  - TikTok: {sns_status['tiktok']}")
                if 'challenges' in sns_status:
                    challenges = sns_status['challenges']
                    if challenges:
                        persona_txt.append("  - 具体的な課題:")
                        for challenge in challenges[:5]:
                            persona_txt.append(f"    • {challenge}")
        if 'pain_points' in persona:
            pain_points = persona['pain_points']
            if pain_points:
                persona_txt.append("ペインポイント:")
                for pain in pain_points[:5]:
                    persona_txt.append(f"  • {pain}")
        if 'budget_sense' in persona:
            persona_txt.append(f"予算感: {persona['budget_sense']}")

        if persona_txt:
            system_prompt += "\n\n【シナリオ設定】\n- " + "\n- ".join(persona_txt)
        if guidelines:
            system_prompt += "\n\n【返答ガイドライン】\n- " + "\n- ".join(guidelines)

    return system_prompt


def chat_loop(scenario_id: str):
    """対話ループ"""
    print(f"""
{'='*60}
🎭 AIペルソナ設定 壁打ちテストツール
{'='*60}
シナリオ: {scenario_id}
{'='*60}

💡 使い方:
  - 営業役として質問を入力してください
  - AIが顧客役として応答します
  - 'exit' または Ctrl+C で終了
  - 'reset' で会話をリセット
  - 'show' でシステムプロンプトを表示
  - 'persona' でペルソナ情報を表示
  - 'rag' で最後の質問に対するRAGパターンを表示
{'='*60}
""")

    # シナリオ読み込み
    scenario_obj = load_scenario(scenario_id)
    if not scenario_obj:
        return

    # システムプロンプト構築
    system_prompt = build_system_prompt(scenario_obj)

    # 会話履歴
    messages = [{"role": "system", "content": system_prompt}]
    last_user_input = ""  # 最後のユーザー入力を保存（RAG検索用）

    print("✅ 準備完了！質問を入力してください\n")

    while True:
        try:
            # ユーザー入力
            user_input = input("\n営業👨‍💼: ").strip()

            if not user_input:
                continue

            # コマンド処理
            if user_input.lower() == 'exit':
                print("\n👋 終了します")
                break

            if user_input.lower() == 'reset':
                messages = [{"role": "system", "content": system_prompt}]
                print("\n🔄 会話をリセットしました")
                continue

            if user_input.lower() == 'show':
                print("\n" + "="*60)
                print("📋 システムプロンプト:")
                print("="*60)
                print(system_prompt)
                print("="*60)
                continue

            if user_input.lower() == 'persona':
                print("\n" + "="*60)
                print("🎭 ペルソナ情報:")
                print("="*60)
                persona = scenario_obj.get('persona_variations', [{}])[0] if 'persona_variations' in scenario_obj else scenario_obj.get('persona', {})
                print(json.dumps(persona, ensure_ascii=False, indent=2))
                print("="*60)
                continue

            if user_input.lower() == 'rag':
                if not last_user_input:
                    print("\n⚠️  まだ質問をしていません")
                    continue

                print("\n" + "="*60)
                print(f"🔍 RAGパターン検索結果（質問: {last_user_input[:50]}...）")
                print("="*60)

                # RAG検索実行
                rag_results = search_rag_patterns(last_user_input, top_k=10, scenario_id=scenario_id)

                if not rag_results:
                    print("⚠️  パターンが見つかりませんでした")
                else:
                    # 類似度閾値
                    similarity_threshold = 0.5
                    high_quality = [r for r in rag_results if r['similarity'] <= similarity_threshold]
                    low_quality = [r for r in rag_results if r['similarity'] > similarity_threshold]

                    print(f"\n✅ 高品質パターン（類似度距離 ≤ {similarity_threshold}）: {len(high_quality)}件")
                    for i, result in enumerate(high_quality[:7], 1):
                        print(f"\n  [{i}] 類似度距離: {result['similarity']:.3f}")
                        print(f"      テキスト: {result['text'][:150]}...")

                    if low_quality:
                        print(f"\n❌ 低品質パターン（除外、距離 > {similarity_threshold}）: {len(low_quality)}件")
                        for i, result in enumerate(low_quality[:3], 1):
                            print(f"\n  [{i}] 類似度距離: {result['similarity']:.3f}")
                            print(f"      テキスト: {result['text'][:100]}...")

                print("="*60)
                continue

            # 最後のユーザー入力を保存
            last_user_input = user_input

            # ユーザーメッセージを追加
            messages.append({"role": "user", "content": user_input})

            # GPT-4o-mini で応答生成
            print("\n顧客🧑‍💼: ", end="", flush=True)

            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                max_tokens=1000,
                temperature=0.7,
                stream=True
            )

            # ストリーミング表示
            full_response = ""
            for chunk in response:
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    print(content, end="", flush=True)
                    full_response += content

            print()  # 改行

            # アシスタントメッセージを追加
            messages.append({"role": "assistant", "content": full_response})

        except KeyboardInterrupt:
            print("\n\n👋 終了します")
            break
        except Exception as e:
            print(f"\n❌ エラー: {e}")


def main():
    """メイン処理"""
    # OpenAI APIキーの確認
    if not os.getenv('OPENAI_API_KEY'):
        print("❌ エラー: OPENAI_API_KEYが設定されていません")
        sys.exit(1)

    # RAGインデックス読み込み
    print("\n🔧 RAGインデックス読み込み中...")
    rag_loaded = load_rag_index()
    if not rag_loaded:
        print("⚠️  RAGインデックスなしで続行します（'rag'コマンドは使用できません）")

    # シナリオ選択
    scenarios = [
        ('meeting_1st', '1次面談（初回接触）'),
        ('meeting_1_5th', '1.5次面談'),
        ('meeting_2nd', '2次面談'),
        ('meeting_3rd', '3次面談'),
        ('kickoff', 'キックオフミーティング'),
        ('upsell', 'アップセル営業'),
    ]

    print("\n📋 シナリオを選択してください:")
    for i, (scenario_id, title) in enumerate(scenarios, 1):
        print(f"  {i}. {title} ({scenario_id})")

    try:
        choice = input("\n番号を入力 (1-6, デフォルト: 1): ").strip()
        if not choice:
            choice = '1'

        idx = int(choice) - 1
        if idx < 0 or idx >= len(scenarios):
            print("❌ 無効な番号です")
            sys.exit(1)

        scenario_id, _ = scenarios[idx]

        # 対話ループ開始
        chat_loop(scenario_id)

    except KeyboardInterrupt:
        print("\n\n👋 終了します")
    except Exception as e:
        print(f"❌ エラー: {e}")


if __name__ == '__main__':
    main()
