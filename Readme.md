# QueryCarbon — SQL Query Carbon Footprint Analyzer

**Phase 3 · v1.0.0** | Last Updated: April 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Scientific Foundation](#scientific-foundation)
3. [Formulas & Calculations](#formulas--calculations)
4. [Architecture](#architecture)
5. [Query Optimizer — How It Works](#query-optimizer--how-it-works)
   - [Track 1 — EXPLAIN Pattern Analysis (P1–P10)](#track-1--explain-pattern-analysis-p1p10)
   - [Track 2 — HypoPG Index Simulation](#track-2--hypopg-index-simulation)
   - [Track 3 — SQL Pattern Rules (R1–R12)](#track-3--sql-pattern-rules-r1r12)
   - [Ranking & Merging](#ranking--merging)
6. [Installation & Setup](#installation--setup)
7. [API Documentation](#api-documentation)
8. [Pagila Test Queries](#pagila-test-queries)
9. [Troubleshooting](#troubleshooting)
10. [References](#references)

---

## Overview

**QueryCarbon** is a full-stack SQL carbon footprint analyzer that measures the environmental impact of PostgreSQL queries and automatically surfaces optimization suggestions. It combines live query execution, EXPLAIN plan analysis, hypothetical index simulation, and SQL pattern matching into a unified inline UI.

### What It Does

| Capability | Details |
|-----------|---------|
| **Carbon measurement** | Energy (kWh), Operational emissions (gCO2eq), Embodied emissions (gCO2eq), SCI score |
| **Sustainability scoring** | 0–100 composite score across 5 tiers (EXCELLENT → CRITICAL) |
| **EXPLAIN analysis** | Walks the live EXPLAIN JSON tree to detect 10 performance anti-patterns (P1–P10) |
| **Index simulation** | Uses `hypopg` to try hypothetical indexes on your real DB and measure actual cost reduction |
| **SQL pattern matching** | Applies 12 regex-based rules (R1–R12) to the raw SQL to catch structural anti-patterns |
| **Inline rewrites** | Applies the optimizer's suggestions directly in the editor — real SQL transforms, not just comments |
| **History & reports** | Full query history with filtering, CSV export, and one-click re-analysis |

### Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | Node.js 18+ / Express.js 4.x |
| **Frontend** | React 18+ / Vite 5.x |
| **Database** | PostgreSQL 12+ |
| **Port** | Backend: 3001, Frontend: 5173 |

---

## Scientific Foundation

### Green Algorithms 2021 (Lannelongue et al.)

> *"Quantifying the carbon emissions of machine learning"*
> Journal of Machine Learning Research (2021) — arXiv:2007.10883

- Methodology for measuring Software Carbon Intensity (SCI)
- Energy consumption model: CPU, memory, PUE
- Reference: https://arxiv.org/abs/2007.10883

### ISO/IEC 21031:2024

> *"Environmental Information — Quantification and Communication of Embodied Carbon of Products"*

- Embodied carbon calculation for hardware lifecycle
- 4-year server lifespan standard (35,040 hours)
- Default: Dell R740 mid-range server (1,600,000 gCO2eq)

---

## Formulas & Calculations

### 1. Energy Consumption (kWh)

```
E = t × (n_c × P_c × u_c + n_mem × 0.3725) × PUE × 0.001
```

| Symbol | Name | Unit | Notes |
|--------|------|------|-------|
| `t` | Execution time | seconds | Measured runtime |
| `n_c` | CPU cores | count | Physical cores |
| `P_c` | Power per core | watts | TDP / cores |
| `u_c` | CPU utilization | fraction | 0–1 |
| `n_mem` | Memory | gigabytes | Allocated RAM |
| `PUE` | Power Usage Effectiveness | factor | Data center cooling |

Memory constant: **0.3725 W/GB** (ISO/IEC baseline)

---

### 2. Operational Emissions (gCO2eq)

```
O = E × I
```

| Region | Intensity | Source |
|--------|-----------|--------|
| India | 442 gCO2eq/kWh | IEA 2023 |
| US Average | 386 gCO2eq/kWh | EPA eGRID 2023 |
| EU Average | 233 gCO2eq/kWh | Ember 2023 |
| France | 45 gCO2eq/kWh | RTE 2023 |
| Norway | 12 gCO2eq/kWh | Statistics Norway |

---

### 3. Embodied Emissions (gCO2eq)

```
M = TE × (TiR / EL) × (RR / ToR)
```

| Symbol | Name | Default |
|--------|------|---------|
| `TE` | Total embodied carbon | 1,600,000 gCO2eq |
| `EL` | Expected lifespan | 35,040 hours (4 years) |
| `TiR` | Time in reporting period | query runtime in hours |
| `RR` | Resource reserved ratio | 0.5 (shared) / 1.0 (dedicated) |
| `ToR` | Total operating time | 1 (normalized) |

---

### 4. Software Carbon Intensity (SCI)

```
SCI = (O + M) / R        where R = 1 SQL query
```

| SCI Range | Meaning |
|-----------|---------|
| < 0.01 | Ultra-efficient |
| 0.01–0.1 | Excellent |
| 0.1–1.0 | Good |
| 1.0–5.0 | Moderate |
| 5.0–10 | Poor |
| > 10 | Critical |

---

### 5. Sustainability Score (0–100)

```
S = 100 − clamp((w₁×N_emissions + w₂×N_cost + w₃×N_duration + w₄×N_rows) × 100, 0, 100)
```

**Normalization:**

```
N_emissions = log(SCI + 1)  / log(SCI_baseline + 1)
N_cost      = log(cost + 1) / log(cost_baseline + 1)
N_rows      = log(rows + 1) / log(rows_baseline + 1)
N_duration  = execution_ms  / duration_baseline
```

**Default weights and baselines:**

| Parameter | Value |
|-----------|-------|
| w₁ emissions | 0.40 |
| w₂ cost | 0.25 |
| w₃ duration | 0.20 |
| w₄ rows | 0.15 |
| SCI baseline | 0.1 gCO2eq |
| Cost baseline | 5,000 units |
| Duration baseline | 500 ms |
| Rows baseline | 10,000 |

---

### 6. Classification Tiers

| Score | Tier | Color |
|-------|------|-------|
| 90–100 | EXCELLENT | Green |
| 70–89 | GOOD | Blue |
| 50–69 | MODERATE | Amber |
| 25–49 | POOR | Orange |
| 0–24 | CRITICAL | Red |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       FRONTEND (React/Vite)                      │
│  AnalyzePage  │  Dashboard  │  ReportsPage  │  QueryDetail       │
│                                                                  │
│  ┌─ Carbon Results tab ────────┐  ┌─ Optimization tab ─────────┐ │
│  │ SCI · Score · Emissions    │  │ FindingCard list           │ │
│  │ Runtime · Cost · Rows      │  │ Severity filter            │ │
│  │                            │  │ Apply Fix → editor rewrite │ │
│  └────────────────────────────┘  └───────────────────────────┘ │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP/REST
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                  BACKEND API (Express, port 3001)                │
│                                                                  │
│  POST /api/analyze          POST /api/optimize-query            │
│  GET  /api/databases        GET  /api/history/:id               │
│  GET  /api/history          GET  /api/dashboard                 │
│                                                                  │
│  ┌─ carbonCalculator.js ──┐  ┌─ explainAnalyzer.js ──────────┐  │
│  │ Energy, O, M, SCI      │  │ Walk EXPLAIN JSON → P1–P10    │  │
│  │ Score, Classification  │  └────────────────────────────────┘  │
│  └────────────────────────┘  ┌─ indexSimulator.js ───────────┐  │
│                               │ hypopg → cost_before/after   │  │
│  ┌─ sqlPatternMatcher.js ─┐  └────────────────────────────────┘  │
│  │ Regex rules R1–R12     │  ┌─ optimizationRanker.js ───────┐  │
│  └────────────────────────┘  │ Merge · Dedup · Rank findings │  │
│                               └────────────────────────────────┘  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ pg (PostgreSQL client)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    POSTGRESQL DATABASE                           │
│  querycarbon_history  │  target user databases                  │
│  (analysis records)   │  (queries run & analyzed here)          │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow — Query Analysis

```
User submits SQL
      │
      ▼
POST /api/analyze
      │
      ├─► Execute query on target DB → measure runtime, rows, cost
      ├─► Run EXPLAIN (FORMAT JSON, ANALYZE) → extract plan
      │
      ▼
carbonCalculator.js
      ├─► calculateEnergy()
      ├─► calculateOperationalEmissions()
      ├─► calculateEmbodiedEmissions()
      ├─► calculateSCI()
      ├─► calculateSustainabilityScore()
      └─► classifyScore()
      │
      ▼
Save to querycarbon_history
      │
      ▼
Return {query_id, sci, score, classification, ...}
      │
      ▼  (auto-fired if findings expected)
POST /api/optimize-query  {query_id}
      │
      ├─► Track 1: explainAnalyzer → P1–P10 findings
      ├─► Track 2: indexSimulator → hypopg cost simulation
      └─► Track 3: sqlPatternMatcher → R1–R12 findings
      │
      ▼
optimizationRanker → merge, deduplicate, rank
      │
      ▼
Return {findings[], total_sci_delta_estimated, hypopg_available}
      │
      ▼
Frontend: show FindingCards in "Optimization" tab
          "Apply Fix" → rewrite SQL directly in editor
```

---

## Query Optimizer — How It Works

The optimizer runs three independent tracks every time a query is analyzed, then merges and ranks the combined findings.

---

### Track 1 — EXPLAIN Pattern Analysis (P1–P10)

Executes `EXPLAIN (FORMAT JSON, ANALYZE)` on the live database and recursively walks every node in the plan tree. Each pattern checker reads actual runtime values from the plan — nothing is estimated.

---

#### P1 — Sequential Scan with Filter

**What triggers it:** A `Seq Scan` node with a `Filter` clause on a table that isn't also matched by P2.

**Why it's bad:** Full table scan. Every row is read and then filtered post-read. For large tables this is O(n) I/O regardless of how many rows are ultimately returned.

**Severity:** High if actual rows > 10,000; Medium otherwise.

**Fix generated:** `CREATE INDEX ON <table> (<filter_columns>)` using the actual column names extracted from the `Filter` expression.

---

#### P2 — Function Call on Filter Column (suppresses P1)

**What triggers it:** A `Seq Scan` where the `Filter` expression contains a function call (e.g. `lower(email)`) or a `::` cast operator.

**Why it's bad:** A standard B-tree index cannot be used when a function wraps the indexed column. The function is evaluated for every row.

**Severity:** High.

**Fix generated:** `CREATE INDEX ON <table> (<function_expression>)` — a functional/expression index that mirrors the exact filter expression from the plan.

---

#### P3 — Sort Without Supporting Index

**What triggers it:** A `Sort` node processing more than 5,000 rows when no Index Scan or Index Only Scan is present in its subtree.

**Why it's bad:** In-memory or disk-based sort. O(n log n) work that a covering index on the sort column would eliminate.

**Severity:** Medium.

**Fix generated:** `CREATE INDEX ON <table> (<sort_key_columns>)` using the actual `Sort Key` values from the plan node.

---

#### P4 — Nested Loop on Large Outer Set

**What triggers it:** A `Nested Loop` node where the outer child has more than 1,000 actual rows.

**Why it's bad:** Nested Loop cost is O(outer × inner). Without an index on the inner join column, every outer row triggers a full scan of the inner side.

**Severity:** High if outer rows ≥ 10,000; Medium otherwise.

**Fix generated:** `CREATE INDEX ON <outer_table> (join_column)` — outer table name is extracted from the plan; join column is a placeholder because EXPLAIN does not expose join key names.

---

#### P5 — Bad Cardinality Estimate

**What triggers it:** Any plan node where `Plan Rows` vs `Actual Rows` differ by a factor of 10× or more.

**Why it's bad:** The planner chose this join/scan strategy based on incorrect statistics. The actual plan shape (join order, scan type) may be completely wrong.

**Severity:** High if ratio ≥ 100×; Medium otherwise.

**Fix generated:** `ANALYZE <table>` with an `ALTER TABLE ... SET STATISTICS 500` recommendation. No DDL — this is a statistics issue, not an index issue.

---

#### P6 — CTE Used as a Materialization Fence

**What triggers it:** A `CTE Scan` node in the plan (PostgreSQL 12+ only).

**Why it's bad:** PostgreSQL 12+ materializes CTEs by default, evaluating the full CTE before any outer predicates are applied. This blocks predicate pushdown.

**Severity:** Medium.

**Fix generated:** Suggestion to add `NOT MATERIALIZED` to the CTE declaration, using the actual CTE name from the plan node. No DDL.

---

#### P7 — Index Scan with High Filter-Removal Ratio

**What triggers it:** An `Index Scan` where `Rows Removed by Filter` is more than 5× the `Actual Rows` returned.

**Why it's bad:** The index is found but too broad. A large number of rows pass the index condition and then get discarded by a secondary filter — effectively degrading to a sequential scan through the index.

**Severity:** Medium.

**Fix generated:** `CREATE INDEX ON <table> (existing_col, <filter_columns>)` — a composite index incorporating the secondary filter column(s).

---

#### P8 — Hash Join on Very Small Tables

**What triggers it:** A `Hash Join` node where both sides have fewer than 100 actual rows.

**Why it's bad:** Building a hash table for tiny data sets has more overhead than a simple Nested Loop with an index. The planner chose wrong, usually because join column statistics are stale.

**Severity:** Low.

**Fix generated:** `CREATE INDEX ON <table_a> (join_column)` — with the first join-side table name from the plan.

---

#### P9 — Bitmap Heap Scan with Very High Row Count

**What triggers it:** A `Bitmap Heap Scan` returning more than 50,000 rows.

**Why it's bad:** Bitmap scans amortize random I/O well for medium result sets, but degrade at high row counts because the bitmap must be rechecked for every heap block.

**Severity:** Medium.

**Fix generated:** `CREATE INDEX ON <table> (<recheck_condition_columns>)` using columns extracted from the actual `Recheck Cond` of the plan node.

---

#### P10 — Explicit Sort on DESC Column Without Index Scan Backward

**What triggers it:** A `Sort` node with at least one `DESC` sort key when no `Index Scan Backward` node exists in the subtree.

**Why it's bad:** An index that includes the DESC column allows PostgreSQL to traverse it backwards (`Index Scan Backward`) — zero sort cost. Without that index, an explicit O(n log n) sort is performed.

**Severity:** Low.

**Fix generated:** `CREATE INDEX ON <table> (<desc_columns> DESC)` using the actual `Sort Key` values from the plan.

---

### Track 2 — HypoPG Index Simulation

Track 2 takes every finding from Track 1 that has a generated `CREATE INDEX` DDL and simulates whether that index would actually reduce the query's planner cost — using your real database and real data.

**How it works:**

1. Checks whether the `hypopg` extension is installed in the target database.
2. For each Track 1 finding (up to 5), calls `hypopg_create_index(ddl)` — this creates the index in memory only, no disk I/O, no locking.
3. Re-runs `EXPLAIN (FORMAT JSON)` (no ANALYZE) with the hypothetical index in place. PostgreSQL's planner will use it if it's better.
4. Computes `cost_delta = cost_after − cost_before`. Negative means improvement.
5. Computes `sci_delta = sci_original × (cost_delta / cost_before)` — estimated carbon savings.
6. If two findings target the same table, attempts a **composite index** across their merged column lists and keeps whichever (composite or individual) achieves a lower cost.
7. Drops all hypothetical indexes in a `finally` block — they never persist.

**If `hypopg` is not installed:** all findings remain at `simulation: heuristic` — the DDL recommendations are still shown but without cost delta numbers.

**Install hypopg:**
```sql
-- Ubuntu/Debian
sudo apt install postgresql-<version>-hypopg

-- macOS (Homebrew)
brew install hypopg

-- Within psql
CREATE EXTENSION hypopg;
```

---

### Track 3 — SQL Pattern Rules (R1–R12)

Runs 12 regex-based rules against the raw SQL string independently of the EXPLAIN plan. Fires only when the pattern matches. Each rule produces a `suggestion`, a `rationale`, and a `severity`.

---

#### R1 — NOT IN with Subquery

**Pattern:** `NOT IN (SELECT ...)`

**Severity:** High

**Why it's bad:** `NOT IN` evaluates the subquery for every outer row. If the subquery returns even one `NULL`, the entire `NOT IN` returns false for all outer rows — a silent correctness bug as well as a performance issue.

**Rewrite applied:** The editor is rewritten to a `LEFT JOIN` anti-join template using table names extracted from your SQL.

```sql
-- Inefficient
SELECT customer_id FROM customer
WHERE customer_id NOT IN (SELECT customer_id FROM rental);

-- After applying fix
SELECT customer.*
FROM customer
LEFT JOIN rental _x ON customer.customer_id = _x.customer_id
WHERE _x.customer_id IS NULL;
```

---

#### R2 — Correlated NOT EXISTS Subquery

**Pattern:** `NOT EXISTS (SELECT ... WHERE ...)` where the subquery references the outer query

**Severity:** Medium

**Why it's bad:** A correlated `NOT EXISTS` re-executes the subquery for every outer row — O(n × m) executions.

**Rewrite applied:** `LEFT JOIN` anti-join template.

```sql
-- Inefficient
SELECT f.film_id, f.title FROM film f
WHERE NOT EXISTS (
  SELECT 1 FROM inventory i WHERE i.film_id = f.film_id
);

-- After applying fix
SELECT f.*
FROM film f
LEFT JOIN inventory _x ON f.film_id = _x.film_id
WHERE _x.film_id IS NULL;
```

---

#### R3 — SELECT * in Subquery or CTE

**Pattern:** `(SELECT * ...)` or `WITH name AS (SELECT * ...)`

**Severity:** Medium

**Why it's bad:** Forces the engine to fetch every column even when only one or two are referenced by the outer query. Wastes I/O and memory.

**Rewrite applied:** Annotates the `SELECT *` in the subquery with a comment directing you to list specific columns.

---

#### R4 — OR Equality Conditions on Same Column

**Pattern:** `col = X OR col = Y OR col = Z`

**Severity:** Low

**Why it's bad:** Verbose and error-prone. Identical query plan to `IN`, but harder to maintain and extend.

**Rewrite applied:** Actual SQL transformation — the regex extracts column name and all literal values and rewrites to `col IN (X, Y, Z)`.

```sql
-- Inefficient
SELECT * FROM film WHERE rating = 'PG' OR rating = 'G' OR rating = 'PG-13';

-- After applying fix
SELECT * FROM film WHERE rating IN ('PG', 'G', 'PG-13');
```

---

#### R5 — SELECT DISTINCT Masking a Bad JOIN

**Pattern:** `SELECT DISTINCT ... JOIN ...`

**Severity:** Medium

**Why it's bad:** `DISTINCT` after a `JOIN` almost always hides a missing or incorrect join predicate that produces accidental duplicate rows. `DISTINCT` removes the symptom, not the cause.

**Rewrite applied:** Replaces `SELECT DISTINCT` with `SELECT` and appends an explicit `GROUP BY` clause using the extracted column list.

```sql
-- Inefficient (masks fanout from missing predicate)
SELECT DISTINCT c.customer_id, c.first_name, c.last_name
FROM customer c
JOIN rental r ON c.customer_id = r.customer_id;

-- After applying fix
SELECT c.customer_id, c.first_name, c.last_name
FROM customer c
JOIN rental r ON c.customer_id = r.customer_id
GROUP BY c.customer_id, c.first_name, c.last_name;
```

---

#### R6 — Large OFFSET (Deep Pagination)

**Pattern:** `OFFSET <value>` where value > 1,000

**Severity:** High if > 10,000; Medium if 1,001–10,000

**Why it's bad:** `LIMIT n OFFSET m` scans and discards `m` rows on every page request — O(offset) work even though only `n` rows are returned. At page 500 of 10 results, you scan 5,000 rows to return 10.

**Rewrite applied:** Strips `OFFSET`, converts `LIMIT N OFFSET M` to `LIMIT N`, and inserts a keyset `WHERE sort_col > :last_seen_value` condition using the actual `ORDER BY` column extracted from your SQL.

```sql
-- Inefficient
SELECT film_id, title FROM film
ORDER BY film_id
LIMIT 10 OFFSET 5000;

-- After applying fix
-- Replace :last_seen_value with the last "film_id" from your previous page
SELECT film_id, title FROM film
WHERE film_id > :last_seen_value
ORDER BY film_id
LIMIT 10;
```

---

#### R7 — Implicit Type Coercion in WHERE Clause

**Pattern:** Columns named `*_id`, `*_at`, `*_date`, `*_count`, `*_num`, or `*_amount` compared to a string literal

**Severity:** Medium

**Why it's bad:** Comparing a typed column to a string literal forces an implicit cast on every row, which prevents the planner from using an index on that column.

**Rewrite applied:** Strips quotes from `_id` comparisons, adds `::timestamptz` for `_at`/`_date` columns, adds `::numeric` for `_count`/`_num`/`_amount` columns — applied to every match in the SQL.

```sql
-- Inefficient
SELECT * FROM customer WHERE customer_id = '1';

-- After applying fix
SELECT * FROM customer WHERE customer_id = 1;
```

---

#### R8 — Leading Wildcard LIKE Pattern

**Pattern:** `LIKE '%...'`

**Severity:** High

**Why it's bad:** A leading wildcard means the B-tree index cannot be used for prefix matching. The engine must scan every row in the table.

**Rewrite applied:** Converts `LIKE '%suffix'` to `LIKE 'suffix%'` for every occurrence (prefix search). Adds a comment explaining `pg_trgm` + GIN index for arbitrary substring search.

```sql
-- Inefficient
SELECT title FROM film WHERE description LIKE '%robot%';

-- After applying fix (prefix search variant)
-- If you need substring/suffix search: CREATE EXTENSION pg_trgm;
-- then: CREATE INDEX ON film USING gin(description gin_trgm_ops);
SELECT title FROM film WHERE description LIKE 'robot%';
```

---

#### R9 — HAVING Without GROUP BY

**Pattern:** `HAVING ...` with no `GROUP BY` in the query

**Severity:** Medium

**Why it's bad:** Without `GROUP BY`, `HAVING` treats the entire result set as a single group. This is almost certainly a mistake — the intent was a `WHERE` clause.

**Rewrite applied:** Replaces `HAVING` with `WHERE` directly.

```sql
-- Inefficient
SELECT customer_id FROM payment HAVING amount > 5;

-- After applying fix
SELECT customer_id FROM payment WHERE amount > 5;
```

---

#### R10 — Correlated Subquery in SELECT List

**Pattern:** A `SELECT` subquery appearing in the column list (before `FROM`)

**Severity:** High

**Why it's bad:** The subquery re-executes for every row in the outer result set — O(n) subquery executions. On a 10,000-row outer table that's 10,000 subquery runs.

**Rewrite applied:** Generates a `LEFT JOIN` template lifting the subquery into a derived table, using the outer table name extracted from your SQL. Fill in the aggregate column names.

```sql
-- Inefficient
SELECT
  c.customer_id,
  c.first_name,
  (SELECT COUNT(*) FROM rental r WHERE r.customer_id = c.customer_id) AS rental_count
FROM customer c;

-- After applying fix (fill in group_col and aggregate)
SELECT customer.*, sub.agg_value
FROM customer customer
LEFT JOIN (
    SELECT group_col, aggregate_fn(col) AS agg_value
    FROM sub_table
    GROUP BY group_col
) sub ON customer.id = sub.group_col;
```

---

#### R11 — COUNT(column) Instead of COUNT(*)

**Pattern:** `COUNT(<column_name>)` where column is not `*` or `1`

**Severity:** Low

**Why it's bad:** `COUNT(column)` must inspect each value to exclude NULLs. `COUNT(*)` counts all rows without value inspection and is measurably faster.

**Rewrite applied:** Replaces every `COUNT(col)` with `COUNT(*)` in the SQL.

```sql
-- Inefficient
SELECT COUNT(rental_id) FROM rental;

-- After applying fix
SELECT COUNT(*) FROM rental;
```

---

#### R12 — UNION Instead of UNION ALL

**Pattern:** `UNION` (plain) with no `ALL` keyword

**Severity:** Medium

**Why it's bad:** Plain `UNION` performs a deduplication pass over the combined result — O(n log n) sort or hash. If both sides are guaranteed to produce disjoint rows, this is pure wasted work.

**Rewrite applied:** Replaces every `UNION` (not already `UNION ALL`) with `UNION ALL`. A safety warning is prepended reminding you to verify disjoint rows before keeping the change.

```sql
-- Inefficient
SELECT first_name, last_name FROM customer
UNION
SELECT first_name, last_name FROM staff;

-- After applying fix
-- ⚠  Verify both sides produce disjoint rows before keeping this change
SELECT first_name, last_name FROM customer
UNION ALL
SELECT first_name, last_name FROM staff;
```

---

### Ranking & Merging

After all three tracks run, `optimizationRanker.js` combines and orders the findings:

**Deduplication:** If Track 1 and Track 3 both flag the same table, the Track 1 finding (backed by live EXPLAIN evidence) is kept and the Track 3 finding for that table is dropped.

**Sort order:**
1. **Severity** — `high` → `medium` → `low`
2. **Simulation status** — `simulated` (real hypopg result) → `heuristic` → `no_improvement` → `not_applicable`
3. **SCI delta** — most negative (most carbon savings) first; `null` goes last

---

## Installation & Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 12+
- (Optional) `hypopg` extension for index simulation

### Steps

**1. Clone and install dependencies:**

```bash
# Backend
cd FinalMiniProject/backend
npm install

# Frontend
cd FinalMiniProject/frontend
npm install
```

**2. Configure `backend/.env`:**

```bash
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=postgres
PORT=3001
CORS_ORIGIN=http://localhost:5173
```

**3. Initialize the QueryCarbon history table:**

```bash
cd backend
npm start
# The server auto-creates the querycarbon_history table on first start
```

**4. Start both servers:**

```bash
# Terminal 1 — Backend
cd backend && npm start

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

**5. (Optional) Install hypopg for cost simulation:**

```sql
-- Ubuntu/Debian
sudo apt install postgresql-16-hypopg

-- Then in psql (run for each database you want to analyze)
CREATE EXTENSION hypopg;
```

---

## API Documentation

### Base URL

```
http://localhost:3001/api
```

---

### POST /api/analyze

Run a SQL query and compute its carbon footprint.

**Request:**
```json
{
  "sql": "SELECT * FROM customer WHERE active = 1",
  "database": "pagila",
  "cpuCores": 8,
  "powerPerCore": 12,
  "cpuUtilization": 0.65,
  "ramGb": 32,
  "pue": 1.3,
  "gridIntensity": 442
}
```

**Response (200):**
```json
{
  "query_id": 42,
  "database": "pagila",
  "row_count": 584,
  "actual_runtime_ms": 12.4,
  "energy_kwh": 0.0000048,
  "operational_emissions_gco2": 0.0021,
  "embodied_emissions_gco2": 0.000004,
  "total_emissions_gco2": 0.0021,
  "sci_gco2eq_per_query": 0.0021,
  "sustainability_score": 85,
  "classification": "GOOD"
}
```

---

### POST /api/optimize-query

Run the three-track optimizer on a previously analyzed query.

**Request:**
```json
{ "query_id": 42 }
```

**Response (200):**
```json
{
  "findings": [
    {
      "pattern_id": "P1",
      "track": "explain_analysis",
      "table": "payment",
      "severity": "high",
      "simulation": "simulated",
      "suggestion": "Add a B-tree index on the filter column(s) (amount) on table \"payment\"",
      "index_ddl": "CREATE INDEX ON payment (amount)",
      "cost_before": 14442.15,
      "cost_after": 512.3,
      "cost_delta": -13929.85,
      "sci_delta": -0.061
    },
    {
      "rule_id": "R8",
      "track": "sql_pattern",
      "severity": "high",
      "suggestion": "Avoid leading wildcards (LIKE '%...'). Use a trailing wildcard for prefix search..."
    }
  ],
  "total_findings": 2,
  "hypopg_available": true,
  "total_sci_delta_estimated": -0.061
}
```

---

### GET /api/history

```
GET /api/history?limit=50&offset=0&search=SELECT&classification=POOR&days=30
```

---

### GET /api/history/:id

Fetch a single history record by ID (used by QueryDetail page).

---

### GET /api/databases

Returns a list of all accessible PostgreSQL databases.

---

### GET /api/dashboard?days=30

Returns aggregate stats, daily trend, classification distribution, and recent queries.

---

### GET /api/history/export?days=30

Returns a CSV download of the history within the given window.

---

## Pagila Test Queries

The [Pagila database](https://github.com/devrimgunduz/pagila) is a PostgreSQL sample database based on a DVD rental store. Use it to verify that the optimizer is working correctly. Install it from the link above, then select `pagila` as the target database in QueryCarbon.

The queries below are grouped by the rule or pattern they are designed to trigger. For each group there is an **inefficient** version (should trigger the rule) and an **efficient** version (should produce fewer or no findings).

---

### P1 — Sequential Scan with Filter

**Inefficient — triggers P1 (no index on `amount`):**
```sql
SELECT payment_id, customer_id, amount
FROM payment
WHERE amount > 9.00;
```
Expected findings: `P1` (Seq Scan on `payment`, filter on `amount`). If hypopg is installed, expect a simulated `CREATE INDEX ON payment (amount)` with a cost delta.

**Efficient — after creating the index:**
```sql
CREATE INDEX idx_payment_amount ON payment (amount);

SELECT payment_id, customer_id, amount
FROM payment
WHERE amount > 9.00;
```
Expected findings: none for P1 (planner uses index scan).

---

### P2 — Function on Filter Column

**Inefficient — triggers P2 (function call prevents index use):**
```sql
SELECT customer_id, email
FROM customer
WHERE lower(email) = 'mary.smith@sakilacustomer.org';
```
Expected findings: `P2` — functional index suggestion: `CREATE INDEX ON customer (lower(email))`.

**Efficient — use a functional index:**
```sql
CREATE INDEX idx_customer_email_lower ON customer (lower(email));

SELECT customer_id, email
FROM customer
WHERE lower(email) = 'mary.smith@sakilacustomer.org';
```

---

### P3 — Sort Without Index

**Inefficient — triggers P3 (sorting `return_date` with no supporting index):**
```sql
SELECT rental_id, customer_id, return_date
FROM rental
ORDER BY return_date DESC
LIMIT 25;
```
Expected findings: `P3` — suggestion to index `return_date`.

**Efficient — with index:**
```sql
CREATE INDEX idx_rental_return_date ON rental (return_date DESC);

SELECT rental_id, customer_id, return_date
FROM rental
ORDER BY return_date DESC
LIMIT 25;
```

---

### P5 — Bad Cardinality Estimate

**Triggers P5 (stale statistics cause huge plan/actual row divergence):**
```sql
-- Run this after bulk-loading data or after TRUNCATE + INSERT without ANALYZE
SELECT f.film_id, f.title, COUNT(r.rental_id) AS rentals
FROM film f
JOIN inventory i ON f.film_id = i.film_id
JOIN rental r ON i.inventory_id = r.inventory_id
GROUP BY f.film_id, f.title
ORDER BY rentals DESC
LIMIT 10;
```
If statistics are fresh, P5 may not fire. To force stale stats: bulk-insert rows then analyze without running `ANALYZE`.

**Fix (run then re-analyze the query):**
```sql
ANALYZE film;
ANALYZE inventory;
ANALYZE rental;
```

---

### P6 — CTE Materialization Fence

**Inefficient — CTE blocks predicate pushdown (triggers P6):**
```sql
WITH active_customers AS (
  SELECT customer_id, first_name, last_name, store_id
  FROM customer
  WHERE activebool = true
)
SELECT ac.customer_id, ac.first_name, r.rental_date
FROM active_customers ac
JOIN rental r ON ac.customer_id = r.customer_id
WHERE r.rental_date > '2005-07-01';
```
Expected findings: `P6` — CTE `active_customers` is materialized as a fence.

**Efficient — inline the CTE or add NOT MATERIALIZED:**
```sql
WITH active_customers AS NOT MATERIALIZED (
  SELECT customer_id, first_name, last_name, store_id
  FROM customer
  WHERE activebool = true
)
SELECT ac.customer_id, ac.first_name, r.rental_date
FROM active_customers ac
JOIN rental r ON ac.customer_id = r.customer_id
WHERE r.rental_date > '2005-07-01';
```

---

### R1 — NOT IN with Subquery

**Inefficient — triggers R1:**
```sql
SELECT customer_id, first_name, last_name
FROM customer
WHERE customer_id NOT IN (
  SELECT customer_id FROM rental
);
```
Expected findings: `R1` (high severity). Click "Apply Fix" — the editor rewrites this to a LEFT JOIN anti-join using table/column names extracted from your SQL.

**Efficient — LEFT JOIN anti-join:**
```sql
SELECT c.customer_id, c.first_name, c.last_name
FROM customer c
LEFT JOIN rental r ON c.customer_id = r.customer_id
WHERE r.customer_id IS NULL;
```

---

### R2 — Correlated NOT EXISTS

**Inefficient — triggers R2:**
```sql
SELECT f.film_id, f.title
FROM film f
WHERE NOT EXISTS (
  SELECT 1 FROM inventory i WHERE i.film_id = f.film_id
);
```
Expected findings: `R2` (medium severity).

**Efficient — LEFT JOIN anti-join:**
```sql
SELECT f.film_id, f.title
FROM film f
LEFT JOIN inventory i ON f.film_id = i.film_id
WHERE i.inventory_id IS NULL;
```

---

### R3 — SELECT * in Subquery

**Inefficient — triggers R3:**
```sql
SELECT customer_id, first_name
FROM customer
WHERE customer_id IN (
  SELECT * FROM (
    SELECT customer_id FROM payment WHERE amount > 8
  ) sub
);
```
Expected findings: `R3` (medium severity).

**Efficient — explicit column list:**
```sql
SELECT customer_id, first_name
FROM customer
WHERE customer_id IN (
  SELECT customer_id FROM payment WHERE amount > 8
);
```

---

### R4 — OR Equality on Same Column

**Inefficient — triggers R4:**
```sql
SELECT film_id, title, rating
FROM film
WHERE rating = 'PG'
   OR rating = 'G'
   OR rating = 'PG-13';
```
Expected findings: `R4` (low severity). Click "Apply Fix" — the editor rewrites to `rating IN ('PG', 'G', 'PG-13')` automatically.

**Efficient — IN clause:**
```sql
SELECT film_id, title, rating
FROM film
WHERE rating IN ('PG', 'G', 'PG-13');
```

---

### R5 — SELECT DISTINCT Masking Bad JOIN

**Inefficient — triggers R5 (DISTINCT hides fanout from the rental join):**
```sql
SELECT DISTINCT c.customer_id, c.first_name, c.last_name
FROM customer c
JOIN rental r ON c.customer_id = r.customer_id;
```
Expected findings: `R5` (medium severity). "Apply Fix" replaces `DISTINCT` with an explicit `GROUP BY`.

**Efficient — explicit GROUP BY:**
```sql
SELECT c.customer_id, c.first_name, c.last_name
FROM customer c
JOIN rental r ON c.customer_id = r.customer_id
GROUP BY c.customer_id, c.first_name, c.last_name;
```

---

### R6 — Large OFFSET Deep Pagination

**Inefficient — triggers R6 (OFFSET 5000 > threshold of 1000):**
```sql
SELECT film_id, title, rental_rate
FROM film
ORDER BY film_id
LIMIT 10 OFFSET 5000;
```
Expected findings: `R6` (high severity, OFFSET > 10,000 threshold). "Apply Fix" removes the OFFSET and inserts a keyset `WHERE film_id > :last_seen_value` using the ORDER BY column.

**Efficient — keyset pagination:**
```sql
SELECT film_id, title, rental_rate
FROM film
WHERE film_id > 5000        -- last film_id from the previous page
ORDER BY film_id
LIMIT 10;
```

---

### R7 — Implicit Type Coercion

**Inefficient — triggers R7 (`customer_id` is integer but compared to string):**
```sql
SELECT customer_id, first_name, last_name
FROM customer
WHERE customer_id = '42';
```
Expected findings: `R7` (medium severity). "Apply Fix" strips the quotes: `customer_id = 42`.

**Efficient — matching literal type:**
```sql
SELECT customer_id, first_name, last_name
FROM customer
WHERE customer_id = 42;
```

---

### R8 — Leading Wildcard LIKE

**Inefficient — triggers R8 (leading `%` prevents index use):**
```sql
SELECT title, description
FROM film
WHERE description LIKE '%robot%';
```
Expected findings: `R8` (high severity). "Apply Fix" converts the leading wildcard to trailing: `LIKE 'robot%'`.

**Efficient — trailing wildcard (prefix search):**
```sql
SELECT title, description
FROM film
WHERE description LIKE 'A%';
```

**Efficient — arbitrary substring (using pg_trgm):**
```sql
-- First: CREATE EXTENSION pg_trgm;
-- CREATE INDEX ON film USING gin(description gin_trgm_ops);
SELECT title, description
FROM film
WHERE description ILIKE '%robot%';
```

---

### R9 — HAVING Without GROUP BY

**Inefficient — triggers R9:**
```sql
SELECT COUNT(*)
FROM payment
HAVING SUM(amount) > 1000;
```
Expected findings: `R9` (medium severity). "Apply Fix" replaces `HAVING` with `WHERE`.

**Efficient — use WHERE for row-level filtering:**
```sql
SELECT COUNT(*)
FROM payment
WHERE amount > 5;
```

---

### R10 — Correlated Subquery in SELECT List

**Inefficient — triggers R10 (subquery runs once per customer row):**
```sql
SELECT
  c.customer_id,
  c.first_name,
  c.last_name,
  (SELECT COUNT(*) FROM rental r WHERE r.customer_id = c.customer_id) AS total_rentals,
  (SELECT SUM(amount) FROM payment p WHERE p.customer_id = c.customer_id) AS total_spent
FROM customer c
ORDER BY total_spent DESC
LIMIT 20;
```
Expected findings: `R10` (high severity). "Apply Fix" generates a LEFT JOIN template.

**Efficient — pre-aggregate then join:**
```sql
SELECT
  c.customer_id,
  c.first_name,
  c.last_name,
  COALESCE(r.total_rentals, 0) AS total_rentals,
  COALESCE(p.total_spent, 0)   AS total_spent
FROM customer c
LEFT JOIN (
  SELECT customer_id, COUNT(*) AS total_rentals
  FROM rental
  GROUP BY customer_id
) r ON c.customer_id = r.customer_id
LEFT JOIN (
  SELECT customer_id, SUM(amount) AS total_spent
  FROM payment
  GROUP BY customer_id
) p ON c.customer_id = p.customer_id
ORDER BY total_spent DESC
LIMIT 20;
```

---

### R11 — COUNT(column) vs COUNT(*)

**Inefficient — triggers R11:**
```sql
SELECT COUNT(rental_id) FROM rental;
```
Expected findings: `R11` (low severity). "Apply Fix" rewrites to `COUNT(*)`.

**Efficient:**
```sql
SELECT COUNT(*) FROM rental;
```

---

### R12 — UNION Instead of UNION ALL

**Inefficient — triggers R12 (deduplication pass is unnecessary here):**
```sql
SELECT first_name, last_name, 'customer' AS role FROM customer
UNION
SELECT first_name, last_name, 'staff'    AS role FROM staff;
```
Expected findings: `R12` (medium severity). "Apply Fix" replaces `UNION` with `UNION ALL` and prepends a safety warning.

**Efficient — when rows are guaranteed disjoint:**
```sql
SELECT first_name, last_name, 'customer' AS role FROM customer
UNION ALL
SELECT first_name, last_name, 'staff'    AS role FROM staff;
```

---

### Multi-Rule Query (Several Rules at Once)

Paste this into the analyzer to see multiple findings fire together:

```sql
-- This query triggers: R4, R8, R11, R12, and possibly P1/P3 depending on indexes
SELECT COUNT(rental_id)
FROM rental
WHERE return_date IS NOT NULL
  AND customer_id = '1' OR customer_id = '2' OR customer_id = '3'
UNION
SELECT COUNT(staff_id)
FROM staff
WHERE first_name LIKE '%Mike%';
```

Expected findings (minimum): R4 (OR → IN), R7 (string literal for customer_id), R8 (leading wildcard), R11 (COUNT(col)), R12 (UNION → UNION ALL).

---

### Comprehensive Reporting Query (Efficient Reference)

This query is well-written — it should score GOOD or EXCELLENT and produce zero or very few optimizer findings:

```sql
SELECT
  f.title,
  c.name                          AS category,
  COUNT(r.rental_id)              AS total_rentals,
  SUM(p.amount)                   AS total_revenue,
  ROUND(AVG(p.amount)::numeric, 2) AS avg_payment
FROM film f
JOIN film_category fc ON f.film_id = fc.film_id
JOIN category      c  ON fc.category_id = c.category_id
JOIN inventory     i  ON f.film_id = i.film_id
JOIN rental        r  ON i.inventory_id = r.inventory_id
JOIN payment       p  ON r.rental_id = p.rental_id
WHERE r.rental_date >= '2005-05-01'
  AND r.rental_date <  '2005-09-01'
GROUP BY f.title, c.name
ORDER BY total_revenue DESC
LIMIT 20;
```

---

## Troubleshooting

### "relation does not exist"

1. Verify your database is selected in the dropdown (e.g. `pagila`).
2. Check `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` in `backend/.env`.
3. Run `\dt` in psql to confirm tables exist.

### Optimizer shows no findings

1. The query may be genuinely efficient.
2. If you expect EXPLAIN findings (P1–P10), ensure the query is a SELECT — `EXPLAIN ANALYZE` only runs for SELECT statements.
3. Check backend console for `[Optimize]` log lines showing track results.

### hypopg_available: false

The `hypopg` extension is not installed in the selected database. Index DDL suggestions are still shown — only the cost delta simulation is skipped. Install with:
```sql
CREATE EXTENSION hypopg;
```

### All queries score the same

The baselines may be too loose for your workload. Adjust in `backend/.env`:
```bash
BASELINE_COST=2000       # tighten for OLTP-heavy workloads
BASELINE_DURATION=200    # tighten for fast-query applications
```

### Frontend shows no Optimization tab

The Optimization tab appears automatically after analysis only if `query_id` is returned by `/api/analyze`. Ensure the backend is running and responding — check the browser Network tab for the `/api/analyze` response.

---

## References

### Scientific Papers

- Lannelongue et al. (2021). "Quantifying the carbon emissions of machine learning." *JMLR*. arXiv:2007.10883. https://arxiv.org/abs/2007.10883
- ISO/IEC 21031:2024 — Environmental Information: Quantification of Embodied Carbon of Products. https://www.iso.org/standard/69484.html

### Data Sources

- IEA World Energy Outlook 2023: https://www.iea.org/reports/world-energy-outlook-2023
- EPA eGRID 2023: https://www.epa.gov/egrid
- Ember Global Electricity Review: https://ember-climate.org
- Boavizta Hardware Impact Database: https://github.com/Boavizta/boavizta-data-model

### Standards & Frameworks

- Green Software Foundation — Software Carbon Intensity Spec: https://github.com/Green-Software-Foundation/sci
- Greenhouse Gas Protocol Corporate Standard: https://ghgprotocol.org/corporate-standard
- PostgreSQL EXPLAIN documentation: https://www.postgresql.org/docs/current/using-explain.html
- HypoPG extension: https://hypopg.readthedocs.io
- Pagila sample database: https://github.com/devrimgunduz/pagila

---

## Project Roadmap

| Phase | Status | Features |
|-------|--------|----------|
| Phase 1 | Complete | Carbon estimation, SCI scoring, 5-tier classification |
| Phase 2 | Complete | Inline optimization UI, QueryDetail page, Reports integration |
| Phase 3 | Complete | EXPLAIN analysis (P1–P10), HypoPG simulation, SQL rules (R1–R12), inline SQL rewrites |
| Phase 4 | Planned | MySQL/Oracle support, multi-DB comparison |

---

**QueryCarbon · Phase 3 · v1.0.0**  
*Measuring and reducing the carbon footprint of SQL queries.*
