#!/usr/bin/env python3
"""
D-ID APIを使ってアバター表情動画を自動生成するスクリプト
"""
import os
import requests
import time
from d_id_client import get_did_client
from dotenv import load_dotenv

load_dotenv()

# アバター画像URL（D-IDのpublic bucket または独自のURL）
AVATAR_URL = "https://d-id-public-bucket.s3.amazonaws.com/alice.jpg"

# 出力ディレクトリ
OUTPUT_DIR = "public/videos/avatar_03"

# 6種類の表情に対応するテキストと音声設定
EXPRESSIONS = {
    "listening": {
        "text": "はい、詳しくお聞かせください。",
        "voice_id": "ja-JP-NanamiNeural",
        "description": "傾聴姿勢（相手の話を聞く表情）"
    },
    "smile": {
        "text": "それは素晴らしいですね！ぜひご提案させていただきます。",
        "voice_id": "ja-JP-NanamiNeural",
        "description": "笑顔（提案・好意的な返答）"
    },
    "thinking": {
        "text": "なるほど、それについては少し検討する必要がありますね。",
        "voice_id": "ja-JP-NanamiNeural",
        "description": "考える表情（検討・質問への回答）"
    },
    "nodding": {
        "text": "はい、承知いたしました。その方向で進めましょう。",
        "voice_id": "ja-JP-NanamiNeural",
        "description": "頷く（同意・理解）"
    },
    "interested": {
        "text": "非常に興味深いお話ですね。もう少し詳しく教えていただけますか。",
        "voice_id": "ja-JP-NanamiNeural",
        "description": "興味深い表情（提案を受け入れる）"
    },
    "confused": {
        "text": "申し訳ございません、その点については少し難しいかもしれません。",
        "voice_id": "ja-JP-NanamiNeural",
        "description": "困惑（断る・難色を示す）"
    }
}


def download_video(video_url: str, output_path: str) -> bool:
    """
    動画URLからダウンロード

    Args:
        video_url: D-IDの動画URL
        output_path: 保存先パス

    Returns:
        成功: True, 失敗: False
    """
    try:
        print(f"📥 動画ダウンロード中: {output_path}")
        response = requests.get(video_url, timeout=60)
        response.raise_for_status()

        with open(output_path, 'wb') as f:
            f.write(response.content)

        file_size_mb = len(response.content) / (1024 * 1024)
        print(f"✅ ダウンロード完了: {file_size_mb:.2f} MB")
        return True

    except Exception as e:
        print(f"❌ ダウンロードエラー: {e}")
        return False


def generate_expression_video(
    client,
    expression_name: str,
    expression_config: dict,
    output_dir: str
) -> bool:
    """
    1つの表情動画を生成

    Args:
        client: D-IDクライアント
        expression_name: 表情名（例: "smile"）
        expression_config: 表情設定（text, voice_id, description）
        output_dir: 出力ディレクトリ

    Returns:
        成功: True, 失敗: False
    """
    text = expression_config['text']
    voice_id = expression_config['voice_id']
    description = expression_config['description']

    print(f"\n{'='*60}")
    print(f"🎬 {expression_name} - {description}")
    print(f"{'='*60}")
    print(f"テキスト: {text}")
    print(f"音声ID: {voice_id}")

    try:
        # D-ID APIで動画生成
        print("📤 D-ID API呼び出し中...")
        result = client.create_talk_from_text(
            text=text,
            voice_id=voice_id,
            source_url=AVATAR_URL,
            driver_url="bank://lively"
        )

        talk_id = result.get('id')
        print(f"✅ トーク作成: {talk_id}")

        # 完了を待機
        print("⏳ 動画生成中... (最大2分)")
        video_url = client.wait_for_completion(talk_id, timeout=120, poll_interval=3)

        if not video_url:
            print(f"❌ 動画生成失敗: {expression_name}")
            return False

        print(f"✅ 動画生成完了: {video_url}")

        # ダウンロード
        output_path = os.path.join(output_dir, f"{expression_name}.mp4")
        success = download_video(video_url, output_path)

        if success:
            print(f"💾 保存完了: {output_path}")
            return True
        else:
            return False

    except Exception as e:
        print(f"❌ エラー: {e}")
        return False


def main():
    """メイン処理"""
    print("="*60)
    print("🎭 アバター表情動画生成スクリプト")
    print("="*60)

    # D-IDクライアント初期化
    client = get_did_client()
    if not client:
        print("❌ D-ID APIキーが設定されていません")
        print("💡 .envファイルにD_ID_API_KEYを設定してください")
        return

    # 出力ディレクトリ作成
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"📁 出力ディレクトリ: {OUTPUT_DIR}")

    # 各表情動画を生成
    success_count = 0
    total_count = len(EXPRESSIONS)

    for expression_name, config in EXPRESSIONS.items():
        success = generate_expression_video(
            client,
            expression_name,
            config,
            OUTPUT_DIR
        )

        if success:
            success_count += 1

        # API制限を考慮して待機（次のリクエストまで5秒）
        if expression_name != list(EXPRESSIONS.keys())[-1]:  # 最後でなければ
            print("\n⏸️  5秒待機中...")
            time.sleep(5)

    # 結果サマリー
    print(f"\n{'='*60}")
    print(f"📊 生成結果")
    print(f"{'='*60}")
    print(f"成功: {success_count}/{total_count}")
    print(f"出力先: {OUTPUT_DIR}")

    if success_count == total_count:
        print("\n✅ すべての動画生成が完了しました！")
        print(f"\n次のステップ:")
        print(f"1. {OUTPUT_DIR}/ の動画を確認")
        print(f"2. RoleplayApp.tsx で動画切り替えロジックを実装")
    else:
        print(f"\n⚠️ {total_count - success_count}個の動画生成に失敗しました")


if __name__ == "__main__":
    main()
