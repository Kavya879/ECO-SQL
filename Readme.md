# 🌱 ECO-SQL

### Environmental Carbon Optimization for SQL

ECO-SQL is a full-stack sustainability analyzer for PostgreSQL workloads that combines SQL query optimization with carbon footprint estimation. Unlike traditional query analyzers that focus only on performance, ECO-SQL evaluates the environmental impact of SQL queries using execution time, planner cost, CPU usage, memory consumption, and Power Usage Effectiveness (PUE).

The system estimates operational and embodied carbon emissions using the Software Carbon Intensity (SCI) framework and provides optimization suggestions to promote greener database engineering practices.

---

# 🚀 Features

## 🔍 Query Carbon Analysis

* Measures query-level energy consumption
* Estimates operational and embodied carbon emissions
* Calculates Software Carbon Intensity (SCI)
* Sustainability score generation

## ⚡ SQL Optimization Engine

Detects SQL anti-patterns such as:

* Leading wildcard LIKE
* Correlated subqueries
* UNION without ALL
* Large OFFSET usage
* SELECT *
* NOT IN subqueries
* Implicit type coercion
* HAVING without GROUP BY
* Repeated OR equality conditions

## 🧠 Optimization Simulation

* Hypothetical index simulation using HypoPG
* Planner hint evaluation using pg_hint_plan
* SCI delta estimation before applying optimizations

## 📊 Interactive Dashboard

* Carbon emission trends
* Sustainability tier distribution
* Query history & analytics
* CSV export support
* Historical analysis tracking

---

# 🏗️ System Architecture

```text
Frontend (React + Vite)
        ↓
REST API (Node.js + Express)
        ↓
PostgreSQL Backend
        ↓
Carbon Calculation + Optimization Engine
```

---

# 🛠️ Tech Stack

| Category          | Technologies             |
| ----------------- | ------------------------ |
| Frontend          | React.js, Vite, Recharts |
| Backend           | Node.js, Express.js      |
| Database          | PostgreSQL               |
| Visualization     | Recharts                 |
| SQL Analysis      | EXPLAIN (FORMAT JSON)    |
| Extensions        | HypoPG, pg_hint_plan     |
| API Communication | Axios                    |
| Routing           | React Router             |

---

# 📌 Core Modules

## 1️⃣ Query Analysis Module

* Executes SQL queries
* Measures runtime
* Extracts planner cost
* Computes energy usage and emissions

## 2️⃣ Optimization Engine

* Rule-based SQL anti-pattern detection
* EXPLAIN plan inspection
* Optimization recommendations

## 3️⃣ Dashboard Module

* Trend analysis
* Sustainability metrics
* Visualization of emissions and query statistics

## 4️⃣ History & Reporting Module

* Query history persistence
* CSV export
* Pagination and filtering

## 5️⃣ Hardware Configuration Module

* Auto-detects hardware assumptions
* Allows configurable overrides for:

  * PUE
  * CPU utilization
  * Grid carbon intensity
  * Hardware lifespan

---

# 📈 Sustainability Scoring

Queries are classified into five sustainability tiers:

| Score Range | Tier         |
| ----------- | ------------ |
| 90 – 100    | 🟢 EXCELLENT |
| 75 – 89     | 🟢 GOOD      |
| 50 – 74     | 🟡 MODERATE  |
| 25 – 49     | 🟠 POOR      |
| 0 – 24      | 🔴 CRITICAL  |

---

# ⚙️ Carbon Estimation Model

ECO-SQL estimates:

* ⚡ Energy Consumption
* 🌍 Operational Emissions
* 🏭 Embodied Emissions
* 📉 Software Carbon Intensity (SCI)

using:

* CPU utilization
* Memory draw
* Runtime
* Power Usage Effectiveness (PUE)
* Grid carbon intensity
* Hardware amortization

---

# 📂 Project Structure

```bash
ECO-SQL/
│
├── frontend/
│   ├── src/
│   ├── pages/
│   ├── components/
│   └── charts/
│
├── backend/
│   ├── routes/
│   ├── controllers/
│   ├── services/
│   ├── database/
│   └── utils/
│
├── docs/
├── screenshots/
└── README.md
```

---

# 🧪 Supported SQL Anti-Patterns

* NOT IN Subqueries
* Correlated NOT EXISTS
* SELECT *
* DISTINCT with JOIN
* UNION without ALL
* Leading Wildcard LIKE
* Large OFFSET
* Implicit Type Coercion
* HAVING without GROUP BY
* Correlated SELECT Subqueries
* COUNT(column) instead of COUNT(*)

---

# 📷 Screenshots

## Dashboard

*Add dashboard screenshot here*

## Query Analysis

*Add analyzer screenshot here*

## Reports & History

*Add reports screenshot here*

---

# 🔧 Installation

## Prerequisites

* Node.js >= 18
* npm >= 9
* PostgreSQL >= 14

---

## Clone Repository

```bash
git clone https://github.com/your-username/ECO-SQL.git
cd ECO-SQL
```

---

## Backend Setup

```bash
cd backend
npm install
```

Create `.env` file:

```env
PORT=3001

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=postgres

CORS_ORIGIN=http://localhost:5173
```

Run backend:

```bash
npm run dev
```

---

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

---

# 🧩 Optional PostgreSQL Extensions

Enable optional extensions for advanced optimization simulation:

```sql
CREATE EXTENSION hypopg;
CREATE EXTENSION pg_hint_plan;
```

---

# 📊 API Endpoints

| Endpoint               | Description               |
| ---------------------- | ------------------------- |
| `/api/analyze`         | Analyze SQL query         |
| `/api/dashboard`       | Dashboard analytics       |
| `/api/history`         | Query history             |
| `/api/databases`       | List PostgreSQL databases |
| `/api/hardware-config` | Hardware assumptions      |

---

# ⚠️ Important Safety Notice

ECO-SQL executes submitted SQL queries directly against the selected PostgreSQL database.

✅ Recommended:

* Development databases
* Test databases
* Staging environments

❌ Avoid:

* Production databases
* Critical live systems

---

# 📈 Experimental Results

ECO-SQL demonstrated:

* Reduced estimated carbon emissions
* Better sustainability scores
* Improved query efficiency
* Better SQL optimization awareness

---

# 🌍 Sustainable Development Goals (SDGs)

This project contributes toward:

* ♻️ SDG 7 – Affordable and Clean Energy
* 🏗️ SDG 9 – Industry, Innovation and Infrastructure
* 🌎 SDG 13 – Climate Action

---

# 🔮 Future Scope

* MySQL and SQL Server support
* Real-time electricity grid integration
* ML-based query sustainability prediction
* CI/CD integration
* Automatic SQL rewrite suggestions
* Dockerized deployment
* Multi-user support


# 📚 References

Research references and methodologies are included in the project report.

---

# 📜 License

This project is developed for academic and research purposes.

---

# ⭐ If you like this project

Give this repository a ⭐ on GitHub!
