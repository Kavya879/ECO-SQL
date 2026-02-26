-- QueryCarbon Phase 1: Standalone tables (no conflict with existing schema)
-- Run against the app PostgreSQL instance

CREATE TABLE IF NOT EXISTS querycarbon_users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'Pro',
    region VARCHAR(10) DEFAULT 'IN',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO querycarbon_users (user_id, username, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'demo', 'demo@querycarbon.local')
ON CONFLICT (username) DO NOTHING;

CREATE TABLE IF NOT EXISTS querycarbon_analyses (
    query_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    database_type VARCHAR(50) DEFAULT 'PostgreSQL',
    query_string TEXT NOT NULL,
    query_fingerprint VARCHAR(64),
    analyzed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    runtime_ms DECIMAL(12, 4),
    runtime_source VARCHAR(20) DEFAULT 'measured',
    planner_cost DECIMAL(18, 2),
    rows_examined BIGINT,
    num_tables INTEGER,
    tables_involved TEXT[],
    explain_output JSONB,
    energy_kwh DECIMAL(18, 12),
    operational_co2_gco2eq DECIMAL(18, 6),
    embodied_co2_gco2eq DECIMAL(18, 6),
    sci_gco2eq_per_query DECIMAL(12, 4),
    sustainability_rating INTEGER,
    score NUMERIC(5, 2),
    score_breakdown JSONB,
    weights_snapshot JSONB,
    baselines_snapshot JSONB,
    tier VARCHAR(20),
    classification VARCHAR(50),
    pue DECIMAL(5, 2),
    grid_carbon_intensity DECIMAL(10, 4),
    cpu_cores INTEGER,
    ram_gb INTEGER,
    cpu_utilization DECIMAL(5, 2),
    te_gco2eq DECIMAL(18, 2),
    el_hours DECIMAL(12, 2),
    rr DECIMAL(5, 2)
);

CREATE INDEX IF NOT EXISTS idx_qc_analyses_fingerprint ON querycarbon_analyses(query_fingerprint);
CREATE INDEX IF NOT EXISTS idx_qc_analyses_analyzed_at ON querycarbon_analyses(analyzed_at);
