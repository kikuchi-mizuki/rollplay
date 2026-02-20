-- 本部（本社）店舗を追加
-- 店舗コードに「ADMIN」を含む場合は管理者権限を自動付与

INSERT INTO stores (store_code, store_name, region, status) VALUES
  ('ADMIN_HQ', '本部', '本部', 'active')
ON CONFLICT (store_code) DO NOTHING;

COMMENT ON TABLE stores IS '店舗マスタ（店舗コードに「ADMIN」を含む場合は管理者として扱う）';
