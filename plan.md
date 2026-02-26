# QueryCarbon — Production Plan

**SQL query optimization and carbon emissions estimation tool**

**Tech Stack:** Node.js + Express (backend), React (frontend), PostgreSQL × 2 (dataset under analysis + app log/metadata store).

---

## Image-Derived UI Inventory

| Screen | Components | Navigation Flow |
|--------|------------|-----------------|
| **Dashboard** | KPI cards (Total Queries, Avg gCO2, Sustainability Score, Total CO2 Saved), Emissions Trend chart (Daily/Weekly/Monthly), Recent Queries list, Date range selector, Export Report, Notifications | Entry point; links to Analyze Query, Reports, Settings |
| **Analyze Query** | SQL Query Editor, Hardware Config panel (CPU, RAM, PUE, Grid Intensity, etc.), Analysis Results panel, Analyze/Clear/Load Sample buttons | Central analysis flow; results show in Analysis Results panel + Emission Analysis Complete modal |
| **Emission Analysis Complete** | Classification tag (SUSTAINABLE/MODERATE/HIGH IMPACT), semi-circular gauge (0–2, 2–5, 5+ gCO2), Sustainability Rating (0–100), Energy/Operational/Embodied CO2 cards, Export & Optimize Query buttons | Post-analysis modal; Optimize Query → Phase 3 |
| **Reports** | Summary cards (Total Queries, Total CO2 Emitted, High Impact, Sustainable), filterable/sortable table, Search, Export CSV, pagination | Historical view; drill-down to query details implied |

---

## Resolved Design Decisions

### Embodied Emissions Defaults (ISO/IEC 21031:2024)

| Param | Meaning | Default |
|-------|---------|---------|
| **TE** | Total Embodied Carbon of hardware (gCO2eq) | 1,600,000 (mid-range server, e.g. Dell PowerEdge R740; Dell PCF / Boavizta) |
| **EL** | Expected hardware lifespan (hours) | 35,040 (4 years) |
| **TiR** | Time in use per reporting period (hours) | Query execution time in hours (dynamic; from EXPLAIN ANALYZE or OS timing) |
| **RR** | Resource Reserved ratio (allocated share) | 0.5 (conservative shared server; use 1.0 for dedicated DB server) |
| **ToR** | Total Resources | Implicit in formula; RR / ToR = allocated fraction |

### Dry-Run / Estimated Runtime Fallback

When `EXPLAIN ANALYZE` is not run or fails:

1. **Option 3 (primary):** Historical average — query fingerprint lookup in log DB; use avg runtime if found.
2. **Option 1 (fallback):** Planner cost proxy — calibrate cost→runtime from benchmark; use calibration factor × total plan cost.
3. **UI:** Flag result as "estimated" vs "measured" so users know confidence level.

### Total CO2 Saved

`Total CO2 Saved = Σ (SCI_before - SCI_after)` for queries that were optimized and re-analyzed. Aggregated at org/user level for dashboard.

### Classification Tiers (from Sustainability Score)

| Score | Tier | Label |
|-------|------|-------|
| 90–100 | 🟢 Excellent | Feasible, green |
| 70–89 | 🟡 Good | Feasible |
| 50–69 | 🟠 Moderate | Feasible with caveats |
| 25–49 | 🔴 Poor | Not recommended |
| 0–24 | ⛔ Critical | Infeasible / block in strict mode |

---

## Phase 1 — Query Ingestion, EXPLAIN ANALYZE, Energy & gCO2eq Estimation, Feasibility Classification

Deliver: end-to-end flow from SQL input to emissions and classification.

### Backend

