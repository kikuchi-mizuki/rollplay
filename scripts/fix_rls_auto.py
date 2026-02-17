#!/usr/bin/env python3
"""
RLSポリシー自動修正スクリプト（PostgreSQL直接接続版）
"""

import os
import sys
from pathlib import Path

# プロジェクトのルートディレクトリをパスに追加
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

# 環境変数を読み込み
load_dotenv()

print("=" * 60)
print("🔧 RLSポリシー自動修正スクリプト")
print("=" * 60)
print()

# psycopg2のインストールを確認
try:
    import psycopg2
    from psycopg2 import sql
except ImportError:
    print("❌ エラー: psycopg2がインストールされていません")
    print()
    print("以下のコマンドでインストールしてください:")
    print("  pip install psycopg2-binary")
    print()
    sys.exit(1)

# データベース接続情報
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL", "")
# SupabaseのプロジェクトIDを抽出
if SUPABASE_URL:
    project_ref = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "")
else:
    print("❌ エラー: VITE_SUPABASE_URLが設定されていません")
    sys.exit(1)

# データベースパスワードを取得
db_password = os.getenv("SUPABASE_DB_PASSWORD")

if not db_password:
    print("❌ データベースパスワードが環境変数に設定されていません")
    print()
    print("以下の手順でパスワードを設定してください:")
    print()
    print("1. Supabase Dashboard を開く")
    print("   https://supabase.com/dashboard/project/guargnhnblhiupjumkhe/settings/database")
    print()
    print("2. 'Database Password' をコピー")
    print()
    print("3. .env ファイルに以下を追加:")
    print("   SUPABASE_DB_PASSWORD=your_password_here")
    print()
    print("4. このスクリプトを再実行")
    print()
    sys.exit(1)

# データベース接続文字列を構築
connection_string = f"postgresql://postgres.{project_ref}:{db_password}@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"

print()
print("🔌 データベースに接続しています...")

try:
    # データベースに接続
    conn = psycopg2.connect(connection_string)
    conn.autocommit = True
    cursor = conn.cursor()

    print("   ✓ 接続成功")
    print()

    # SQLコマンドを実行
    sql_commands = [
        "DROP POLICY IF EXISTS \"Admins can insert stores\" ON stores;",
        "DROP POLICY IF EXISTS \"Admins can update stores\" ON stores;",
        "DROP POLICY IF EXISTS \"Admins can delete stores\" ON stores;",
        "DROP POLICY IF EXISTS \"All authenticated users can view stores\" ON stores;",
        """
        CREATE POLICY "All authenticated users can view stores"
          ON stores FOR SELECT
          TO authenticated
          USING (true);
        """,
        """
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
        """,
        """
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
        """,
        """
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
    ]

    print("🔒 RLSポリシーを削除して再作成しています...")

    for idx, cmd in enumerate(sql_commands, 1):
        cursor.execute(cmd)
        if "DROP" in cmd:
            print(f"   [{idx}/{len(sql_commands)}] ポリシーを削除しました")
        elif "CREATE" in cmd:
            print(f"   [{idx}/{len(sql_commands)}] ポリシーを作成しました")

    cursor.close()
    conn.close()

    print()
    print("   ✓ 全てのRLSポリシーを更新しました")

except psycopg2.Error as e:
    print(f"   ❌ データベースエラー: {e}")
    sys.exit(1)
except Exception as e:
    print(f"   ❌ エラー: {e}")
    sys.exit(1)

print()
print("=" * 60)
print("✅ RLSポリシーの修正が完了しました！")
print("=" * 60)
print()
print("次のステップ:")
print("1. ブラウザで完全リロード（Ctrl+Shift+R / Command+Shift+R）")
print("2. ログアウトして再ログイン")
print("3. 店舗管理画面で店舗作成を試してください")
print()
