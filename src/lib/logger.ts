/**
 * ロガーユーティリティ
 * 開発環境ではすべてのログを出力、本番環境ではエラーのみ出力
 */

const isDevelopment = import.meta.env.DEV;

/**
 * デバッグログ（開発環境のみ）
 */
export const debug = isDevelopment ? console.log.bind(console) : () => {};

/**
 * 情報ログ（開発環境のみ）
 */
export const info = isDevelopment ? console.info.bind(console) : () => {};

/**
 * 警告ログ（開発環境のみ）
 */
export const warn = isDevelopment ? console.warn.bind(console) : () => {};

/**
 * エラーログ（常に出力）
 */
export const error = console.error.bind(console);

/**
 * グループ化されたログ（開発環境のみ）
 */
export const group = isDevelopment ? console.group.bind(console) : () => {};
export const groupEnd = isDevelopment ? console.groupEnd.bind(console) : () => {};
export const groupCollapsed = isDevelopment ? console.groupCollapsed.bind(console) : () => {};

/**
 * デフォルトエクスポート
 */
const logger = {
  debug,
  info,
  warn,
  error,
  group,
  groupEnd,
  groupCollapsed,
};

export default logger;
