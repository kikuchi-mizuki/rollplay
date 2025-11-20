"""
D-ID API クライアント
テキストまたは音声からリップシンク動画を生成
"""
import os
import requests
import time
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
