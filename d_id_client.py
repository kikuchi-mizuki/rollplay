"""
D-ID API クライアント
テキストまたは音声からリップシンク動画を生成
Week 7: キャッシング機能追加
"""
import os
import requests
import time
import hashlib
from typing import Optional, Dict

class DIDClient:
    """D-ID API クライアント"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.d-id.com"
        self.headers = {
            "Authorization": f"Basic {api_key}",
            "Content-Type": "application/json"
        }

    def create_talk(
        self,
        audio_url: str,
        source_url: str = "https://d-id-public-bucket.s3.amazonaws.com/alice.jpg",
        driver_url: str = "bank://lively",
        webhook_url: Optional[str] = None
    ) -> Dict:
        """
        音声URLからトーク動画を生成

        Args:
            audio_url: 音声ファイルのURL（公開アクセス可能である必要がある）
            source_url: アバター画像のURL
            driver_url: アニメーションドライバー
            webhook_url: 完了時のWebhook URL

        Returns:
            {
                'id': 'talk-id',
                'status': 'created',
                'result_url': None  # 生成完了後に利用可能
            }
        """
        endpoint = f"{self.base_url}/talks"

        payload = {
            "script": {
                "type": "audio",
                "audio_url": audio_url
            },
            "source_url": source_url,
            "driver_url": driver_url,
            "config": {
                "fluent": True,
                "pad_audio": 0.0,
                "stitch": True
            }
        }

        if webhook_url:
            payload["webhook"] = webhook_url

        response = requests.post(endpoint, json=payload, headers=self.headers)
        response.raise_for_status()

        return response.json()

    def create_talk_from_text(
        self,
        text: str,
        voice_id: str = "en-US-JennyNeural",
        source_url: str = "https://d-id-public-bucket.s3.amazonaws.com/alice.jpg",
        driver_url: str = "bank://lively"
    ) -> Dict:
        """
        テキストから直接トーク動画を生成

        Args:
            text: 発話テキスト
            voice_id: 音声ID（Azure TTS互換）
            source_url: アバター画像のURL
            driver_url: アニメーションドライバー
        """
        endpoint = f"{self.base_url}/talks"

        payload = {
            "script": {
                "type": "text",
                "input": text,
                "provider": {
                    "type": "microsoft",
                    "voice_id": voice_id
                }
            },
            "source_url": source_url,
            "driver_url": driver_url,
            "config": {
                "fluent": True,
                "pad_audio": 0.0,
                "stitch": True
            }
        }

        response = requests.post(endpoint, json=payload, headers=self.headers)
        response.raise_for_status()

        return response.json()

    def get_talk(self, talk_id: str) -> Dict:
        """
        トーク動画の状態を取得

        Returns:
            {
                'id': 'talk-id',
                'status': 'done'|'created'|'started'|'error',
                'result_url': 'https://...mp4'  # status='done'の場合
            }
        """
        endpoint = f"{self.base_url}/talks/{talk_id}"

        response = requests.get(endpoint, headers=self.headers)
        response.raise_for_status()

        return response.json()

    def wait_for_completion(
        self,
        talk_id: str,
        timeout: int = 120,
        poll_interval: int = 2
    ) -> Optional[str]:
        """
        動画生成が完了するまで待機

        Args:
            talk_id: トークID
            timeout: タイムアウト（秒）
            poll_interval: ポーリング間隔（秒）

        Returns:
            result_url: 動画URL（成功時）
            None: タイムアウトまたはエラー時
        """
        start_time = time.time()

        while time.time() - start_time < timeout:
            result = self.get_talk(talk_id)
            status = result.get('status')

            if status == 'done':
                return result.get('result_url')
            elif status == 'error':
                print(f"❌ D-ID error: {result.get('error')}")
                return None

            time.sleep(poll_interval)

        print(f"⏱️ D-ID timeout after {timeout}s")
        return None

    def delete_talk(self, talk_id: str) -> bool:
        """トーク動画を削除"""
        endpoint = f"{self.base_url}/talks/{talk_id}"

        response = requests.delete(endpoint, headers=self.headers)
        return response.status_code == 200


def get_did_client() -> Optional[DIDClient]:
    """D-IDクライアントのインスタンスを取得"""
    api_key = os.getenv('D_ID_API_KEY')

    if not api_key:
        print("⚠️ D_ID_API_KEY not set")
        return None

    return DIDClient(api_key)


# ===== Week 7: キャッシング機能 =====

def generate_cache_key(text: str, voice_id: str, avatar_url: str) -> str:
    """
    キャッシュキーを生成

    Args:
        text: 発話テキスト
        voice_id: 音声ID
        avatar_url: アバター画像URL

    Returns:
        SHA256ハッシュ値（64文字）
    """
    # テキスト、音声ID、アバターURLを結合してハッシュ化
    combined = f"{text}||{voice_id}||{avatar_url}"
    return hashlib.sha256(combined.encode('utf-8')).hexdigest()


def get_cached_video(supabase_client, cache_key: str) -> Optional[Dict]:
    """
    キャッシュから動画を取得

    Args:
        supabase_client: Supabaseクライアント
        cache_key: キャッシュキー

    Returns:
        {
            'video_url': 'https://...',
            'hit_count': 10,
            ...
        } または None
    """
    try:
        result = supabase_client.table('video_cache').select('*').eq('cache_key', cache_key).execute()

        if result.data and len(result.data) > 0:
            cached_video = result.data[0]

            # ヒットカウントを増やす
            new_hit_count = cached_video.get('hit_count', 0) + 1
            supabase_client.table('video_cache').update({
                'hit_count': new_hit_count
            }).eq('cache_key', cache_key).execute()

            print(f"✅ キャッシュヒット: {cache_key[:16]}... (ヒット数: {new_hit_count})")
            return cached_video

        print(f"❌ キャッシュミス: {cache_key[:16]}...")
        return None

    except Exception as e:
        print(f"⚠️ キャッシュ取得エラー: {e}")
        return None


def save_video_to_cache(
    supabase_client,
    cache_key: str,
    text: str,
    voice_id: str,
    avatar_url: str,
    video_url: str,
    storage_path: str,
    file_size_bytes: int = 0,
    duration_seconds: float = 0
) -> bool:
    """
    生成した動画をキャッシュに保存

    Args:
        supabase_client: Supabaseクライアント
        cache_key: キャッシュキー
        text: 発話テキスト
        voice_id: 音声ID
        avatar_url: アバター画像URL
        video_url: 動画URL（Supabase Storage）
        storage_path: Storageパス
        file_size_bytes: ファイルサイズ
        duration_seconds: 動画の長さ

    Returns:
        成功: True, 失敗: False
    """
    try:
        supabase_client.table('video_cache').insert({
            'cache_key': cache_key,
            'text_content': text,
            'voice_id': voice_id,
            'avatar_url': avatar_url,
            'video_url': video_url,
            'storage_path': storage_path,
            'file_size_bytes': file_size_bytes,
            'duration_seconds': duration_seconds,
            'hit_count': 0
        }).execute()

        print(f"💾 キャッシュ保存完了: {cache_key[:16]}...")
        return True

    except Exception as e:
        print(f"⚠️ キャッシュ保存エラー: {e}")
        return False


def download_video_to_storage(supabase_client, video_url: str, cache_key: str) -> Optional[str]:
    """
    D-IDから動画をダウンロードしてSupabase Storageに保存

    Args:
        supabase_client: Supabaseクライアント
        video_url: D-IDの動画URL
        cache_key: キャッシュキー

    Returns:
        Supabase StorageのパブリックURL または None
    """
    try:
        # D-IDから動画をダウンロード
        response = requests.get(video_url, timeout=30)
        response.raise_for_status()
        video_data = response.content

        # Supabase Storageに保存
        storage_path = f"video_cache/{cache_key}.mp4"
        bucket_name = "videos"  # Supabaseバケット名（事前に作成が必要）

        # アップロード
        supabase_client.storage.from_(bucket_name).upload(
            storage_path,
            video_data,
            {
                "content-type": "video/mp4",
                "cache-control": "3600",
                "upsert": "true"
            }
        )

        # パブリックURLを取得
        public_url = supabase_client.storage.from_(bucket_name).get_public_url(storage_path)

        print(f"📤 動画をStorageに保存: {storage_path}")
        return public_url

    except Exception as e:
        print(f"⚠️ Storage保存エラー: {e}")
        return None
