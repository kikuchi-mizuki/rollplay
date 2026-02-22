"""
月間コスト制限管理モジュール
月額1万円を超えないように使用量を制限します
"""

import logging
from datetime import datetime
from typing import Optional, Dict, Any
from flask import jsonify, Response

logger = logging.getLogger(__name__)

class CostLimiter:
    """
    月間使用量を監視し、予算上限に達したらサービスを制限するクラス

    想定コスト（2024年2月時点）:
    - GPT-4o-mini: $0.150/1M入力トークン, $0.600/1M出力トークン
    - Whisper: $0.006/分
    - Google Cloud TTS: $4.00/1M文字

    月間上限: ¥10,000（約$67 @ $1=¥150）
    """

    def __init__(self, monthly_budget_jpy: int = 10000):
        """
        Args:
            monthly_budget_jpy: 月間予算（円）
        """
        self.monthly_budget_jpy = monthly_budget_jpy
        self.exchange_rate = 150  # 1ドル = 150円（概算）
        self.monthly_budget_usd = monthly_budget_jpy / self.exchange_rate

        # 月間使用量カウンター（メモリベース - 本番環境ではRedis等を使用）
        self.usage = {
            'current_month': datetime.now().strftime('%Y-%m'),
            'gpt_requests': 0,
            'whisper_requests': 0,
            'tts_requests': 0,
            'video_requests': 0,
            'estimated_cost_usd': 0.0
        }

        # 各サービスの1リクエストあたりの推定コスト（USD）
        self.cost_per_request = {
            'gpt_chat': 0.001,        # GPT-4o-mini チャット（平均1000トークン想定）
            'gpt_eval': 0.003,        # GPT-4o-mini 評価（長文）
            'whisper': 0.003,         # Whisper 音声認識（平均30秒想定）
            'tts': 0.0008,            # TTS（平均200文字想定）
            'video': 0.05             # D-ID 動画生成（1リクエスト）
        }

        # 月間リクエスト上限（予算内に収まる計算）
        # 予算 $67 ÷ 混合平均コスト $0.002 ≈ 33,500リクエスト
        self.monthly_limits = {
            'gpt_chat': 20000,        # GPT チャット: 月2万回
            'gpt_eval': 5000,         # GPT 評価: 月5千回
            'whisper': 10000,         # Whisper: 月1万回
            'tts': 15000,             # TTS: 月1.5万回
            'video': 500              # 動画生成: 月500回
        }

    def check_month_reset(self):
        """月が変わったらカウンターをリセット"""
        current_month = datetime.now().strftime('%Y-%m')
        if self.usage['current_month'] != current_month:
            logger.info(f"📅 月次リセット: {self.usage['current_month']} → {current_month}")
            logger.info(f"前月使用量: GPT={self.usage['gpt_requests']}, "
                       f"Whisper={self.usage['whisper_requests']}, "
                       f"TTS={self.usage['tts_requests']}, "
                       f"推定コスト=${self.usage['estimated_cost_usd']:.2f}")

            self.usage = {
                'current_month': current_month,
                'gpt_requests': 0,
                'whisper_requests': 0,
                'tts_requests': 0,
                'video_requests': 0,
                'estimated_cost_usd': 0.0
            }

    def can_use_service(self, service_type: str) -> tuple[bool, Optional[str]]:
        """
        サービスが利用可能かチェック

        Args:
            service_type: 'gpt_chat', 'gpt_eval', 'whisper', 'tts', 'video'

        Returns:
            (利用可能か, エラーメッセージ)
        """
        self.check_month_reset()

        # サービスタイプのマッピング
        counter_map = {
            'gpt_chat': 'gpt_requests',
            'gpt_eval': 'gpt_requests',
            'whisper': 'whisper_requests',
            'tts': 'tts_requests',
            'video': 'video_requests'
        }

        counter_key = counter_map.get(service_type)
        if not counter_key:
            return True, None

        # 個別サービスの上限チェック
        current_count = self.usage.get(counter_key, 0)
        limit = self.monthly_limits.get(service_type, float('inf'))

        if current_count >= limit:
            remaining_days = self._get_remaining_days_in_month()
            return False, (
                f"月間利用上限に達しました。"
                f"次回リセット: {remaining_days}日後"
            )

        # 全体予算の上限チェック
        if self.usage['estimated_cost_usd'] >= self.monthly_budget_usd:
            remaining_days = self._get_remaining_days_in_month()
            return False, (
                f"月間予算に達しました。"
                f"次回リセット: {remaining_days}日後"
            )

        # 予算の90%に達したら警告
        usage_ratio = self.usage['estimated_cost_usd'] / self.monthly_budget_usd
        if usage_ratio >= 0.9:
            logger.warning(
                f"⚠️ 月間予算の{usage_ratio*100:.0f}%を使用済み "
                f"(${self.usage['estimated_cost_usd']:.2f}/${self.monthly_budget_usd:.2f})"
            )

        return True, None

    def record_usage(self, service_type: str):
        """
        サービス使用を記録

        Args:
            service_type: 'gpt_chat', 'gpt_eval', 'whisper', 'tts', 'video'
        """
        self.check_month_reset()

        # カウンターを増やす
        counter_map = {
            'gpt_chat': 'gpt_requests',
            'gpt_eval': 'gpt_requests',
            'whisper': 'whisper_requests',
            'tts': 'tts_requests',
            'video': 'video_requests'
        }

        counter_key = counter_map.get(service_type)
        if counter_key:
            self.usage[counter_key] = self.usage.get(counter_key, 0) + 1

        # コストを記録
        cost = self.cost_per_request.get(service_type, 0)
        self.usage['estimated_cost_usd'] += cost

        # 定期的にログ出力（100リクエストごと）
        total_requests = sum([
            self.usage.get('gpt_requests', 0),
            self.usage.get('whisper_requests', 0),
            self.usage.get('tts_requests', 0),
            self.usage.get('video_requests', 0)
        ])

        if total_requests % 100 == 0:
            logger.info(
                f"📊 月間使用状況: GPT={self.usage['gpt_requests']}, "
                f"Whisper={self.usage['whisper_requests']}, "
                f"TTS={self.usage['tts_requests']}, "
                f"Video={self.usage['video_requests']}, "
                f"推定コスト=${self.usage['estimated_cost_usd']:.2f} "
                f"(予算の{self.usage['estimated_cost_usd']/self.monthly_budget_usd*100:.1f}%)"
            )

    def get_usage_stats(self) -> Dict[str, Any]:
        """現在の使用状況を取得"""
        self.check_month_reset()

        return {
            'current_month': self.usage['current_month'],
            'budget': {
                'monthly_jpy': self.monthly_budget_jpy,
                'monthly_usd': self.monthly_budget_usd,
                'used_usd': self.usage['estimated_cost_usd'],
                'used_jpy': self.usage['estimated_cost_usd'] * self.exchange_rate,
                'remaining_jpy': self.monthly_budget_jpy - (self.usage['estimated_cost_usd'] * self.exchange_rate),
                'usage_percentage': (self.usage['estimated_cost_usd'] / self.monthly_budget_usd) * 100
            },
            'requests': {
                'gpt': self.usage.get('gpt_requests', 0),
                'whisper': self.usage.get('whisper_requests', 0),
                'tts': self.usage.get('tts_requests', 0),
                'video': self.usage.get('video_requests', 0)
            },
            'limits': self.monthly_limits
        }

    def _get_remaining_days_in_month(self) -> int:
        """今月の残り日数を取得"""
        now = datetime.now()
        if now.month == 12:
            next_month = datetime(now.year + 1, 1, 1)
        else:
            next_month = datetime(now.year, now.month + 1, 1)
        return (next_month - now).days


# グローバルインスタンス
cost_limiter = CostLimiter(monthly_budget_jpy=10000)


def require_budget(service_type: str):
    """
    予算チェックデコレータ

    Args:
        service_type: 'gpt_chat', 'gpt_eval', 'whisper', 'tts', 'video'
    """
    def decorator(func):
        def wrapper(*args, **kwargs):
            can_use, error_msg = cost_limiter.can_use_service(service_type)

            if not can_use:
                logger.warning(f"🚫 予算制限によりサービス拒否: {service_type}")
                return jsonify({
                    'success': False,
                    'error': error_msg,
                    'budget_exceeded': True
                }), 429

            # サービス実行
            result = func(*args, **kwargs)

            # 成功時のみ使用量を記録
            if isinstance(result, tuple):
                response, status_code = result
                if status_code == 200:
                    cost_limiter.record_usage(service_type)
            else:
                cost_limiter.record_usage(service_type)

            return result

        wrapper.__name__ = func.__name__
        return wrapper
    return decorator
