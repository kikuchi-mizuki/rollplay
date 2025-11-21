# ベースイメージ: Python 3.11
FROM python:3.11-slim

# ビルド引数として環境変数を受け取る
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_BASE_URL

# 環境変数として設定
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# 作業ディレクトリを設定
WORKDIR /app

# 必要なシステムパッケージをインストール
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    wget \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node.js 18.xを公式バイナリから直接インストール
RUN curl -fsSL https://nodejs.org/dist/v18.19.0/node-v18.19.0-linux-x64.tar.xz -o node.tar.xz \
    && tar -xJf node.tar.xz -C /usr/local --strip-components=1 \
    && rm node.tar.xz \
    && node --version \
    && npm --version

# Python依存関係をコピーしてインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# フロントエンド依存関係をコピーしてインストール
COPY package*.json ./
RUN npm install

# プロジェクトファイルをコピー
COPY . .

# フロントエンドをビルド（環境変数がビルドに含まれる）
RUN npm run build

# ポートを公開
EXPOSE 5000

# アプリケーションを起動
CMD ["python", "app.py"]
