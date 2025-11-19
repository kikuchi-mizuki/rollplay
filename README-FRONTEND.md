# 営業ロープレBot - フロントエンド

React + Vite + TypeScript + Tailwind CSS で構築された営業ロープレBotのフロントエンドアプリケーションです。

## 概要

商用レベルの品質とアクセシビリティを備えた営業ロープレBotのUI。レスポンシブデザインで、デスクトップ・タブレット・モバイルに対応しています。

## 技術スタック

- **React 18** - UIライブラリ
- **TypeScript** - 型安全性
- **Vite** - ビルドツール
- **Tailwind CSS** - ユーティリティファーストCSS
- **lucide-react** - アイコンライブラリ

## セットアップ

### 依存関係のインストール

```bash
npm install
```

### 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:3000` が自動的に開きます。

### ビルド

```bash
npm run build
```

ビルド結果は `dist` ディレクトリに出力されます。

### プレビュー

```bash
npm run preview
```

## プロジェクト構造

```
src/
  components/
    Header.tsx              # ヘッダーコンポーネント
    ChatPanel/              # チャットパネル関連
      MessageList.tsx       # メッセージリスト
      MessageBubble.tsx     # メッセージバブル
      EmptyState.tsx        # 空状態
    MediaPanel.tsx          # メディアプレビューパネル
    Composer.tsx            # 入力コンポーネント
    EvaluationSheet.tsx     # 講評シート
    ConfirmDialog.tsx       # 確認ダイアログ
    Toast.tsx               # トースト通知
  lib/
    fakeApi.ts              # モックAPI
    audio.ts                # 録音ユーティリティ
  App.tsx                   # メインアプリケーション
  main.tsx                  # エントリーポイント
  index.css                 # グローバルスタイル
  types.ts                  # 型定義
```

## デザインシステム

### カラーパレット

- **Primary**: `#6C5CE7` - メインアクションカラー
- **Secondary**: `#A29BFE` - サブアクションカラー
- **Success**: `#00C48C` - 成功状態
- **Warn**: `#FFA826` - 警告状態
- **Danger**: `#FF6B6B` - エラー状態

### フォント

- **System Font Stack**: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`

### レスポンシブブレークポイント

- **sm**: 640px以下（モバイル）
- **md**: 768px以上（タブレット）
- **lg**: 1024px以上（デスクトップ）

### レイアウト

- **デスクトップ (≥1024px)**: 2カラムレイアウト（チャット: 映像 = 6:4）
- **タブレット (768px-1023px)**: 1カラムレイアウト（上：チャット、下：映像）
- **モバイル (<768px)**: 1カラムレイアウト（映像は折りたたみ）

## 主要機能

### チャット機能

- メッセージの送受信
- 連続発言のグルーピング
- メッセージのコピー機能
- 自動スクロール

### 音声録音

- 長押しまたはトグルで録音開始/停止
- 録音中の波形アニメーション
- 録音時間の表示

### 講評機能

- 総評、良かった点、改善点、スコアのタブ表示
- 講評内容のコピー機能

### アクセシビリティ

- キーボード操作対応（Tab、Enter、Esc）
- フォーカスリング表示
- ARIA属性の適切な使用
- コントラスト比 AA 以上

## 開発ガイド

### スタイリング

Tailwind CSSのユーティリティクラスと、`index.css`で定義されたカスタムクラスを使用します。

```css
.btn.btn-primary  /* 主要ボタン */
.card              /* カードコンポーネント */
.message-bubble-bot  /* Botメッセージバブル */
```

### 型定義

すべてのコンポーネントと関数にTypeScript型を定義しています。型定義は `src/types.ts` にあります。

### モックAPI

開発環境では `src/lib/fakeApi.ts` のモック関数を使用します。実際のAPIと統合する際は、このファイルを更新してください。

## 今後の拡張

- 実際のバックエンドAPIとの統合
- 実際の音声録音・認識機能の実装
- 動画・画像の実際の表示機能
- ダークモード対応の完全実装
- 多言語対応

## ライセンス

このプロジェクトは営業ロープレBotプロジェクトの一部です。

