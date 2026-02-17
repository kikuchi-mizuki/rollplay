#!/usr/bin/env python3
"""
RLS自動修正スクリプト - ブラウザを開いてSQLをクリップボードにコピー
"""

import os
import sys
import webbrowser
import subprocess
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL", "")
project_ref = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "")

SQL = """-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Admins can insert stores" ON stores;
DROP POLICY IF EXISTS "Admins can update stores" ON stores;
DROP POLICY IF EXISTS "Admins can delete stores" ON stores;
DROP POLICY IF EXISTS "All authenticated users can view stores" ON stores;

-- 新しいポリシーを作成
CREATE POLICY "All authenticated users can view stores"
  ON stores FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert stores"
  ON stores FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update stores"
  ON stores FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete stores"
  ON stores FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );"""

print("=" * 60)
print("🚀 RLS自動修正スクリプト")
print("=" * 60)
print()
print("✅ ステップ1: SQLをクリップボードにコピーしています...")

try:
    # MacOSの場合、pbcopyを使用
    process = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
    process.communicate(SQL.encode('utf-8'))
    print("   ✓ SQLをクリップボードにコピーしました")
except Exception as e:
    print(f"   ❌ クリップボードへのコピーに失敗: {e}")
    print("   SQLを手動でコピーしてください")

print()
print("✅ ステップ2: Supabase SQL Editorを開いています...")

url = f"https://supabase.com/dashboard/project/{project_ref}/sql/new"

try:
    webbrowser.open(url)
    print(f"   ✓ ブラウザでSQL Editorを開きました")
except Exception as e:
    print(f"   ❌ ブラウザを開けませんでした: {e}")
    print(f"   手動で以下のURLを開いてください: {url}")

print()
print("=" * 60)
print("📝 次の操作を行ってください")
print("=" * 60)
print()
print("1. ブラウザでSupabase SQL Editorが開きます")
print("2. エディタ内で Command+V (Mac) または Ctrl+V (Windows) を押して")
print("   クリップボードのSQLを貼り付けます")
print("3. 右下の「Run」ボタンをクリックします")
print("4. 実行が完了したら、アプリケーションをリロードしてください")
print()
print("=" * 60)
print()