- [x] **API Endpoint:** `POST /api/analyze-query`
  - [x] Accept `query` (string), optional `connectionId`, optional `hardwareConfig` override, optional `dryRun` (skip EXPLAIN ANALYZE).
  - [x] Connect to target PostgreSQL instance (dataset DB).
  - [x] Execute `EXPLAIN ANALYZE` when not dry-run; otherwise use dry-run fallback.
  - [x] **Dry-run fallback chain:** (3) Historical avg runtime by query fingerprint → (1) Planner cost × calibration factor.
  - [x] Parse EXPLAIN output for runtime, total plan cost, rows examined.
  - [x] Compute Energy, Operational Emissions, Embodied Emissions, SCI, Sustainability Score, tier.
  - [x] Persist query, plan, results, `runtime_source` (measured | estimated), score breakdown, weights/baselines snapshot.
  - [x] Return analysis payload including `runtimeSource: "measured" | "estimated"`.

- [x] **Formula integration module**
  - [x] **Energy (kWh):** `E = t × (n_c × P_c × u_c + n_mem × 0.3725) × PUE × 0.001` (Green Algorithms 2021)
    - [x] `t` from EXPLAIN ANALYZE (or dry-run fallback) in seconds.
    - [x] `n_c`, `P_c`, `u_c`, `n_mem` from hardware config or defaults.
  - [x] **Operational Emissions:** `O = E × I` (I = grid carbon intensity, gCO2eq/kWh).
  - [x] **Embodied Emissions:** `M = TE × (TiR / EL) × (RR / ToR)` — TiR = query time in hours; defaults: TE=1.6e6, EL=35040, RR=0.5.
  - [x] **SCI:** `SCI = (O + M) / R`, R = 1 query.
  - [x] **Sustainability Score:** See Phase 2 section (implement in Phase 1 for analysis results).

- [x] **Database**
  - [x] Ensure `queries` table has: `runtime_source`, `planner_cost`, `rows_examined`, `score`, `score_breakdown`, `weights_snapshot`, `baselines_snapshot`, `tier`.

### Frontend

- [x] **Analyze Query screen**
  - [x] SQL Query Editor, "Load Sample", "Analyze Query", "Clear".
  - [x] Query metadata (lines, tables, JOIN detected).
  - [x] **Hardware Configuration panel:** CPU Cores, RAM (GB), CPU Utilization, PUE, Grid Carbon Intensity.
  - [x] **Analysis Results panel:** Classification tag, Energy, Operational CO2, Embodied CO2, Total SCI.
  - [x] Badge/banner: "measured" vs "estimated" for runtime source.
  - [x] **Emission Analysis Complete modal:** gauge, sustainability rating, metric cards, Export, Optimize Query.

- [x] **Layout & navigation**
  - [x] Left sidebar: QueryCarbon, Dashboard, Analyze Query, Reports, Settings.
  - [x] User profile (mock for Phase 1).

- [x] **Error handling**
  - [x] Clear messages for invalid SQL, connection errors, analysis failures.

---

## Phase 2 — Evaluation & Grading: Scoring Rubrics, Historical Comparison, Dashboards

Deliver: Dashboard, Reports, sustainability scoring, configurability, export.

### Backend

- [ ] **Sustainability scoring module**
  - [ ] Formula: `S = 100 - clamp((w1×N_emissions + w2×N_cost + w3×N_duration + w4×N_rows) × 100, 0, 100)` — higher = greener.
  - [ ] Log normalization for emissions and rows: `N_emissions = log(SCI+1)/log(SCI_baseline+1)`, `N_rows = log(rows+1)/log(rows_baseline+1)`.
  - [ ] Linear normalization for cost and duration: `N_cost = planner_cost/cost_baseline`, `N_duration = execution_ms/duration_baseline`.
  - [ ] Default weights: w1=0.40, w2=0.25, w3=0.20, w4=0.15 (must sum to 1.0).
  - [ ] Default baselines: SCI_baseline=1.0, cost_baseline=10_000, duration_baseline=1_000, rows_baseline=100_000.
  - [ ] Snapshot weights and baselines at analysis time for reproducibility.
  - [ ] Derive `tier` from score (Excellent/Good/Moderate/Poor/Critical).
  - [ ] Store: `score`, `score_breakdown`, `weights_snapshot`, `baselines_snapshot`, `tier` on `queries`.

