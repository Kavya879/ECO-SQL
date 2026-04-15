# QueryCarbon - Level 2 DFD: Sub-Process Decomposition

**Complete End-to-End Flow with All Phases (1-4)**

---

## **LEVEL 2 — Complete Sub-Process Decomposition**

### **P1 — Query Ingestion & Validation (6 sub-processes)**

| ID | Sub-Process | What it does | Input | Output |
|---|---|---|---|---|
| 1.1 | **SQL Parser & Sanitiser** | Parses SQL syntax, strips dangerous operations (DROP, TRUNCATE), extracts table/column names | Raw SQL string from user | Sanitised AST + extracted metadata |
| 1.2 | **DB Connection Router** | Resolves target database type, picks connection from pool (Phase 4: MySQL/Oracle too) | DB connection params, target DB name | Active DB connection handle |
| 1.3 | **Schema & Table Resolver** | Validates tables/columns exist in target schema, checks permissions | Extracted table names, connection | Valid schema map, column types |
| 1.4 | **Multi-DB Adapter Factory** | Selects correct driver: PostgreSQL (Phase 1–3) / MySQL / Oracle / SQL Server (Phase 4) | DB type flag | Driver instance (PG / MySQL / Oracle) |
| 1.5 | **Hardware Param Loader** | Loads hardware config (cores, RAM, PUE, region) from DS2 or env overrides | User region, HW override flags | HW config object {cores, ram, pue, grid} |
| 1.6 | **Query Deduplication Check** | Checks if identical query exists in DS4 history; returns cached result if < 5 min old | Query hash (MD5 of normalized SQL) | Cache hit → skip to P5, OR proceed to P2 |

**Internal Data Stores for P1:**
- **DS1a** — DB Connection Pool (used by 1.2)
- **DS1b** — Adapter Registry: {PG: pg-driver, MySQL: mysql-driver, Oracle: oracledb-driver} (used by 1.4)
- **DS2** — Hardware Config Cache (cores, RAM, PUE by region) (used by 1.5)
- **DS4** — querycarbon_history (used by 1.6 for deduplication)

---

### **P2 — DB Execution & Plan Extraction (6 sub-processes)**

| ID | Sub-Process | What it does | Input | Output |
|---|---|---|---|---|
| 2.1 | **Query Executor (Timed)** | Runs SQL on target DB, measures wall-clock runtime in milliseconds | Sanitised SQL + connection | Execution time (ms), result set |
| 2.2 | **EXPLAIN Plan Extractor** | Runs EXPLAIN ANALYZE (FORMAT JSON), extracts planner cost, I/O stats | Query + connection | Plan cost (numeric), planning time, execution nodes |
| 2.3 | **Runtime & Cost Normaliser** | Converts ms → seconds, scales planner cost to standard units (0–1000000 range) | Raw runtime (ms), raw cost | Normalised: time_sec, cost_normalised |
| 2.4 | **Row & Field Metadata Capture** | Captures row count returned, field names, result size in bytes | Result set | Rows affected, field metadata array, result_size_bytes |
| 2.5 | **Fallback Cost Estimator** | If EXPLAIN unavailable (non-SELECT, older DB): cost = 100 + (runtimeMs^1.2 × 10) | Runtime (ms), query type | Estimated cost (fallback) |
| 2.6 | **Execution Context Snapshot** | Records DB version, server timezone, isolation level, work_mem for reproducibility | DB connection metadata | Snapshot JSON {db_version, tz, isolation_level, work_mem} |

**Flow Note:** 2.5 is only triggered when 2.2 fails (non-SELECT or older DB).

**Internal Data Stores for P2:**
- **DS1a** — DB Connection Pool (used by 2.1, 2.2, 2.6)
- **DS1b** — Adapter Registry (used by 2.2 for EXPLAIN FORMAT selection)

---

### **P3 — Carbon & SCI Calculator (6 sub-processes) — Phase 1 CORE**

