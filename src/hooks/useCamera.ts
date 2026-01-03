import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * カメラアクセスのエラータイプ
 */
export type CameraError =
  | 'NotFoundError'      // カメラが見つからない
  | 'NotAllowedError'    // カメラアクセスが拒否された
  | 'NotReadableError'   // カメラが使用中
  | 'UnknownError';      // その他のエラー

/**
 * カメラアクセスカスタムフック
 *
 * Phase 2: カメラ録画機能の実装
 * - navigator.mediaDevices.getUserMedia() を使用してカメラアクセス
 * - エラーハンドリング（NotFoundError, NotAllowedError）
 * - カメラプレビュー表示
 *
 * @returns カメラストリーム、状態、制御関数
 */
export function useCamera() {
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);

  /**
   * カメラアクセスを開始
   *
   * 要件:
   * - カメラアクセス許可ダイアログが表示される
   * - 許可後、カメラ映像がリアルタイムでプレビューされる
   * - カメラが見つからない場合、エラーメッセージを表示
   */
  const startCamera = useCallback(async () => {
    setIsLoading(true);
    setCameraError(null);

    try {
      console.log('🎥 カメラアクセス開始...');

      // カメラアクセス要求
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user', // フロントカメラ
        },
        audio: true, // マイク音声も取得（録画用）
      });

      console.log('✅ カメラアクセス成功');
      console.log('  解像度:', stream.getVideoTracks()[0].getSettings());

      setCameraStream(stream);
      setIsCameraActive(true);

      // video要素にストリームを設定
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        console.log('✅ カメラプレビュー表示準備完了');
      }

    } catch (error: any) {
      console.error('❌ カメラアクセスエラー:', error);

      // エラータイプを判定
      if (error.name === 'NotFoundError') {
        setCameraError('NotFoundError');
        console.error('  カメラが検出されませんでした');
      } else if (error.name === 'NotAllowedError') {
        setCameraError('NotAllowedError');
        console.error('  カメラへのアクセスが拒否されました');
      } else if (error.name === 'NotReadableError') {
        setCameraError('NotReadableError');
        console.error('  カメラが使用中です');
      } else {
        setCameraError('UnknownError');
        console.error('  不明なエラー:', error.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * カメラアクセスを停止
   */
  const stopCamera = useCallback(() => {
    if (cameraStream) {
      console.log('🛑 カメラアクセス停止');

      // すべてのトラックを停止
      cameraStream.getTracks().forEach(track => {
        track.stop();
        console.log(`  ${track.kind} トラック停止:`, track.label);
      });

      setCameraStream(null);
      setIsCameraActive(false);

      // video要素のストリームをクリア
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = null;
      }

      console.log('✅ カメラアクセス停止完了');
    }
  }, [cameraStream]);

  /**
   * エラーメッセージを取得
   */
  const getErrorMessage = useCallback((): string | null => {
    if (!cameraError) return null;

    switch (cameraError) {
      case 'NotFoundError':
        return 'カメラが検出されませんでした。カメラが接続されているか確認してください。';
      case 'NotAllowedError':
        return 'カメラへのアクセスが拒否されました。ブラウザの設定を確認してください。';
      case 'NotReadableError':
        return 'カメラが使用中です。他のアプリケーションを閉じてください。';
      case 'UnknownError':
        return 'カメラアクセスに失敗しました。ページを再読み込みしてください。';
      default:
        return '不明なエラーが発生しました。';
    }
  }, [cameraError]);

  /**
   * video要素のsrcObjectを設定
   * DOMが準備できた後に実行される（React useEffect）
   */
  useEffect(() => {
    if (isCameraActive && cameraStream && cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = cameraStream;
      console.log('✅ カメラプレビュー表示準備完了（useEffect）');
    } else if (!isCameraActive && cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
      console.log('🧹 カメラプレビュークリア（useEffect）');
    }
  }, [isCameraActive, cameraStream]);

  return {
    cameraStream,
    isCameraActive,
    cameraError,
    isLoading,
    cameraVideoRef,
    startCamera,
    stopCamera,
    getErrorMessage,
  };
}