- [ ] **Configurability (tiered)**
  - [ ] **Level 1 — UI Settings:** weights w1–w4 (sum=1), tier thresholds, strict mode (block Critical).
  - [ ] **Level 2 — Per-connection:** baselines, grid intensity I, embodied constants.
  - [ ] **Level 3 — Hardcoded:** normalization approach, formula structure.

- [ ] **API: `GET /api/query-history`**
  - [ ] Paginated, filterable (classification, tier, date, tables), searchable (SQL snippet), sortable.
  - [ ] Include `tier` in response.

- [ ] **API: `GET /api/query-details/:queryId`**
  - [ ] Full analysis including score breakdown, weights/baselines snapshot.

- [ ] **API: `GET /api/dashboard-stats`**
  - [ ] Total queries, Avg gCO2, Sustainability Score, Total CO2 Saved (est.) = Σ(SCI_before - SCI_after) for optimized queries.
  - [ ] Classification/tier counts and percentages.
  - [ ] Emissions trend (daily/weekly/monthly).
  - [ ] Recent queries list.
  - [ ] Baseline Reference for chart: rolling average or configurable baseline.

- [ ] **API: `GET /api/settings`** and **`PUT /api/settings`**
  - [ ] Weights, tier thresholds, strict mode (Level 1).

### Frontend

- [ ] **Dashboard**
  - [ ] KPI cards, trend indicators.
  - [ ] Emissions Trend chart: Operational Emissions + Baseline Reference.
  - [ ] Recent Queries, date range selector, Export Report, Notifications (placeholder).

- [ ] **Reports**
  - [ ] Summary cards, search, filters (All Classifications, tier, date, All Tables).
  - [ ] Sortable table, pagination, Export CSV, row click → query details.

- [ ] **Settings**
  - [ ] Weights editor (w1–w4, sum=1 validation).
  - [ ] Tier thresholds editor.
  - [ ] Strict mode toggle (block Critical queries).
  - [ ] Per-connection overrides (Level 2, advanced).

- [ ] **Export**
  - [ ] Export Report: summary + chart data.
  - [ ] Export (single query): JSON/PDF.
  - [ ] Export CSV: Reports table.

---

## Phase 3 — Query Betterment: Rewrite Suggestions, Index Recommendations, Anti-Pattern Detection

Deliver: actionable optimization suggestions with heuristic + hypopg pipeline.

### Backend

- [ ] **API: `POST /api/optimize-query`**
  - [ ] Input: `queryId` or `query` string.
  - [ ] Load EXPLAIN output and analysis if `queryId` given.
  - [ ] **Query rewrite module:** anti-patterns (SELECT *, inefficient subqueries, OR-heavy predicates); suggest rewrites.
  - [ ] **Index recommendation module (3-step pipeline):**
    - [ ] **Step 1 — Heuristic scan:** Always run; no extension; scan EXPLAIN for Seq Scans, filter columns; output candidate columns.
    - [ ] **Step 2 — hypopg simulation:** If extension available, create hypothetical indexes for candidates, re-run EXPLAIN; compute cost delta and SCI delta.
    - [ ] **Step 3 — Emit with confidence:** "Simulated" (hypopg confirmed + show delta) | "Heuristic" (pattern-based only).
  - [ ] Return suggestions with `confidence: "Simulated" | "Heuristic"`.

- [ ] **hypopg extension**
  - [ ] Document requirement; optional for enhanced index suggestions.
  - [ ] `CREATE EXTENSION hypopg;` on target DB if available.
  - [ ] Fallback gracefully when unavailable.

- [ ] **Total CO2 Saved calculation**
  - [ ] When user re-analyzes after applying suggestion: store `optimized_from_query_id`; aggregate SCI_before - SCI_after for dashboard.

- [ ] **Optimization suggestions table**
  - [ ] Log suggestions with `confidence`, `sci_delta` (if simulated), `cost_delta`.

### Frontend

- [ ] **Optimize Query flow**
  - [ ] Optimization suggestions modal: rewrites, index recommendations with confidence tag (Simulated / Heuristic).
  - [ ] Copy-to-clipboard for suggested SQL / index DDL.
  - [ ] Re-analyze button for suggested rewrite.
  - [ ] Show SCI delta and cost delta for Simulated recommendations.