| ID | Sub-Process | Formula | Input | Output | References |
|---|---|---|---|---|---|
| 3.1 | **Energy Calculator** | E = t × (n_c × P_c × u_c + n_mem × 0.3725) × PUE × 0.001 | time_sec, cores, power/core, util, ram, PUE | energy_kwh (9 decimals) | Green Algorithms 2021 |
| 3.2 | **Operational Emissions** | O = E × I (I = grid carbon intensity, gCO₂/kWh) | energy_kwh, grid_region | operational_gco2eq (6 decimals) | IEA / EPA eGRID / Ember |
| 3.3 | **Embodied Emissions** | M = TE × (TiR / EL) × (RR / ToR) where TE=1.6M, EL=35040h, RR=0.05, ToR=11000h | time_sec, TE, EL, RR, ToR | embodied_gco2eq (6 decimals) | ISO/IEC 21031:2024 + Boavizta |
| 3.4 | **SCI Aggregator** | SCI = (O + M) / R (R = 1 per query) | operational, embodied | sci_gco2eq (6 decimals) | Green Algorithms 2021 Def 1 |
| 3.5 | **Score & Tier Classifier** | S = 100 − clamp(Σ wᵢ × Nᵢ × 100, 0, 100) → EXCELLENT/GOOD/MODERATE/POOR/CRITICAL | normalized metrics, weights | score (0–100), tier, grade_letter | Custom composite |
| 3.6 | **Calculation Audit Logger** | Logs all calculation inputs, formulas, parameters, and outputs to immutable audit trail | All P3 inputs/outputs | audit_record_json | ISO 14064 compliance |

**Scoring Details (3.5):**

| Metric | Weight | Normalisation Method | Baseline |
|--------|--------|---|---|
| Emissions (SCI) | 0.40 | Log: log(SCI+1) / log(0.1+1) | 0.1 gCO₂eq |
| Planner Cost | 0.25 | Log: log(cost+1) / log(5000+1) | 5000 |
| Duration | 0.20 | Linear: ms / 500 | 500 ms |
| Row Count | 0.15 | Log: log(rows+1) / log(10000+1) | 10,000 |

**Classification (3.5):**

| Score Range | Tier | Label | Action |
|---|---|---|---|
| 90–100 | ⭐⭐⭐⭐⭐ | **EXCELLENT** | Green light, exemplary |
| 70–89 | ⭐⭐⭐⭐ | **GOOD** | Recommended pattern |
| 50–69 | ⭐⭐⭐ | **MODERATE** | Acceptable, monitor |
| 30–49 | ⭐⭐ | **POOR** | Optimize needed |
| 10–29 | ⭐ | **CRITICAL** | Urgent review |
| 0–9 | ❌ | **BLOCKED** | Reject/refactor |

**Internal Data Stores for P3:**
- **DS2** — Grid Intensity by region (IEA / EPA / Ember) → feeds 3.2
- **DS3** — HW Lifecycle data (Boavizta / ISO 21031): TE, EL defaults → feeds 3.3
- **DS4** — querycarbon_history → written by 3.4 (save result + audit)
- **DS7** — audit_log table (PostgreSQL) → fed by 3.6

---

### **P4 — Query Optimization Engine (6 sub-processes) — Phase 2**

| ID | Sub-Process | What it does | Input | Output | Dependencies |
|---|---|---|---|---|---|
| 4.1 | **Anti-Pattern Detector** | Flags issues: SELECT *, missing WHERE, N+1 joins, no index on foreign key, implicit type cast | Query AST, schema, table stats | Pattern array {type, severity, hint} | Requires DS4 table stats |
| 4.2 | **Index Advisor** | Suggests CREATE INDEX on WHERE/JOIN/GROUP-BY columns; includes cardinality analysis | Query AST, table stats, column selectivity | Suggested indexes: {columns, estimated_selectivity} | Requires DS4, DS5 rules |
| 4.3 | **JOIN Order Optimiser** | Recommends smaller-table-first join ordering based on row counts and join type | Join tree, table cardinality | Reordered join sequence + estimated cost delta | Requires table stats |
| 4.4 | **Rewrite Suggestion Engine** | Proposes SQL rewrites: CTEs, subquery → join, window function, materialized view candidates | Pattern analysis, query structure | Rewritten SQL variants (top 3) | Uses DS5 rule engine |
| 4.5 | **Before/After CO₂ Estimator** | Re-runs P3 on suggested rewrites, shows delta: Δ SCI, Δ score, breakeven index cost | Original query CO₂, suggested query | CO₂ comparisons {original, suggested, delta} | Triggers P3 sub-processes |
| 4.6 | **Recommendation Confidence Scorer** | Rates each suggestion 0–100% based on pattern frequency in DS4 and estimated impact | Suggestion, historical frequency, estimated gain | confidence_score (0–100) | Requires DS4 historical data |

**Internal Data Store for P4:**
- **DS5** — Optimization Rule Engine: {pattern definitions, rewrite templates, thresholds}
- **DS4** — querycarbon_history (for table stats, pattern frequency analysis)

---

### **P5 — Evaluation & Grading Engine (6 sub-processes) — Phase 3**

