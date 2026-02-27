# QueryCarbon — SQL Carbon Footprint Analyzer

> Phase 1: Estimate carbon emissions (gCO₂eq) for any SQL query using the Green Algorithms framework.

## Tech Stack
- **Frontend**: React 18, Vite, Recharts, Axios
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL (via `pg`)

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL running locally

### 1. Clone & setup backend

```bash
cd backend
cp .env.example .env
# Edit .env with your PostgreSQL credentials
npm install
npm run dev
```

### 2. Setup frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173  
Backend API: http://localhost:3001

## Environment Variables (backend/.env)

```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=yourpassword
DB_NAME=postgres
PORT=3001
CORS_ORIGIN=http://localhost:5173
```

## Formulas (Lannelongue et al., 2021)

```
E  = t × (n_c × P_c × u_c + n_mem × 0.3725) × PUE × 0.001   [kWh]
O  = E × I                                                      [gCO₂eq]
M  = TE × (TiR / EL) × (RR / ToR)                             [gCO₂eq]
SCI = (O + M) / R                                               [gCO₂/query]
```

## Classification
- **Sustainable**: 0–2.0 gCO₂eq
- **Moderate**: 2.0–5.0 gCO₂eq
- **High Impact**: 5.0+ gCO₂eq

## Notes
- No authentication required (Phase 1)
- Works with any PostgreSQL database/table — just select from the dropdown
- Query history is stored in `querycarbon_history` table (auto-created)
