"""
入力バリデーション用のユーティリティモジュール
"""

from typing import Any, Dict, Optional
from flask import jsonify, Response


def validate_json_size(data: Any, max_size_mb: int = 10) -> Optional[Response]:
    """
    JSONデータのサイズを検証する

    Args:
        data: 検証するデータ
        max_size_mb: 最大サイズ（MB）

    Returns:
        エラーがあればエラーレスポンス、なければNone
    """
    import sys
    size_bytes = sys.getsizeof(str(data))
    max_bytes = max_size_mb * 1024 * 1024

    if size_bytes > max_bytes:
        return jsonify({
            'success': False,
            'error': f'リクエストデータが大きすぎます（最大: {max_size_mb}MB）'
        }), 413

    return None


def validate_string_field(
    data: Dict[str, Any],
    field_name: str,
    required: bool = True,
    max_length: Optional[int] = None,
    min_length: Optional[int] = None
) -> Optional[Response]:
    """
    文字列フィールドのバリデーション

    Args:
        data: 検証するデータ辞書
        field_name: フィールド名
        required: 必須かどうか
        max_length: 最大文字数
        min_length: 最小文字数

    Returns:
        エラーがあればエラーレスポンス、なければNone
    """
    if field_name not in data:
        if required:
            return jsonify({
                'success': False,
                'error': f'{field_name}は必須です'
            }), 400
        return None

    value = data[field_name]

    if not isinstance(value, str):
        return jsonify({
            'success': False,
            'error': f'{field_name}は文字列である必要があります'
        }), 400

    if max_length is not None and len(value) > max_length:
        return jsonify({
            'success': False,
            'error': f'{field_name}は{max_length}文字以下である必要があります'
        }), 400

    if min_length is not None and len(value) < min_length:
        return jsonify({
            'success': False,
            'error': f'{field_name}は{min_length}文字以上である必要があります'
        }), 400

    return None


def validate_integer_field(
    data: Dict[str, Any],
    field_name: str,
    required: bool = True,
    min_value: Optional[int] = None,
    max_value: Optional[int] = None
) -> Optional[Response]:
    """
    整数フィールドのバリデーション

    Args:
        data: 検証するデータ辞書
        field_name: フィールド名
        required: 必須かどうか
        min_value: 最小値
        max_value: 最大値

    Returns:
        エラーがあればエラーレスポンス、なければNone
    """
    if field_name not in data:
        if required:
            return jsonify({
                'success': False,
                'error': f'{field_name}は必須です'
            }), 400
        return None

    value = data[field_name]

    if not isinstance(value, int):
        return jsonify({
            'success': False,
            'error': f'{field_name}は整数である必要があります'
        }), 400

    if min_value is not None and value < min_value:
        return jsonify({
            'success': False,
            'error': f'{field_name}は{min_value}以上である必要があります'
        }), 400

    if max_value is not None and value > max_value:
        return jsonify({
            'success': False,
            'error': f'{field_name}は{max_value}以下である必要があります'
        }), 400

    return None


def validate_list_field(
    data: Dict[str, Any],
    field_name: str,
    required: bool = True,
    max_items: Optional[int] = None
) -> Optional[Response]:
    """
    リストフィールドのバリデーション

    Args:
        data: 検証するデータ辞書
        field_name: フィールド名
        required: 必須かどうか
        max_items: 最大要素数

    Returns:
        エラーがあればエラーレスポンス、なければNone
    """
    if field_name not in data:
        if required:
            return jsonify({
                'success': False,
                'error': f'{field_name}は必須です'
            }), 400
        return None

    value = data[field_name]

    if not isinstance(value, list):
        return jsonify({
            'success': False,
            'error': f'{field_name}はリストである必要があります'
        }), 400

    if max_items is not None and len(value) > max_items:
        return jsonify({
            'success': False,
            'error': f'{field_name}の要素数は{max_items}以下である必要があります'
        }), 400

    return None