| ID | Sub-Process | What it does | Input | Output | Dependencies |
|---|---|---|---|---|---|
| 5.1 | **Multi-Metric Aggregator** | Combines SCI, cost, duration, rows into unified metric set; computes secondary metrics (CO₂/sec, CO₂/row) | SCI, cost, duration, rows | metrics_bundle {primary, secondary, ratios} | Requires P3 outputs |
| 5.2 | **Percentile Benchmarker** | Compares query against historical DS4 data; gives percentile rank (e.g., "top 15% most efficient") | Query metrics, DS4 history | percentile_rank (0–100) | Requires DS4 full data |
| 5.3 | **Team Profile Grader** | Applies team-specific weight profiles from DS6 (e.g., team-A prioritizes cost, team-B prioritizes CO₂) | Metrics, team profile ID | grade_by_profile {teamA_grade, teamB_grade, ...} | Requires DS6 profiles |
| 5.4 | **Trend & Anomaly Detector** | Flags performance regressions vs. rolling 30-day average; detects spikes; trend direction | Query family history (DS4), current metrics | anomaly_report {flag, regression%, spike_severity, trend} | Requires DS4 time series |
| 5.5 | **Grade Report Generator** | Produces final grade card: A–F or custom tier with detailed commentary, recommendations, SLA status | Aggregated metrics, percentile, team grades, trends | grade_report JSON {grade, commentary, sla_status, next_steps} | Requires all P5 outputs |
| 5.6 | **KPI Dashboard Preparer** | Prepares summary stats for dashboard: query count, total CO₂ kg, distribution by tier, top-10 worst queries | History data (DS4), current batch metrics | dashboard_kpi_object {total_queries, total_co2_kg, tier_distribution, top_worst} | Requires DS4 aggregated |

**Internal Data Store for P5:**
- **DS6** — Grade Weights + Team KPIs: {team_profiles, weight_overrides, sla_thresholds}
- **DS4** — querycarbon_history (read by all P5 sub-processes for historical context)

---

### **P6 — Reporting & Dashboard (6 sub-processes) — All Phases**

| ID | Sub-Process | What it does | Input | Output | Dependencies |
|---|---|---|---|---|---|
| 6.1 | **Dashboard Stats Aggregator** | Computes real-time totals: query count, CO₂ kg summed, % queries by tier, avg score trend | DS4 history, current batch | stats_object {count, total_co2_kg, tier_pct, avg_score} | Requires DS4 full table |
| 6.2 | **History & Filter Engine** | Paginated query history with search (SQL text), date range, classification (TIER/SCORE) filters, sort | DS4 query store, filter params | filtered_result_set (JSON array, paginated) | Requires DS4 queries table |
| 6.3 | **Trend Chart Builder** | Day-by-day avg CO₂ trend data (last 90 days) for frontend time-series charts; summary stats | DS4 grouped by date, metrics | trend_data_array [{date, avg_co2, count, avg_score}] | Requires DS4 with timestamps |
| 6.4 | **CSV / PDF Export Engine** | Generates downloadable reports: detailed query list, aggregate stats, charts, executive summary | DS4 data, export template selection | binary export {csv_blob, pdf_blob} or json_array | Requires DS4, chart builder |
| 6.5 | **Alert & Notification Engine** | Fires alerts when CRITICAL queries detected (score < 10) or custom thresholds exceeded; integrates with email/Slack | Current analysis results, threshold config | alert_message {type, severity, recipients, action_items} | Requires P3/P5 outputs + config |
| 6.6 | **Audit Trail Exporter** | Exports complete calculation audit trail (P3.6 logs) for compliance/regulatory review (ISO 14064, GHG Protocol) | DS7 audit_log, DS4 results | audit_export_json {queries, calculations, parameters, references, proof_of_provenance} | Requires DS7, P3.6 outputs |

**Internal Data Stores for P6:**
- **DS4** — querycarbon_history → read by all P6 sub-processes
- **DS7** — audit_log (P3.6 output) → read by 6.6 for compliance export
- **DS8** — Export templates & alert config (email/Slack endpoints, thresholds)

---

## **Data Store Inventory**

