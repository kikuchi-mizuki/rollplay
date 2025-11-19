#!/usr/bin/env python3
"""
Supabaseデータベースセットアップスクリプト
Week 1 Day 3: データベース設計・構築
"""

import os
import sys
from pathlib import Path
from supabase import create_client, Client
from dotenv import load_dotenv

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
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def execute_sql_file(file_path: str):
    """SQLファイルを読み込んで実行"""
    print(f"\n📄 実行中: {file_path}")

    with open(file_path, 'r', encoding='utf-8') as f:
        sql = f.read()

    try:
        # Supabase PostgRESTを使ってSQLを実行
        # 注: postgrestではDDLを直接実行できないため、
        # Supabase Management APIまたはpg8000を使用する必要があります

        # 代替方法: psycopg2を使用
        import psycopg2

        # Supabase接続文字列を構築
        # URLからプロジェクト参照を取得
        project_ref = SUPABASE_URL.split('//')[1].split('.')[0]

        # 接続文字列（Supabaseの形式）
        # 実際の接続にはDatabase Passwordが必要
        print("⚠️  データベースパスワードの入力が必要です")
        print(f"   Supabase Dashboard → Settings → Database → Connection String")
        print(f"   から取得してください")

        # 代わりに、REST APIを使う方法を試します
        print("\n⚠️  直接SQL実行はサポートされていません")
        print("   Supabase Dashboard → SQL Editor でマニュアル実行が必要です")

        return False

    except Exception as e:
        print(f"❌ エラー: {e}")
        return False

def main():
    """メイン処理"""
    print("=" * 60)
    print("🚀 Supabaseデータベースセットアップ")
    print("=" * 60)

    # SQLファイルのパス
    database_dir = Path(__file__).parent.parent / 'database'
    master_schema = database_dir / '00_master_schema.sql'

    if not master_schema.exists():
        print(f"❌ エラー: {master_schema} が見つかりません")
        sys.exit(1)

    # マスタースキーマを実行
    execute_sql_file(str(master_schema))

    print("\n" + "=" * 60)
    print("⚠️  注意: Supabase CLIからの直接SQL実行は制限があります")
    print("=" * 60)
    print("\n📋 次の手順を手動で実行してください:")
    print("   1. Supabase Dashboard にアクセス")
    print(f"      {SUPABASE_URL.replace('.supabase.co', '.supabase.co/project/guargnhnblhiupjumkhe')}")
    print("   2. 左メニュー → SQL Editor → New query")
    print(f"   3. {master_schema} の内容をコピー&ペースト")
    print("   4. 'Run' をクリック")
    print("\n✅ または、以下のコマンドでファイル内容を表示:")
    print(f"   cat {master_schema}")

if __name__ == "__main__":
    main()
