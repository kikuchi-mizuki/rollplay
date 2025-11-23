#!/usr/bin/env python3
"""
RAGデータからscenario_id='unknown'のエントリを削除するスクリプト
"""
import json
import numpy as np
import faiss

# 既存のメタデータとインデックスを読み込み
print("Loading existing RAG data...")
with open('rag_index/sales_patterns.json', 'r', encoding='utf-8') as f:
    metadata = json.load(f)

index = faiss.read_index('rag_index/sales_patterns.faiss')

print(f"Total entries before filtering: {len(metadata)}")

# scenario_id が 'unknown' でないものだけをフィルタ
filtered_metadata = [item for item in metadata if item.get('scenario_id') != 'unknown']
unknown_count = len(metadata) - len(filtered_metadata)

print(f"Entries with scenario_id='unknown': {unknown_count}")
print(f"Total entries after filtering: {len(filtered_metadata)}")

# unknownのインデックスを特定
unknown_indices = [i for i, item in enumerate(metadata) if item.get('scenario_id') == 'unknown']

# FAISSインデックスから該当ベクトルを削除
# FAISSのIndexFlatL2は直接削除できないので、unknownでないものだけで再構築
valid_indices = [i for i in range(len(metadata)) if i not in unknown_indices]

# 既存のベクトルを取得して、valid_indicesのものだけで新しいインデックスを作成
d = index.d  # ベクトルの次元数
new_index = faiss.IndexFlatL2(d)

# 既存のベクトルを抽出
vectors = np.zeros((len(valid_indices), d), dtype='float32')
for new_idx, old_idx in enumerate(valid_indices):
    vectors[new_idx] = index.reconstruct(old_idx)

# 新しいインデックスに追加
new_index.add(vectors)

# バックアップを作成
print("\nCreating backups...")
import shutil
import datetime
timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
shutil.copy('rag_index/sales_patterns.json', f'rag_index/sales_patterns_backup_{timestamp}.json')
shutil.copy('rag_index/sales_patterns.faiss', f'rag_index/sales_patterns_backup_{timestamp}.faiss')

# 新しいデータを保存
print("Saving filtered data...")
with open('rag_index/sales_patterns.json', 'w', encoding='utf-8') as f:
    json.dump(filtered_metadata, f, ensure_ascii=False, indent=2)

faiss.write_index(new_index, 'rag_index/sales_patterns.faiss')

print(f"\n✓ Successfully removed {unknown_count} entries with scenario_id='unknown'")
print(f"✓ New total: {len(filtered_metadata)} entries")
print(f"✓ Backups saved with timestamp: {timestamp}")

# scenario_id別の統計を表示
from collections import Counter
scenario_counts = Counter(item['scenario_id'] for item in filtered_metadata)
print("\nScenario distribution after cleanup:")
for scenario, count in sorted(scenario_counts.items()):
    print(f"  {scenario}: {count}")
