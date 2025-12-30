"""
静的ファイル配信ブループリント
フロントエンド（React）とアセットファイルの配信を提供
"""
import os
from flask import Blueprint, render_template, send_from_directory, jsonify

# Blueprintオブジェクト作成（url_prefixなし - ルートパスを扱うため）
static_bp = Blueprint('static_routes', __name__)

# グローバル変数（init_blueprintで設定）
app_root = None


def init_blueprint(app):
    """
    ブループリント初期化
    app.pyから必要な設定を受け取る
    """
    global app_root
    app_root = app.root_path


@static_bp.route('/')
def index():
    """Reactアプリを配信（distディレクトリが存在する場合）"""
    dist_path = os.path.join(os.path.dirname(__file__), '..', 'dist', 'index.html')
    if os.path.exists(dist_path):
        with open(dist_path, 'r', encoding='utf-8') as f:
            return f.read()
    # フォールバック: 従来のHTMLテンプレート
    return render_template('index.html')


@static_bp.route('/favicon.ico')
def favicon():
    try:
        static_dir = os.path.join(app_root or os.path.dirname(__file__), 'static')
        icon_file = 'favicon.ico'
        icon_path = os.path.join(static_dir, icon_file)
        if os.path.exists(icon_path):
            return send_from_directory(static_dir, icon_file)
        # アイコンが無い場合は 204 で黙って返す（コンソールエラー回避）
        return ('', 204)
    except Exception:
        return ('', 204)


# 一部ブラウザ/キャッシュが /static/favicon.ico を参照する場合のフォールバック
@static_bp.route('/static/favicon.ico')
def static_favicon_fallback():
    return ('', 204)


@static_bp.route('/assets/<path:filename>')
def serve_assets(filename):
    """Viteでビルドされたアセットファイルを配信"""
    assets_path = os.path.join(os.path.dirname(__file__), '..', 'dist', 'assets')
    return send_from_directory(assets_path, filename)


# キャッチオールルート: React Routerのクライアント側ルーティングをサポート
@static_bp.route('/<path:path>')
def catch_all(path):
    """
    APIルート以外のすべてのパスでindex.htmlを返す
    これによりReact Routerがクライアント側でルーティングを処理できる
    """
    print(f"🔍 Catch-all route called with path: {path}")

    # APIルートは除外
    if path.startswith('api/'):
        print(f"❌ API route, returning 404: {path}")
        return jsonify({'error': 'Not found'}), 404

    # メディアファイル（動画・画像）を配信
    if path.endswith(('.mp4', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico')):
        dist_path = os.path.join(os.path.dirname(__file__), '..', 'dist')
        file_path = os.path.join(dist_path, path)
        if os.path.exists(file_path):
            print(f"📹 Serving media file: {path}")
            return send_from_directory(dist_path, path)

    # distディレクトリのindex.htmlを返す
    dist_index = os.path.join(os.path.dirname(__file__), '..', 'dist', 'index.html')
    print(f"📁 Looking for index.html at: {dist_index}")
    print(f"✅ File exists: {os.path.exists(dist_index)}")

    if os.path.exists(dist_index):
        print(f"✅ Serving index.html for path: {path}")
        with open(dist_index, 'r', encoding='utf-8') as f:
            return f.read()

    print(f"❌ index.html not found at: {dist_index}")
    return jsonify({'error': 'Frontend not built', 'path': path}), 404
