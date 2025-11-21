-- Week 7: パフォーマンス最適化 - インデックス追加
-- 100店舗同時利用に対応するため、頻繁にクエリされるカラムにインデックスを追加

-- ===== conversations テーブル =====

-- user_id, store_id, scenario_idでの検索を高速化
CREATE INDEX IF NOT EXISTS idx_conversations_user_id_created
  ON conversations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_store_id_created
  ON conversations(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_scenario_id_created
  ON conversations(scenario_id, created_at DESC);

-- 複合インデックス: user_id + scenario_id（履歴取得の最適化）
CREATE INDEX IF NOT EXISTS idx_conversations_user_scenario
  ON conversations(user_id, scenario_id, created_at DESC);

-- 複合インデックス: store_id + scenario_id（店舗別分析の最適化）
CREATE INDEX IF NOT EXISTS idx_conversations_store_scenario
  ON conversations(store_id, scenario_id, created_at DESC);


-- ===== evaluations テーブル =====

-- user_id, store_id, scenario_idでの検索を高速化
CREATE INDEX IF NOT EXISTS idx_evaluations_user_id_created
  ON evaluations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evaluations_store_id_created
  ON evaluations(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evaluations_scenario_id_created
  ON evaluations(scenario_id, created_at DESC);

-- 複合インデックス: user_id + scenario_id（履歴取得の最適化）
CREATE INDEX IF NOT EXISTS idx_evaluations_user_scenario
  ON evaluations(user_id, scenario_id, created_at DESC);

-- 複合インデックス: store_id + scenario_id（店舗別分析の最適化）
CREATE INDEX IF NOT EXISTS idx_evaluations_store_scenario
  ON evaluations(store_id, scenario_id, created_at DESC);

-- 平均スコアでのソート（ランキング取得の最適化）
CREATE INDEX IF NOT EXISTS idx_evaluations_avg_score
  ON evaluations(average_score DESC);


-- ===== profiles テーブル =====

-- store_idでの検索を高速化（店舗メンバー取得）
CREATE INDEX IF NOT EXISTS idx_profiles_store_id
  ON profiles(store_id);

-- roleでの検索を高速化（管理者検索）
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON profiles(role);

-- メールアドレスでの検索（既に UNIQUE 制約あり）


-- ===== stores テーブル =====

-- regionでの検索を高速化（リージョン別集計）
CREATE INDEX IF NOT EXISTS idx_stores_region
  ON stores(region);

-- store_codeでの検索（既に UNIQUE 制約あり）

-- statusでの検索を高速化（アクティブな店舗の絞り込み）
CREATE INDEX IF NOT EXISTS idx_stores_status
  ON stores(status);


-- ===== instructor_evaluations テーブル =====

-- Week 5で作成されたテーブルのインデックスは既に十分


-- ===== VACUUM と ANALYZE =====

-- 定期的なメンテナンスコマンド（手動実行またはcronで設定）
-- VACUUM ANALYZE conversations;
-- VACUUM ANALYZE evaluations;
-- VACUUM ANALYZE profiles;
-- VACUUM ANALYZE stores;
-- VACUUM ANALYZE video_cache;

COMMENT ON INDEX idx_conversations_user_scenario IS 'ユーザー別・シナリオ別の会話履歴取得を高速化';
COMMENT ON INDEX idx_evaluations_store_scenario IS '店舗別・シナリオ別の評価データ取得を高速化';
COMMENT ON INDEX idx_evaluations_avg_score IS 'スコアランキング取得を高速化';
