#!/usr/bin/env python3
"""
RLSポリシー簡易修正スクリプト
Service Role Keyを使用してSupabase Management APIでSQLを実行
"""

import os
import sys
from pathlib import Path
import requests
import json

# プロジェクトのルートディレクトリをパスに追加
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

# 環境変数を読み込み
load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("❌ エラー: 環境変数が設定されていません")
    sys.exit(1)

print("=" * 60)
print("🔧 RLSポリシー簡易修正スクリプト")
print("=" * 60)
print()

# プロジェクトIDを抽出
project_ref = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "")

# SQL関数を作成してRLSポリシーを修正
sql_function = """
CREATE OR REPLACE FUNCTION fix_stores_rls_policies()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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
END;
$$;
"""

print("🔧 ステップ1: SQL関数を作成...")

# Supabase REST APIを使ってSQL関数を作成
headers = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json"
}

# postgRESTのrpcエンドポイントを使う前に、まずSQL関数を作成する必要がある
# しかし、SQL関数の作成自体にはPostgreSQLへの直接接続が必要

print("   ⚠️  このスクリプトは完全自動化できません")
print()
print("   代わりに、以下のSQLをSupabase Dashboardで実行してください:")
print()
print("   " + "=" * 56)
print()
print("""
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
""")
print()
print("   " + "=" * 56)
print()
print("   実行手順:")
print("   1. https://supabase.com/dashboard/project/" + project_ref + "/sql/new")
print("   2. 上記のSQLをコピー＆ペースト")
print("   3. 'Run' ボタンをクリック")
print()
print("=" * 60)
print("❗ 手動実行が必要です")
print("=" * 60)
print()
