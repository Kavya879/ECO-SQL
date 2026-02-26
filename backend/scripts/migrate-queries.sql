-- Migration: Add Phase 1 columns to queries table if missing
-- Run if init-schema.sql reported "already exists" and queries table has old schema

ALTER TABLE queries ADD COLUMN IF NOT EXISTS database_type VARCHAR(50) DEFAULT 'PostgreSQL';
ALTER TABLE queries ADD COLUMN IF NOT EXISTS query_fingerprint VARCHAR(64);
ALTER TABLE queries ADD COLUMN IF NOT EXISTS runtime_source VARCHAR(20) DEFAULT 'measured';
ALTER TABLE queries ADD COLUMN IF NOT EXISTS planner_cost DECIMAL(18, 2);
ALTER TABLE queries ADD COLUMN IF NOT EXISTS rows_examined BIGINT;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS score NUMERIC(5, 2);
ALTER TABLE queries ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS weights_snapshot JSONB;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS baselines_snapshot JSONB;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS tier VARCHAR(20);
ALTER TABLE queries ADD COLUMN IF NOT EXISTS te_gco2eq DECIMAL(18, 2);
ALTER TABLE queries ADD COLUMN IF NOT EXISTS el_hours DECIMAL(12, 2);
ALTER TABLE queries ADD COLUMN IF NOT EXISTS rr DECIMAL(5, 2);

CREATE INDEX IF NOT EXISTS idx_queries_fingerprint ON queries(query_fingerprint);
CREATE INDEX IF NOT EXISTS idx_queries_tier ON queries(tier);
