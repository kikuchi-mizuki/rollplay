#!/usr/bin/env python3
"""
管理者権限自動付与トリガーをセットアップするスクリプト
セキュリティ強化: クライアント側ではなくデータベース側で権限を制御
"""

import os
import sys
from pathlib import Path
from supabase import create_client
from dotenv import load_dotenv

# プロジェクトルートに移動
project_root = Path(__file__).parent.parent
os.chdir(project_root)

# .envファイルを読み込み
load_dotenv()

# Supabase認証情報
SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("❌ エラー: Supabase環境変数が設定されていません")
    print("   VITE_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env に設定してください")
    sys.exit(1)

# Supabaseクライアント作成
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def execute_sql_file(file_path: str):
    """SQLファイルを読み込んで実行"""
    try:
        print(f"\n📄 実行中: {file_path}")

        with open(file_path, 'r', encoding='utf-8') as f:
            sql = f.read()

        # Supabase RPC経由でSQLを実行
        # 注: Supabase Pythonクライアントは直接SQLを実行できないため、
        # PostgreSQL直接接続が必要
        print("⚠️  このスクリプトはSupabase Dashboardで手動実行が必要です")
        print(f"\n--- SQLの内容 ---")
        print(sql)
        print("--- SQLの内容ここまで ---\n")
        print("📝 次のステップ:")
        print("1. Supabase Dashboard → SQL Editor を開く")
        print("2. 上記のSQLをコピー＆ペースト")
        print("3. 「Run」ボタンをクリック")

        return True

    except Exception as e:
        print(f"❌ エラー: {e}")
        return False

if __name__ == '__main__':
    print("=" * 60)
    print("管理者権限自動付与トリガーのセットアップ")
    print("=" * 60)

    sql_file = 'database/15_auto_assign_admin_role.sql'

    if execute_sql_file(sql_file):
        print("\n✅ SQLファイルの内容を表示しました")
        print("   Supabase Dashboardで手動実行してください")
    else:
        print("\n❌ セットアップに失敗しました")
        sys.exit(1)
