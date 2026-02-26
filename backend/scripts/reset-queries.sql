-- Drop and recreate queries table (use if existing schema is incompatible)
DROP TABLE IF EXISTS optimization_suggestions;
DROP TABLE IF EXISTS queries;

CREATE TABLE queries (
    query_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id),
    connection_id UUID REFERENCES db_connections(connection_id),
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
    optimized_from_query_id UUID REFERENCES queries(query_id),
    pue DECIMAL(5, 2),
    grid_carbon_intensity DECIMAL(10, 4),
    cpu_cores INTEGER,
    ram_gb INTEGER,
    cpu_utilization DECIMAL(5, 2),
    te_gco2eq DECIMAL(18, 2),
    el_hours DECIMAL(12, 2),
    rr DECIMAL(5, 2)
);

CREATE INDEX idx_queries_analyzed_at ON queries(analyzed_at);
CREATE INDEX idx_queries_classification ON queries(classification);
CREATE INDEX idx_queries_tier ON queries(tier);
CREATE INDEX idx_queries_fingerprint ON queries(query_fingerprint);
CREATE INDEX idx_queries_user ON queries(user_id);

CREATE TABLE optimization_suggestions (
    suggestion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id UUID NOT NULL REFERENCES queries(query_id),
    type VARCHAR(50) NOT NULL,
    confidence VARCHAR(20),
    details JSONB NOT NULL,
    cost_delta DECIMAL(18, 2),
    sci_delta DECIMAL(12, 4),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
