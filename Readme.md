# QueryCarbon

**SQL query optimization and carbon emissions estimation tool.** Estimates the carbon footprint of SQL queries and suggests optimizations to reduce their environmental impact.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js, Express |
| **Frontend** | React (Vite) |
| **Database** | PostgreSQL (2 instances) |
| **Extensions** | hypopg (optional, for index simulation) |

---

## Project Structure

```
FinalMiniProject/
├── backend/
│   ├── src/
│   │   ├── config/         # DB connection config
│   │   ├── routes/         # API routes
│   │   ├── services/       # Formulas, scoring, analysis logic
│   │   └── index.js
│   ├── scripts/
│   │   └── init-schema.sql # App DB schema
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   └── package.json
├── plan.md                 # Implementation plan
├── .env.example
└── Readme.md
```

---

## PostgreSQL Instances

1. **App store (metadata/log):** Stores analyzed queries, EXPLAIN output, emissions, scores, optimization suggestions.
2. **Target dataset:** The database under analysis. QueryCarbon runs `EXPLAIN ANALYZE` against it; no schema changes.

---

## Carbon Emission Formulas

References: **Green Algorithms 2021** (Lannelongue et al.), **ISO/IEC 21031:2024**.

### Energy (kWh)

```
E = t × (n_c × P_c × u_c + n_mem × 0.3725) × PUE × 0.001
```

| Symbol | Meaning |
|--------|---------|
| `t` | Execution time (seconds) |
| `n_c` | Number of CPU cores |
| `P_c` | Power per CPU core (W) |
| `u_c` | CPU utilization (0–1) |
| `n_mem` | Memory (GB); 0.3725 W/GB |
| `PUE` | Power Usage Effectiveness (default 1.3) |

### Operational Emissions (gCO2eq)

```
O = E × I
```

- `I` = Grid carbon intensity (gCO2eq/kWh); regional (e.g. India ~442, 2024).

### Embodied Emissions (gCO2eq)

```
M = TE × (TiR / EL) × (RR / ToR)
```

| Symbol | Meaning | Default |
|--------|---------|---------|
| **TE** | Total Embodied Carbon of hardware | 1,600,000 gCO2eq (mid-range server, Dell R740 / Boavizta) |
| **EL** | Expected hardware lifespan | 35,040 hours (4 years, ISO/IEC 21031) |
| **TiR** | Time in use per query | Query execution time in hours |
| **RR** | Resource Reserved ratio | 0.5 (shared server); 1.0 for dedicated |
| **ToR** | Total Resources | 1 (typical) |

### Software Carbon Intensity (SCI)

```
SCI = (O + M) / R
```

- `R` = Functional unit (1 SQL query).

---

## Sustainability Score (0–100)

Higher = greener. Composite of emissions, cost, duration, and rows.

```
S = 100 - clamp((w1×N_emissions + w2×N_cost + w3×N_duration + w4×N_rows) × 100, 0, 100)
```

### Normalization

- **Emissions & rows:** Log normalization to handle large ranges:
  - `N_emissions = log(SCI + 1) / log(SCI_baseline + 1)`
  - `N_rows = log(rows + 1) / log(rows_baseline + 1)`
- **Cost & duration:** Linear:
  - `N_cost = planner_cost / cost_baseline`
  - `N_duration = execution_ms / duration_baseline`

### Default Weights & Baselines

| Parameter | Default |
|-----------|---------|
| w1 (emissions) | 0.40 |
| w2 (planner cost) | 0.25 |
| w3 (duration) | 0.20 |
| w4 (rows examined) | 0.15 |
| SCI_baseline | 1.0 gCO2eq |
| cost_baseline | 10,000 (PostgreSQL cost units) |
| duration_baseline | 1,000 ms |
| rows_baseline | 100,000 |

Weights must sum to 1.0. Baselines and weights are configurable and snapshotted per analysis for reproducibility.

### Classification Tiers