---

## Phase 4 — Multi-Database Support (MySQL, SQLite)

Deliver: analysis for non-PostgreSQL databases.

### Backend

- [ ] **Database abstraction:** unified connect + EXPLAIN + parse.
- [ ] **Drivers:** MySQL, SQLite; adapters for EXPLAIN output parsing.
- [ ] **API:** `POST /api/connect-db`, `GET /api/db-connections`.
- [ ] **API:** `POST /api/analyze-query` accepts `connectionId` or `dbType` + params.
- [ ] **Store** `database_type` on `queries`.
- [ ] **Note:** hypopg is PostgreSQL-only; index simulation limited to PostgreSQL.

### Frontend

- [ ] **Settings / DB management:** add/edit/remove connections.
- [ ] **Analyze Query:** connection picker; "Database-agnostic analysis" label where appropriate.

---

## Database Schema

### App Internal Store (PostgreSQL — Log/Metadata)

```sql
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    plan VARCHAR(50) DEFAULT 'Pro',
    region VARCHAR(10) DEFAULT 'IN',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS db_connections (
    connection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id),
    name VARCHAR(255) NOT NULL,
    db_type VARCHAR(50) NOT NULL,
    host VARCHAR(255),
    port INTEGER,
    username VARCHAR(255),
    password_encrypted TEXT,
    database_name VARCHAR(255),
    -- Level 2 overrides
    baselines_snapshot JSONB,
    grid_carbon_intensity DECIMAL(10, 4),
    embodied_params JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queries (
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

CREATE TABLE IF NOT EXISTS optimization_suggestions (
    suggestion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id UUID NOT NULL REFERENCES queries(query_id),
    type VARCHAR(50) NOT NULL,
    confidence VARCHAR(20),
    details JSONB NOT NULL,
    cost_delta DECIMAL(18, 2),
    sci_delta DECIMAL(12, 4),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_queries_analyzed_at ON queries(analyzed_at);
CREATE INDEX idx_queries_classification ON queries(classification);
CREATE INDEX idx_queries_tier ON queries(tier);
CREATE INDEX idx_queries_fingerprint ON queries(query_fingerprint);
CREATE INDEX idx_queries_user ON queries(user_id);
```

### Dataset Under Analysis

Read-only / EXPLAIN-only. QueryCarbon does not modify schema or data. hypopg requires `CREATE EXTENSION hypopg` on the target PostgreSQL instance if index simulation is desired.

---

## API Endpoints Summary

| Phase | Method | Route | Purpose |
|-------|--------|-------|---------|
| 1 | POST | `/api/analyze-query` | Run analysis; return emissions, score, tier; `runtimeSource` |
| 2 | GET | `/api/query-history` | Paginated, filterable, searchable list |
| 2 | GET | `/api/query-details/:queryId` | Full analysis + score breakdown |
| 2 | GET | `/api/dashboard-stats` | KPIs, trend, Total CO2 Saved, recent |
| 2 | GET | `/api/export-report` | Dashboard export |
| 2 | GET | `/api/export-csv` | Reports CSV |
| 2 | GET/PUT | `/api/settings` | Weights, tier thresholds, strict mode |
| 3 | POST | `/api/optimize-query` | Rewrite + index suggestions (Simulated/Heuristic) |
| 4 | POST | `/api/connect-db` | Save connection |
| 4 | GET | `/api/db-connections` | List connections |

---

## Phase vs Image Mapping

| Phase | Image(s) | Primary Features |
|-------|----------|------------------|
| 1 | Analyze Query, Emission Analysis Complete | Editor, hardware config, emissions, classification, gauge |
| 2 | Dashboard, Reports, Settings | KPIs, Emissions Trend, Reports table, scoring, configurability |
| 3 | Emission Analysis Complete (Optimize Query) | Rewrite, index suggestions (heuristic + hypopg) |
| 4 | Analyze Query | Multi-DB connection |
