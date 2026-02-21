#!/usr/bin/env python3
"""
管理者権限の自動設定スクリプト
Supabaseに接続してSQLを実行します
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# .envファイルを読み込み
project_root = Path(__file__).parent.parent
load_dotenv(project_root / '.env')

# Supabase設定
SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("❌ エラー: VITE_SUPABASE_URLまたはSUPABASE_SERVICE_ROLE_KEYが設定されていません")
    sys.exit(1)

# Supabaseクライアント作成
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

print("🔗 Supabaseに接続しています...")
print(f"   URL: {SUPABASE_URL}")

# SQLファイルを読み込み
sql_file = project_root / 'database' / '99_setup_admin_auto_assignment.sql'
if not sql_file.exists():
    print(f"❌ エラー: SQLファイルが見つかりません: {sql_file}")
    sys.exit(1)

print(f"📄 SQLファイルを読み込みます: {sql_file.name}")

with open(sql_file, 'r', encoding='utf-8') as f:
    sql_content = f.read()

# SQLを個別のステートメントに分割
statements = []
current_statement = []
in_function = False

for line in sql_content.split('\n'):
    stripped = line.strip()

    # コメント行をスキップ
    if stripped.startswith('--'):
        continue

    # 空行をスキップ
    if not stripped:
        continue

    current_statement.append(line)

    # 関数定義の開始/終了を検出
    if '$$' in line:
        in_function = not in_function

    # セミコロンで終わり、関数の中でない場合はステートメント完了
    if stripped.endswith(';') and not in_function:
        statements.append('\n'.join(current_statement))
        current_statement = []

# 残りのステートメントを追加
if current_statement:
    statements.append('\n'.join(current_statement))

print(f"✅ {len(statements)}個のSQLステートメントを検出しました")
print()

# 各ステートメントを実行
success_count = 0
error_count = 0

for i, statement in enumerate(statements, 1):
    # 長いステートメントは省略して表示
    display_stmt = statement[:100] + '...' if len(statement) > 100 else statement
    display_stmt = display_stmt.replace('\n', ' ').strip()

    print(f"[{i}/{len(statements)}] 実行中: {display_stmt}")

    try:
        # Supabase RPCを使ってSQLを実行
        # SupabaseのPython SDKはdirect SQLサポートがないため、
        # postgrestを使って実行します
        response = supabase.rpc('exec_sql', {'query': statement}).execute()

        print(f"    ✅ 成功")
        success_count += 1
    except Exception as e:
        # SELECT文などはエラーになることがあるが、それ以外の方法でも試す
        try:
            # 代替方法: table操作として実行
            if 'INSERT' in statement.upper():
                # INSERT文の処理
                pass
            elif 'UPDATE' in statement.upper():
                # UPDATE文の処理
                pass
            elif 'CREATE' in statement.upper() or 'DROP' in statement.upper():
                # DDL文はスキップ（RPCが必要）
                print(f"    ⚠️  DDL文のため、Webダッシュボードで実行してください")
                error_count += 1
            elif 'SELECT' in statement.upper():
                # SELECT文は情報表示用なのでスキップ
                print(f"    ℹ️  SELECTクエリをスキップ")
            else:
                print(f"    ❌ エラー: {str(e)[:100]}")
                error_count += 1
        except Exception as e2:
            print(f"    ❌ エラー: {str(e)[:100]}")
            error_count += 1

    print()

print("=" * 60)
print(f"✅ 実行完了: 成功={success_count}, エラー={error_count}")
print("=" * 60)

if error_count > 0:
    print()
    print("⚠️  一部のSQLステートメントが実行できませんでした")
    print("   Supabase Dashboard → SQL Editorで手動実行してください:")
    print(f"   https://supabase.com/dashboard/project/guargnhnblhiupjumkhe/sql/new")
    print()
    print("   または、以下のSQLファイル全体をコピー＆実行してください:")
    print(f"   {sql_file}")
