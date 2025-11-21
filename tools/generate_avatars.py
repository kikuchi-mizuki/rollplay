"""
日本人アバター画像の自動生成スクリプト

OpenAI DALL-E 3を使用して、SNS動画営業ロープレ用の日本人アバター画像を生成します。
各アバターにつき6種類の表情（listening, smile, confused, thinking, nodding, interested）を生成します。
"""

import os
import requests
from openai import OpenAI
from dotenv import load_dotenv
import time

load_dotenv()

# OpenAI クライアント初期化
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

# アバター定義（3パターン）
AVATARS = [
    {
        "id": "avatar_01",
        "name": "佐藤さん（30代男性）",
        "base_prompt": "日本人男性、30代、ビジネスカジュアル、清潔感のある髪型、自然な笑顔、プロフェッショナル、正面顔、肩から上のポートレート、自然光、高品質な写真、リアルな質感"
    },
    {
        "id": "avatar_02",
        "name": "田中さん（40代女性）",
        "base_prompt": "日本人女性、40代、ビジネススーツ、ショートヘア、穏やかな表情、プロフェッショナル、正面顔、肩から上のポートレート、自然光、高品質な写真、リアルな質感"
    },
    {
        "id": "avatar_03",
        "name": "山田さん（20代女性）",
        "base_prompt": "日本人女性、20代、ビジネスカジュアル、ロングヘア、明るい表情、プロフェッショナル、正面顔、肩から上のポートレート、自然光、高品質な写真、リアルな質感"
    }
]

# 表情バリエーション（6種類）
EXPRESSIONS = [
    {
        "type": "listening",
        "name": "真剣に聞く",
        "prompt_suffix": "真剣に話を聞いている表情、集中している、アイコンタクト"
    },
    {
        "type": "smile",
        "name": "笑顔",
        "prompt_suffix": "自然な笑顔、温かい表情、親しみやすい"
    },
    {
        "type": "confused",
        "name": "困惑",
        "prompt_suffix": "少し困惑した表情、考え込んでいる、眉をひそめている"
    },
    {
        "type": "thinking",
        "name": "考える",
        "prompt_suffix": "考えている表情、真剣、視線をやや下に"
    },
    {
        "type": "nodding",
        "name": "うなずく",
        "prompt_suffix": "うなずいている表情、同意を示す、優しい笑み"
    },
    {
        "type": "interested",
        "name": "興味を示す",
        "prompt_suffix": "興味を持っている表情、目を輝かせている、前のめり"
    }
]

def generate_avatar_image(avatar_id: str, base_prompt: str, expression_type: str, expression_prompt: str, output_dir: str = "public/avatars"):
    """
    DALL-E 3でアバター画像を生成

    Args:
        avatar_id: アバターID（例: avatar_01）
        base_prompt: ベースプロンプト（人物の基本情報）
        expression_type: 表情タイプ（例: listening）
        expression_prompt: 表情の説明
        output_dir: 出力ディレクトリ

    Returns:
        生成された画像のファイルパス
    """
    # 完全なプロンプト
    full_prompt = f"{base_prompt}, {expression_prompt}, photorealistic, professional portrait photography, 4K quality"

    print(f"📸 生成中: {avatar_id}_{expression_type}")
    print(f"   プロンプト: {full_prompt[:100]}...")

    try:
        # DALL-E 3で画像生成
        response = client.images.generate(
            model="dall-e-3",
            prompt=full_prompt,
            size="1024x1024",
            quality="standard",
            n=1
        )

        # 生成された画像のURL
        image_url = response.data[0].url

        # 画像をダウンロード
        image_data = requests.get(image_url).content

        # ファイル名: avatar_01_listening.png
        filename = f"{avatar_id}_{expression_type}.png"
        filepath = os.path.join(output_dir, filename)

        # ディレクトリが存在しない場合は作成
        os.makedirs(output_dir, exist_ok=True)

        # 画像を保存
        with open(filepath, 'wb') as f:
            f.write(image_data)

        print(f"   ✅ 保存完了: {filepath}")
        return filepath

    except Exception as e:
        print(f"   ❌ エラー: {e}")
        return None

def generate_all_avatars():
    """
    すべてのアバターと表情の組み合わせを生成
    """
    print("🎨 日本人アバター画像の生成を開始します...")
    print(f"   アバター数: {len(AVATARS)}")
    print(f"   表情数: {len(EXPRESSIONS)}")
    print(f"   合計: {len(AVATARS) * len(EXPRESSIONS)}枚")
    print()

    generated_files = []

    for avatar in AVATARS:
        print(f"\n👤 {avatar['name']} の生成開始")
        print("=" * 60)

        for expression in EXPRESSIONS:
            filepath = generate_avatar_image(
                avatar_id=avatar['id'],
                base_prompt=avatar['base_prompt'],
                expression_type=expression['type'],
                expression_prompt=expression['prompt_suffix']
            )

            if filepath:
                generated_files.append({
                    'avatar_id': avatar['id'],
                    'avatar_name': avatar['name'],
                    'expression_type': expression['type'],
                    'expression_name': expression['name'],
                    'filepath': filepath
                })

            # レート制限を避けるため、少し待機
            time.sleep(2)

    print("\n" + "=" * 60)
    print(f"✅ 完了！ {len(generated_files)}枚の画像を生成しました。")
    print(f"📁 保存先: public/avatars/")
    print()
    print("次のステップ:")
    print("1. public/avatars/ フォルダの画像を確認")
    print("2. Supabase Storage にアップロード")
    print("3. データベースに登録")

    return generated_files

if __name__ == "__main__":
    generate_all_avatars()