| DS ID | Name | Type | Purpose | Populated By | Read By | Retention |
|---|---|---|---|---|---|
| DS1a | DB Connection Pool | In-Memory (cache) | Reusable connections to target DB | System init | P1.2, P2.1, P2.2, P2.6 | Runtime |
| DS1b | Adapter Registry | Code-level registry | Driver instances for PG/MySQL/Oracle/MSSQL | System init | P1.4, P2.2 | Runtime |
| DS2 | Hardware Config Cache | In-Memory (immutable) | {cores, ram, pue, grid_by_region} | P1.5 (system detect + user override) | P3.1, P3.2 | Cached (TTL 1 hour) |
| DS3 | HW Lifecycle Data | Configuration file / DB | TE, EL, RR, ToR defaults (Boavizta + ISO 21031) | Boavizta database / hardcoded | P3.3 | Static version-controlled |
| DS4 | querycarbon_history | PostgreSQL Table | All historical queries + calcs + scores | P1.6, P2–P5 (all write results here) | P1.6, P2.5, P4.1–4.6, P5.1–5.6, P6.1–6.4 | Permanent |
| DS5 | Optimization Rule Engine | JSON config file + DB table | Anti-pattern definitions, rewrite templates, candidate indexes | Manual (rules team) or ML model | P4.1–4.4, P4.6 | Version-controlled, updated quarterly |
| DS6 | Grade Weights + Team KPIs | PostgreSQL table | Team-specific weight profiles, SLA thresholds, custom grade scales | Admin panel (setup) or CSV import | P5.3, P5.5 | Per-organisation |
| DS7 | audit_log | PostgreSQL table | Complete audit trail: P3.6 output (all calculation inputs + formulas + outputs) | P3.6 | P6.6 (compliance export) | 7 years (regulatory) |
| DS8 | Export Templates & Alert Config | JSON config + DB table | Email/Slack webhook endpoints, alert thresholds, PDF template styles | Admin panel | P6.5, P6.4 | Per-organisation |

---

## **Phase Mapping to Sub-Processes**

### **Phase 1: gCO₂ Weight Estimation** ✅
- **Processes**: P1 (validation), P2 (execution), P3 (carbon calc), P6.1 (basic dashboard)
- **Key Sub-Processes**: 1.1–1.5, 2.1–2.6, 3.1–3.6
- **Output**: Energy (kWh), emissions (gCO₂eq), SCI, basic score

### **Phase 2: Query Optimization Suggestions** (IN PROGRESS)
- **Processes**: P4 (full), P6.2–6.4 (reporting)
- **New Sub-Processes**: 4.1–4.6
- **Output**: Anti-pattern detection, index advisor, rewrite suggestions, before/after CO₂ delta

### **Phase 3: Evaluation & Grading Metrics** (PLANNED)
- **Processes**: P5 (full), P6.5–6.6 (advanced reporting)
- **New Sub-Processes**: 5.1–5.6, 6.5–6.6
- **Output**: Percentile benchmarks, team-specific grades, trend anomalies, compliance audit export

### **Phase 4: Multi-Database Support** (FUTURE)
- **Enhanced Sub-Processes**: 1.4 (MySQL/Oracle support), 2.2 (EXPLAIN FORMAT variants)
- **New Adapters**: MySQL, Oracle, SQL Server, MongoDB (NoSQL variant)
- **Output**: Same architecture, multi-DB compatible

---

## **Example End-to-End Workflow (User → Output)**

```
USER INPUT
  ↓
  User inputs: "SELECT * FROM customers" + Region: EU
  ↓
P1.1 → P1.6  [Validate & deduplicate]
  ↓
P2.1 → P2.6  [Execute & extract plan]
  ↓
P3.1 → P3.6  [Calculate CO₂]
  ↓
P4.1 → P4.6  [Optional: Suggest optimizations]
  ↓
P5.1 → P5.6  [Optional: Grade & benchmark]
  ↓
P6.1 → P6.6  [Format report, export, audit]
  ↓
OUTPUT
  ├─ Score: 38.8/100 → POOR tier ⭐
  ├─ Emissions: 239.76 gCO₂eq
  ├─ Suggestions: "Add INDEX on customer_id"
  ├─ Percentile: Top 15% most efficient (Phase 3)
  ├─ CSV/PDF export
  └─ Audit trail (ISO 14064 compliant)
```

---

## **Key Formulas Reference**

| Process | Formula | Constants | Output |
|---|---|---|---|
| **P3.1** | E = t × P × PUE / 1000 | P = n_c×P_c×u_c + n_mem×0.3725, mem_power=0.3725 W/GB | energy_kwh |
| **P3.2** | O = E × I | I ∈ [12–475] gCO₂/kWh (region) | operational_gco2eq |
| **P3.3** | M = TE × (TiR/EL) × (RR/ToR) | TE=1.6M, EL=35040h, RR=0.05, ToR=11000h | embodied_gco2eq |
| **P3.4** | SCI = (O+M) / R | R=1 (per query) | sci_gco2eq |
| **P3.5** | S = 100 − clamp(w₁×N_emis + w₂×N_cost + w₃×N_dur + w₄×N_rows, 0, 1) × 100 | w = [0.40, 0.25, 0.20, 0.15] | score (0–100) |

---

**Document prepared for Phase 1–4 decomposition**  
*For diagrams, see Level 0 (context) and System Block Diagram files.*
