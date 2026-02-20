#!/usr/bin/env python3
"""
本部店舗を追加するスクリプト
店舗コードに「ADMIN」を含む店舗を追加
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

def add_headquarters_store():
    """本部店舗を追加"""
    try:
        print("📝 本部店舗を追加中...")

        # 既存の本部店舗を確認
        existing = supabase.table('stores').select('*').eq('store_code', 'ADMIN_HQ').execute()

        if existing.data:
            print(f"✅ 本部店舗は既に存在します: {existing.data[0]['store_name']}")
            return

        # 本部店舗を追加
        result = supabase.table('stores').insert({
            'store_code': 'ADMIN_HQ',
            'store_name': '本部',
            'region': '本部',
            'status': 'active'
        }).execute()

        if result.data:
            print(f"✅ 本部店舗を追加しました: {result.data[0]['store_name']}")
            print(f"   店舗コード: {result.data[0]['store_code']}")
            print(f"   店舗ID: {result.data[0]['id']}")
        else:
            print("❌ 本部店舗の追加に失敗しました")

    except Exception as e:
        print(f"❌ エラーが発生しました: {e}")
        sys.exit(1)

if __name__ == '__main__':
    add_headquarters_store()
    print("\n✅ 完了しました")