| Score | Tier | Label |
|-------|------|-------|
| 90–100 | Excellent | Feasible, green |
| 70–89 | Good | Feasible |
| 50–69 | Moderate | Feasible with caveats |
| 25–49 | Poor | Not recommended |
| 0–24 | Critical | Infeasible (blockable in strict mode) |

---

## Dry-Run / Estimated Runtime

When `EXPLAIN ANALYZE` is not run or fails:

1. **Historical average:** Query fingerprint lookup in log DB; use average runtime if found.
2. **Planner cost proxy:** Use calibration factor × total plan cost (benchmark-derived).
3. **UI:** Results are flagged as `measured` vs `estimated` for confidence.

---

## Total CO2 Saved

`Total CO2 Saved = Σ (SCI_before - SCI_after)` for queries that were optimized and re-analyzed.

---

## Index Recommendations (Phase 3)

### 3-Step Pipeline

1. **Heuristic scan:** No extension. Scan EXPLAIN for Seq Scans and filter columns; produce candidate columns.
2. **hypopg simulation:** If available, create hypothetical indexes, re-run EXPLAIN; compute cost and SCI delta.
3. **Emit with confidence:**
   - **Simulated** — hypopg confirmed; show cost/SCI delta.
   - **Heuristic** — pattern-based only (no hypopg).

### hypopg Extension

- **Purpose:** Simulate hypothetical indexes in PostgreSQL without creating real indexes.
- **Install:** `CREATE EXTENSION hypopg;` on the target DB.
- **Optional:** If not installed, only heuristic suggestions are returned.

---

## Tools & Extensions

| Tool | Purpose |
|------|---------|
| **PostgreSQL** | App store + target dataset |
| **hypopg** | Hypothetical indexes for index recommendation simulation (PostgreSQL only) |
| **Node.js** | Backend runtime |
| **Express** | API server |
| **React + Vite** | Frontend |
| **pg** | PostgreSQL client |

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (two instances or two DBs)
- hypopg (optional): `CREATE EXTENSION hypopg;` on target DB

### Install

```bash
npm run install:all
```

### Configure

```bash
cp .env.example .env
# Edit .env with your DATABASE_URL (app store) and target DB config
```

### Initialize App DB

**Fresh install:**
```bash
psql $DATABASE_URL -f backend/scripts/init-schema.sql
```

**Existing DB (no conflict with existing `queries` table):**
```bash
psql $DATABASE_URL -f backend/scripts/init-querycarbon.sql
```

### Run

```bash
# Backend + frontend
npm run dev

# Or separately
npm run dev:backend   # http://localhost:5000
npm run dev:frontend  # http://localhost:3000
```

---

## API Endpoints

| Method | Route | Phase | Purpose |
|--------|-------|-------|---------|
| GET | `/api/health` | — | Health check |
| POST | `/api/analyze-query` | 1 | Run analysis; return emissions, score, tier |
| GET | `/api/query-history` | 2 | Paginated query list |
| GET | `/api/query-details/:id` | 2 | Full analysis for one query |
| GET | `/api/dashboard-stats` | 2 | KPIs, trends, Total CO2 Saved |
| GET | `/api/export-report` | 2 | Dashboard export |
| GET | `/api/export-csv` | 2 | Reports table as CSV |
| GET/PUT | `/api/settings` | 2 | Weights, tier thresholds, strict mode |
| POST | `/api/optimize-query` | 3 | Rewrite + index suggestions |
| POST | `/api/connect-db` | 4 | Save DB connection |
| GET | `/api/db-connections` | 4 | List connections |

---

## Project Phases

| Phase | Scope |
|-------|-------|
| **1** | Query ingestion, EXPLAIN ANALYZE, energy/gCO2eq estimation, classification |
| **2** | Evaluation & grading (scoring, dashboards, reports, export) |
| **3** | Query betterment (rewrites, index recommendations via heuristic + hypopg) |
| **4** | Multi-database support (MySQL, SQLite) |

See `plan.md` for implementation details and checklists.
