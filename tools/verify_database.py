#!/usr/bin/env python3
"""
Supabaseデータベース確認スクリプト
Week 1 Day 3: データベース設計・構築の確認
"""

import os
import sys
from supabase import create_client, Client
from dotenv import load_dotenv

# .envファイルを読み込み
load_dotenv()

# Supabase認証情報
SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("❌ エラー: Supabase環境変数が設定されていません")
    sys.exit(1)

# Supabaseクライアント作成
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def verify_tables():
    """テーブルの存在確認"""
    print("=" * 60)
    print("🔍 Supabaseデータベース確認")
    print("=" * 60)

    tables_to_check = ['stores', 'profiles', 'conversations', 'evaluations']

    for table_name in tables_to_check:
        try:
            # テーブルからデータを取得（0件でもOK）
            result = supabase.table(table_name).select("*").limit(1).execute()
            print(f"✅ {table_name:<20} テーブル存在確認OK")
        except Exception as e:
            print(f"❌ {table_name:<20} エラー: {e}")

    print("\n" + "=" * 60)
    print("📊 サンプルデータ確認（stores テーブル）")
    print("=" * 60)

    try:
        # storesテーブルのデータを取得
        result = supabase.table('stores').select("*").execute()

        if result.data:
            print(f"\n店舗数: {len(result.data)}")
            print("\n店舗一覧:")
            for store in result.data:
                print(f"  • {store['store_code']:<12} {store['store_name']:<15} ({store['region']})")
        else:
            print("⚠️  サンプルデータが見つかりません")

    except Exception as e:
        print(f"❌ エラー: {e}")

    print("\n" + "=" * 60)
    print("✅ データベース確認完了")
    print("=" * 60)

if __name__ == "__main__":
    verify_tables()
