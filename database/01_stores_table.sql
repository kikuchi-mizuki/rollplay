-- 店舗マスタテーブル
-- Week 1 Day 3: データベース設計

CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code TEXT UNIQUE NOT NULL,
  store_name TEXT NOT NULL,
  region TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_store_code ON stores(store_code);
CREATE INDEX IF NOT EXISTS idx_region ON stores(region);
CREATE INDEX IF NOT EXISTS idx_status ON stores(status);

-- サンプルデータ挿入
INSERT INTO stores (store_code, store_name, region, status) VALUES
  ('STORE_001', '東京銀座店', '関東', 'active'),
  ('STORE_002', '大阪梅田店', '関西', 'active'),
  ('STORE_003', '福岡天神店', '九州', 'active')
ON CONFLICT (store_code) DO NOTHING;

-- 更新日時の自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE stores IS '店舗マスタ（フランチャイズ各店舗の情報）';
COMMENT ON COLUMN stores.store_code IS '店舗コード（STORE_001形式）';
COMMENT ON COLUMN stores.store_name IS '店舗名（東京銀座店など）';
COMMENT ON COLUMN stores.region IS '地域（関東、関西など）';
COMMENT ON COLUMN stores.status IS 'ステータス（active/inactive）';
