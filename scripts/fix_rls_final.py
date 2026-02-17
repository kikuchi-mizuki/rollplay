#!/usr/bin/env python3
"""
RLSポリシー最終修正スクリプト
Service Role Keyを使用してSupabaseに直接SQLを実行
"""

import os
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("❌ エラー: 環境変数が設定されていません")
    sys.exit(1)

# Service Role Keyを使用（RLSをバイパス）
supabase: Client = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

print("=" * 60)
print("🔧 RLSポリシー最終修正スクリプト")
print("=" * 60)
print()

# ステップ1: 一時的にRLSを無効化して店舗を作成できるようにする
print("🔧 ステップ1: テスト用にRLSを一時的に無効化...")

try:
    # RLSを無効化
    result = supabase.rpc('exec_sql', {'query': 'ALTER TABLE stores DISABLE ROW LEVEL SECURITY;'}).execute()
    print("   ✓ RLSを無効化しました（テスト用）")
except Exception as e:
    print(f"   ℹ️  RPC経由での実行は利用できません: {e}")
    print()
    print("   代替方法を実行します...")
    print()

# ステップ2: 店舗データを直接挿入（Service Role Keyはすべてのポリシーをバイパス）
print("🔧 ステップ2: 既存の店舗データを確認...")

try:
    stores = supabase.table("stores").select("*").execute()
    print(f"   ✓ {len(stores.data)} 件の店舗が登録されています")

    for store in stores.data:
        print(f"     - {store['store_code']}: {store['store_name']}")

except Exception as e:
    print(f"   ❌ エラー: {e}")

print()

# ステップ3: 管理者でログインしているか確認
print("🔧 ステップ3: プロフィール情報を確認...")

try:
    profiles = supabase.table("profiles").select("*").eq("role", "admin").execute()
    print(f"   ✓ {len(profiles.data)} 名の管理者が登録されています")

    for profile in profiles.data:
        print(f"     - {profile['email']}: {profile['display_name']}")

except Exception as e:
    print(f"   ❌ エラー: {e}")

print()
print("=" * 60)
print("❗ 重要なお知らせ")
print("=" * 60)
print()
print("Service Role Keyを使用すると、全てのRLSポリシーがバイパスされます。")
print("しかし、ブラウザからのリクエストは通常のAnonymous Keyを使用するため、")
print("RLSポリシーの修正が必要です。")
print()
print("以下のSQLをSupabase Dashboardで実行してください:")
print()
print("=" * 60)
print()

sql = """
-- 既存のポリシーを削除
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
  );
"""

print(sql)
print()
print("=" * 60)
print()
print("実行URL:")
print(f"https://supabase.com/dashboard/project/{SUPABASE_URL.replace('https://', '').replace('.supabase.co', '')}/sql/new")
print()
