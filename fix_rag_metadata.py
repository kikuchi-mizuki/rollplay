#!/usr/bin/env python3
"""
既存のRAGメタデータにscenario_idを追加するスクリプト
"""
import json
import re

RAG_METADATA_PATH = 'rag_index/sales_patterns.json'

def extract_scenario_id(filename: str) -> str:
    """ファイル名からシナリオIDを抽出"""
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

    # デフォルト
    return 'unknown'

# メタデータを読み込み
with open(RAG_METADATA_PATH, 'r', encoding='utf-8') as f:
    metadata = json.load(f)

print(f"📂 メタデータ読み込み: {len(metadata)}件")

# scenario_idがないアイテムを修正
fixed_count = 0
for item in metadata:
    if 'scenario_id' not in item:
        # source_file または source からscenario_idを抽出
        source = item.get('source_file', item.get('source', ''))
        if source:
            item['scenario_id'] = extract_scenario_id(source)
            fixed_count += 1
            print(f"  {source} → {item['scenario_id']}")

print(f"\n✅ 修正完了: {fixed_count}件")

# 統計情報
scenario_stats = {}
for item in metadata:
    scenario_id = item.get('scenario_id', 'unknown')
    scenario_stats[scenario_id] = scenario_stats.get(scenario_id, 0) + 1

print(f"\n📊 シナリオ別データ数:")
for scenario_id, count in sorted(scenario_stats.items()):
    print(f"  {scenario_id}: {count}件")

# 保存
with open(RAG_METADATA_PATH, 'w', encoding='utf-8') as f:
    json.dump(metadata, f, ensure_ascii=False, indent=2)

print(f"\n💾 保存完了: {RAG_METADATA_PATH}")
