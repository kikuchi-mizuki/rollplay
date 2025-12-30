/**
 * APIエラークラス
 * バックエンドAPIからのエラーを適切に処理するためのカスタムエラー
 */

export class APIError extends Error {
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(message: string, statusCode: number, details?: any) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.details = details;
  }

  /**
   * ユーザーフレンドリーなエラーメッセージを取得
   */
  getUserMessage(): string {
    if (this.statusCode >= 500) {
      return 'サーバーエラーが発生しました。しばらく待ってから再度お試しください。';
    } else if (this.statusCode === 400) {
      return this.message || '入力内容に誤りがあります。';
    } else if (this.statusCode === 401) {
      return '認証が必要です。ログインしてください。';
    } else if (this.statusCode === 403) {
      return 'この操作を実行する権限がありません。';
    } else if (this.statusCode === 404) {
      return '要求されたデータが見つかりませんでした。';
    } else {
      return this.message || '予期しないエラーが発生しました。';
    }
  }
}

/**
 * ネットワークエラークラス
 */
export class NetworkError extends Error {
  constructor(message: string = 'ネットワークエラーが発生しました') {
    super(message);
    this.name = 'NetworkError';
  }

  getUserMessage(): string {
    return 'ネットワーク接続を確認してください。';
  }
}

/**
 * タイムアウトエラークラス
 */
export class TimeoutError extends Error {
  constructor(message: string = 'リクエストがタイムアウトしました') {
    super(message);
    this.name = 'TimeoutError';
  }

  getUserMessage(): string {
    return '処理に時間がかかりすぎています。もう一度お試しください。';
  }
}

/**
 * フェッチリクエストを実行し、エラーを適切に処理
 */
export async function fetchWithErrorHandling(
  url: string,
  options?: RequestInit,
  timeout: number = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // HTTPステータスコードのチェック
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new APIError(
        errorData.error || `HTTPエラー: ${response.status}`,
        response.status,
        errorData
      );
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    // AbortError（タイムアウト）
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError();
    }

    // ネットワークエラー（fetch失敗）
    if (error instanceof TypeError) {
      throw new NetworkError('サーバーに接続できませんでした');
    }

    // 既にカスタムエラーの場合はそのままスロー
    if (error instanceof APIError || error instanceof NetworkError || error instanceof TimeoutError) {
      throw error;
    }

    // その他のエラー
    throw new APIError(
      error instanceof Error ? error.message : '予期しないエラーが発生しました',
      500
    );
  }
}

/**
 * エラーをユーザーフレンドリーなメッセージに変換
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof APIError || error instanceof NetworkError || error instanceof TimeoutError) {
    return error.getUserMessage();
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '予期しないエラーが発生しました';
}
