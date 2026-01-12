import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * 画面共有のエラータイプ
 */
export type ScreenShareError =
  | 'NotAllowedError'    // 画面共有が拒否された
  | 'NotFoundError'      // 画面共有可能な画面がない
  | 'NotReadableError'   // 画面が使用中
  | 'UnknownError';      // その他のエラー

/**
 * 画面共有カスタムフック
 *
 * Phase 2 Day 3: 画面共有機能の実装
 * - navigator.mediaDevices.getDisplayMedia() を使用して画面共有
 * - エラーハンドリング（NotAllowedError, NotFoundError）
 * - 画面共有停止の自動検知
 *
 * @returns 画面共有ストリーム、状態、制御関数
 */
export function useScreenShare() {
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState<ScreenShareError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const screenVideoRef = useRef<HTMLVideoElement>(null);

  /**
   * 画面共有を開始
   *
   * 要件:
   * - 画面共有ボタンをクリックすると、ブラウザの選択ダイアログが表示される
   * - ユーザーが共有対象を選択できる（デスクトップ、ウィンドウ、タブ）
   * - 選択後、MediaPanel内に画面共有映像が表示される
   * - 画面共有中は「共有中」インジケーターが表示される
   */
  const startScreenShare = useCallback(async () => {
    setIsLoading(true);
    setScreenShareError(null);

    try {
      console.log('🖥️ 画面共有開始...');

      // 画面共有要求
      // surfaceSwitching: 共有中に別の画面に切り替え可能（Chrome 107+）
      // selfBrowserSurface: 'exclude'で自分自身のタブを除外（資料共有用途）
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 3840 },  // 4K対応
          height: { ideal: 1080, max: 2160 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false, // 画面共有の音声は不要（カメラのマイク音声を使用）
        // @ts-ignore - Chrome拡張プロパティ（TypeScript型定義に未対応）
        surfaceSwitching: 'include', // 共有中に他の画面に切り替え可能
        // @ts-ignore
        selfBrowserSurface: 'exclude', // 自分自身のタブを選択肢から除外（資料共有用）
      } as any);

      // 画面共有の詳細情報を取得
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();

      console.log('✅ 画面共有開始成功');
      console.log('  解像度:', `${settings.width}x${settings.height}`);
      console.log('  フレームレート:', settings.frameRate);
      console.log('  デバイスID:', videoTrack.id);
      console.log('  ラベル:', videoTrack.label);

      // displaySurface情報があれば表示（どの種類の画面か）
      // @ts-ignore - Chrome拡張プロパティ
      if (settings.displaySurface) {
        // @ts-ignore
        console.log('  表示タイプ:', settings.displaySurface); // 'monitor' | 'window' | 'browser'
      }

      // @ts-ignore - Chrome拡張プロパティ
      if (settings.logicalSurface !== undefined) {
        // @ts-ignore
        console.log('  論理サーフェス:', settings.logicalSurface);
      }

      setScreenStream(stream);
      setIsScreenSharing(true);

      // video要素にストリームを設定
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        console.log('✅ 画面共有プレビュー表示準備完了');
      }

      // 画面共有が停止されたら自動検知（ユーザーがブラウザのボタンで停止した場合）
      stream.getVideoTracks()[0].onended = () => {
        console.log('🛑 画面共有が停止されました（ユーザー操作）');
        stopScreenShare();
      };

    } catch (error: any) {
      console.error('❌ 画面共有エラー:', error);

      // エラータイプを判定
      if (error.name === 'NotAllowedError') {
        setScreenShareError('NotAllowedError');
        console.log('  画面共有がキャンセルされました');
      } else if (error.name === 'NotFoundError') {
        setScreenShareError('NotFoundError');
        console.error('  画面共有可能な画面が見つかりません');
      } else if (error.name === 'NotReadableError') {
        setScreenShareError('NotReadableError');
        console.error('  画面が使用中です');
      } else {
        setScreenShareError('UnknownError');
        console.error('  不明なエラー:', error.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 画面共有を停止
   */
  const stopScreenShare = useCallback(() => {
    if (screenStream) {
      console.log('🛑 画面共有停止');

      // すべてのトラックを停止
      screenStream.getTracks().forEach(track => {
        track.stop();
        console.log(`  ${track.kind} トラック停止:`, track.label);
      });

      setScreenStream(null);
      setIsScreenSharing(false);

      // video要素のストリームをクリア
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }

      console.log('✅ 画面共有停止完了');
    }
  }, [screenStream]);

  /**
   * エラーメッセージを取得
   */
  const getErrorMessage = useCallback((): string | null => {
    if (!screenShareError) return null;

    switch (screenShareError) {
      case 'NotAllowedError':
        return null; // キャンセルは通常のユーザー操作なのでエラーメッセージを表示しない
      case 'NotFoundError':
        return '画面共有可能な画面が見つかりません。';
      case 'NotReadableError':
        return '画面が使用中です。他のアプリケーションを閉じてください。';
      case 'UnknownError':
        return '画面共有に失敗しました。ページを再読み込みしてください。';
      default:
        return '不明なエラーが発生しました。';
    }
  }, [screenShareError]);

  /**
   * video要素のsrcObjectを設定
   * DOMが準備できた後に実行される（React useEffect）
   */
  useEffect(() => {
    if (isScreenSharing && screenStream && screenVideoRef.current) {
      screenVideoRef.current.srcObject = screenStream;
      console.log('✅ 画面共有プレビュー表示準備完了（useEffect）');
    } else if (!isScreenSharing && screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
      console.log('🧹 画面共有プレビュークリア（useEffect）');
    }
  }, [isScreenSharing, screenStream]);

  return {
    screenStream,
    isScreenSharing,
    screenShareError,
    isLoading,
    screenVideoRef,
    startScreenShare,
    stopScreenShare,
    getErrorMessage,
  };
}
