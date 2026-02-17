#!/usr/bin/env python3
"""
RLSポリシー修正スクリプト
stores テーブルのRLSポリシーを削除して再作成する
"""

import os
import sys
from pathlib import Path

# プロジェクトのルートディレクトリをパスに追加
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from supabase import create_client, Client
from dotenv import load_dotenv

# 環境変数を読み込み
load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("❌ エラー: 環境変数が設定されていません")
    sys.exit(1)

# Supabaseクライアントを作成
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

print("=" * 60)
print("🔧 RLSポリシー修正スクリプト")
print("=" * 60)
print()

# SQLを実行してRLSポリシーを削除・再作成
sql_commands = """
-- 既存のstoresテーブルのポリシーを全て削除
DROP POLICY IF EXISTS "Admins can insert stores" ON stores;
DROP POLICY IF EXISTS "Admins can update stores" ON stores;
DROP POLICY IF EXISTS "Admins can delete stores" ON stores;
DROP POLICY IF EXISTS "All authenticated users can view stores" ON stores;

-- 全認証ユーザーが店舗情報を閲覧可能
CREATE POLICY "All authenticated users can view stores"
  ON stores FOR SELECT
  TO authenticated
  USING (true);

-- 管理者のみ店舗を作成可能（より明示的なポリシー）
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

-- 管理者のみ店舗を更新可能
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

-- 管理者のみ店舗を削除可能
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

print("🔒 RLSポリシーを削除して再作成しています...")
print()

try:
    # PostgreSQL関数を使ってSQLを実行
    result = supabase.rpc('exec_sql', {'sql': sql_commands}).execute()
    print("   ✓ RLSポリシーを再作成しました")
except Exception as e:
    # rpc関数が存在しない場合は、postgrestのREST APIを使って直接SQLを実行する
    # ただし、これはSupabase Pythonライブラリでは直接サポートされていないため、
    # 代わりにrequestsライブラリを使用する必要がある

    print("   ⚠️  RPCでの実行に失敗しました")
    print(f"   エラー: {e}")
    print()
    print("   代替手段として、以下のSQLをSupabase Dashboardで実行してください：")
    print()
    print("   " + "=" * 56)
    print(sql_commands)
    print("   " + "=" * 56)
    print()
    print("   実行手順：")
    print("   1. https://supabase.com/dashboard を開く")
    print("   2. 左メニュー → SQL Editor")
    print("   3. 上記のSQLをコピー＆ペーストして実行")

print()
print("=" * 60)
print("✅ 処理が完了しました")
print("=" * 60)
print()
print("次のステップ:")
print("1. ブラウザで完全リロード（Ctrl+Shift+R / Command+Shift+R）")
print("2. ログアウトして再ログイン")
print("3. 店舗管理画面で店舗作成を試してください")
print()
