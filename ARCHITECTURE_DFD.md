# QueryCarbon - Data Flow Diagrams & System Architecture

**Document Version**: 1.0  
**Date**: March 6, 2026  
**Project**: QueryCarbon - SQL Query Carbon Footprint Analyzer  
**Status**: Production-Ready (v1.0.0)

---

## 📊 Table of Contents

1. [DFD Level 0 - System Context](#dfd-level-0--context-diagram)
2. [DFD Level 1 - Main Processes](#dfd-level-1--main-processes)
3. [DFD Level 2 - Carbon Calculation Detail](#dfd-level-2--detailed-process)
4. [System Block Diagram - Complete Architecture](#system-block-diagram)
5. [Phase-to-Architecture Mapping](#phase-mapping)
6. [Data Stores Reference](#data-stores-reference)
7. [Component Descriptions](#component-descriptions)

---

## DFD Level 0 – Context Diagram

### Overview
The **System Context Diagram** (Level 0) presents QueryCarbon as a single integrated process interacting with four external entities:

```
┌─────────────────────────────────────────┐
│         QueryCarbon System (Black Box)  │
│    - Query Analysis                     │
│    - Carbon Calculation                 │
│    - Scoring & Reporting                │
└─────────────────────────────────────────┘
         ↕                ↕                ↕
    Users         Admins        External Systems
```

### External Entities

| Entity | Type | Interaction | Data Flow |
|--------|------|-------------|-----------|
| **Database Engineer / User** | Human Actor | Input SQL queries, retrieve carbon reports | Queries → System → Reports |
| **System Administrator** | Human Actor | Configure grid intensity, hardware specs, manage system | Settings → System |
| **PostgreSQL Database** | Data Store | Execute queries, return execution plans and metrics | EXPLAIN output ← → Insert/Update results |
| **Grid Carbon Data Service** | External API | Provide regional grid carbon intensity values | Grid data → System |
| **Hardware Config Repository** | External Data | Provide hardware specifications and power ratings | Hardware specs → System |

### Inputs & Outputs

**Inputs:**
- SQL query (string)
- User configuration (region, hardware overrides, PUE factor)
- System settings (database connection, API keys)

**Outputs:**
- Carbon Footprint Report (PDF/JSON)
- Sustainability Score (0-100)
- Optimization Suggestions
- Analysis History

---

## DFD Level 1 – Main Processes

### Six Core Processes

```sql
P1.0  Query Reception & Validation
P2.0  Query Execution & Planning
P3.0  Carbon Calculation (see Level 2 for detail)
P4.0  Sustainability Scoring
P5.0  Report Generation
P6.0  Data Persistence
```

### Process Descriptions

#### **P1.0 - Query Reception & Validation**
- **Input**: SQL Query from user
- **Processing**:
  - Syntax validation
  - Security check (SQL injection prevention)
  - Schema verification against target database
  - Query normalization
- **Output**: Validated query details → D1 (Query Store)
- **Data Accessed**: None
- **Owned By**: [carbonController.js](backend/controllers/carbonController.js)

#### **P2.0 - Query Execution & Planning**
- **Input**: Validated query from P1.0
- **Processing**:
  - Execute `EXPLAIN ANALYZE` on PostgreSQL
  - Extract query plan metrics:
    - Execution time (ms)
    - Rows affected
    - CPU/IO operations
    - Plan cost
  - Measure actual runtime
- **Output**: Query metrics → P3.0
- **Data Accessed**: PostgreSQL (target database)
- **Owned By**: [hardwareDetector.js](backend/services/hardwareDetector.js), [carbonController.js](backend/controllers/carbonController.js)

#### **P3.0 - Carbon Calculation** ⭐ **[See Level 2 for detail]**
- **Input**: Query metrics + user settings
- **Processing**:
  - Calculate energy consumption
  - Calculate operational emissions
  - Calculate embodied emissions
  - Aggregate total emissions
  - Compute Software Carbon Intensity (SCI)
- **Output**: Emissions data → P4.0
- **Data Accessed**: D3, D4, D5, D8, D9
- **Owned By**: [carbonCalculator.js](backend/services/carbonCalculator.js)

#### **P4.0 - Sustainability Scoring**
- **Input**: Total emissions (O + M)
- **Processing**:
  - Normalize metrics (log/linear scale)
  - Apply weighted scoring formula
  - Map to 5-tier classification
  - Generate recommendations
- **Output**: Score (0-100), Grade (tier), recommendations
- **Data Accessed**: D9 (baseline metrics)
- **Logic Reference**:
  ```
  S = 100 - clamp((w₁×N_emissions + w₂×N_cost + w₃×N_duration + w₄×N_rows) × 100, 0, 100)
  
  w₁=0.40 (Emissions), w₂=0.25 (Cost), w₃=0.20 (Duration), w₄=0.15 (Rows)
  ```

#### **P5.0 - Report Generation**
- **Input**: Calculated emissions + score
- **Processing**:
  - Format results (JSON, PDF, CSV)
  - Generate dashboard visualizations
  - Create audit summary
  - Prepare export data
- **Output**: Report data → User, D6 (archive)
- **Data Accessed**: D1, D2, D3

#### **P6.0 - Data Persistence**
- **Input**: Results from P3.0, P4.0, P5.0
- **Processing**:
  - Store calculation history
  - Log audit trail
  - Archive reports
  - Update user analytics
- **Output**: None (storage only)
- **Data Accessed**: D2, D6, D8

---

## DFD Level 2 – Detailed Process

### **P3.0 Carbon Calculation - Decomposed**

The Carbon Calculation process (P3.0 from Level 1) is decomposed into 6 sub-processes:

```
P3.1  Hardware Detection & Config Loading
   ↓
P3.2  Energy Consumption Calculation
   ├→ P3.3  Operational Emissions Calculation
   ├→ P3.4  Embodied Emissions Calculation
   ↓
P3.5  Total Emissions & SCI Aggregation
   ↓
P3.6  Calculation Metadata & Audit Trail
```

#### **P3.1 - Hardware Detection & Config Loading**

**Purpose**: Determine system hardware specifications that will be used in energy calculations.

**Inputs**:
- Query execution metrics (time, rows, cost)
- User overrides (PUE factor, hardware profile)
- System environment variables

**Processing**:
```javascript
// From hardwareDetector.js
1. Check D4 (Hardware Config Cache)
2. If cached: return cached config
3. If not cached:
   a. Detect system CPU (physical cores)
   b. Detect RAM capacity (GB)
   c. Query hardware profile database
   d. Apply user overrides
   e. Cache result (immutable)
```

**Outputs**:
- Hardware configuration object:
  ```json
  {
    "cores": 8,
    "coresPerSocket": 4,
    "powerPerCore": 12,    // Watts
    "totalRam": 32,        // GB
    "pue": 1.3,           // Power Usage Effectiveness
    "cpuUtilization": 0.7 // Fraction 0-1
  }
  ```

**Data Accessed**:
- D4: Hardware Config Cache (read/write)
- External: Hardware Service API

**Code Location**: [hardwareDetector.js](backend/services/hardwareDetector.js)

---

#### **P3.2 - Energy Consumption Calculation**

**Purpose**: Calculate the electrical energy consumed by query execution using Green Algorithms 2021 formula.

**Formula**:
```
E = t × P × PUE / 1000

where:
  E     = Energy (kWh)
  t     = Execution time (seconds)
  P     = Total power consumption (watts)
  PUE   = Power Usage Effectiveness factor (1.0-2.5)
  1000  = Conversion factor (W→kW)

Expanded:
  P = (n_c × P_c × u_c) + (n_mem × 0.3725)
  
  where:
    n_c     = number of CPU cores
    P_c     = power per core (watts)
    u_c     = CPU utilization (0-1)
    n_mem   = RAM memory (GB)
    0.3725  = Memory power consumption (W/GB)
```

**Inputs**:
- From P3.1: Hardware config (cores, RAM, PUE)
- From P2.0: Query execution time (seconds)
- From user: CPU utilization percentage (if provided)

**Processing**:
```javascript
// From carbonCalculator.js
const cpuPower = cores * powerPerCore * cpuUtilization; // Watts
const memoryPower = ramGB * 0.3725;                     // Watts
const totalPower = cpuPower + memoryPower;              // Watts
const energyKwh = (executionTime * totalPower * pue) / 1000;
```

**Example**:
```
Query: SELECT * FROM customers (10 seconds)
  cores = 8, powerPerCore = 12W, utilization = 0.7, RAM = 32GB, PUE = 1.3
  
  cpuPower = 8 × 12 × 0.7 = 67.2 W
  memoryPower = 32 × 0.3725 = 11.92 W
  totalPower = 79.12 W
  
  E = (10 × 79.12 × 1.3) / 1000 = 1.029 kWh
```

**Outputs**:
- Energy value (kWh) with 9 decimal precision
- Intermediate power values (W)

**Data Accessed**: None (calculation only)

**References**:
- Green Algorithms 2021, Lannelongue et al.
- Source: https://arxiv.org/abs/2007.10883

---

#### **P3.3 - Operational Emissions Calculation**

**Purpose**: Convert energy consumption to CO₂ equivalent using regional grid data.

**Formula**:
```
O = E × I

where:
  O = Operational emissions (gCO2eq)
  E = Energy consumption (kWh) [from P3.2]
  I = Grid carbon intensity (gCO2eq/kWh) [region-specific]
```

**Inputs**:
- From P3.2: Energy consumption (kWh)
- From D5 or user: Grid intensity (gCO2eq/kWh)

**Processing**:
```javascript
// From carbonCalculator.js
const gridIntensity = getGridIntensity(userRegion); // from D5
const operationalEmissions = energyKwh * gridIntensity;
```

**Regional Grid Intensities (2024)**:

| Region | gCO2eq/kWh | Notes |
|--------|-----------|-------|
| **India** | 442 | Coal-heavy grid |
| **US Average** | 386 | EPA eGRID 2023 |
| **EU Average** | 233 | Ember 2023 |
| **Germany** | 187 | High wind/solar |
| **France** | 45 | Nuclear dominant |
| **Norway** | 12 | Hydro 98% |
| **Global Average** | 475 | Default (configurable) |

**Example**:
```
European Query:
  E = 1.029 kWh
  I = 233 gCO2eq/kWh
  O = 1.029 × 233 = 239.76 gCO2eq
```

**Outputs**:
- Operational emissions (gCO2eq) with 6 decimal precision

**Data Accessed**:
- D5: Regional Grid Intensity Mapping (read)

**References**:
- IEA World Energy Outlook 2023
- EPA eGRID: https://www.epa.gov/egrid
- Ember Global Electricity Review: https://ember-climate.org

---

#### **P3.4 - Embodied Emissions Calculation**

**Purpose**: Calculate the carbon footprint share from hardware manufacturing and lifecycle.

**Formula**:
```
M = TE × (TiR / EL) × (RR / ToR)

where:
  M    = Embodied emissions (gCO2eq)
  TE   = Total embodied carbon of hardware (gCO2eq)
  TiR  = Time in reporting period (hours)
  EL   = Expected hardware lifespan (hours)
  RR   = Resource reserved ratio (allocation factor 0-1)
  ToR  = Total operating time in period (hours)
```

**Detailed Parameters**:

| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| **TE** | 1,600,000 | 150K-2M | Dell R740 server lifecycle (ISO/IEC 21031) |
| **EL** | 35,040 | 26,280-43,800 | 4 years at 24×7×365 hours (ISO standard) |
| **TiR** | 0.000278 | Variable | Query execution time converted to hours |
| **RR** | 0.05 | 0.01-1.0 | Resource allocation: 0.05=5%, 1.0=100% |
| **ToR** | 11,000 | 8,760-11,000 | Annual operating hours (250 work days × 8h) |

**Processing**:
```javascript
// From carbonCalculator.js
const executionHours = executionSeconds / 3600;
const embodiedEmissions = TE * (executionHours / EL) * (RR / ToR);
```

**Example Calculation**:
```
Dedicated server, 1-second query:
  TE = 1,600,000 gCO2eq
  EL = 35,040 hours
  TiR = 1 second / 3600 = 0.000278 hours
  RR = 0.05 (5% allocation for single query)
  ToR = 11,000 hours (annual)
  
  M = 1,600,000 × (0.000278 / 35,040) × (0.05 / 11,000)
    = 1,600,000 × 7.93e-9 × 4.54e-6
    = 0.0000575 gCO2eq
```

**Outputs**:
- Embodied emissions (gCO2eq) with 6 decimal precision
- Allocation breakdown (if requested)

**Data Accessed**:
- D4: Hardware configuration (for TE, EL values)
- Parameter overrides from user

**References**:
- ISO/IEC 21031:2024
- Boavizta Hardware Impact Database: https://github.com/Boavizta/boavizta-data-model

---

#### **P3.5 - Total Emissions & SCI Aggregation**

**Purpose**: Combine operational and embodied emissions, compute Software Carbon Intensity (SCI).

**Formulas**:

```
Total Emissions:
  Total = O + M

Software Carbon Intensity (SCI):
  SCI = (O + M) / R
  
where:
  R = Functional unit (typically 1 per SQL query)
```

**Processing**:
```javascript
// From carbonCalculator.js
const totalEmissions = operationalEmissions + embodiedEmissions;
const sci = totalEmissions / 1;  // Per query

// SCI Classification
const sciGrade = classifySCI(sci);
```

**SCI Classification**:

| Range | Tier | Label | Action |
|-------|------|-------|--------|
| < 0.01 | ⭐⭐⭐⭐⭐ | EXCELLENT | Green light |
| 0.01–0.1 | ⭐⭐⭐⭐ | GOOD | Recommend pattern |
| 0.1–1.0 | ⭐⭐⭐ | ACCEPTABLE | Monitor |
| 1.0–5.0 | ⭐⭐ | MODERATE | Needs optimization |
| 5.0–10 | ⭐ | POOR | Urgent review |
| > 10 | ❌ | CRITICAL | Block/refactor |

**Example**:
```
Query Results:
  Operational Emissions = 239.76 gCO2eq
  Embodied Emissions = 0.0000575 gCO2eq
  
  Total = 239.76 gCO2eq
  SCI = 239.76 / 1 = 239.76 gCO2eq/query
  Grade: POOR (> 10)
```

**Outputs**:
- Total emissions (gCO2eq)
- SCI value (gCO2eq/query)
- Classification tier
- Comparative metrics

**Data Accessed**: D9 (baseline thresholds)

---

#### **P3.6 - Calculation Metadata & Audit Trail**

**Purpose**: Document all calculation parameters for reproducibility and auditing (ISO requirement).

**Stored Data Structure**:
```json
{
  "calculationId": "UUID",
  "timestamp": "2026-03-06T14:30:00Z",
  "queryId": "foreign_key → D1",
  
  "inputs": {
    "executionTime": 10.5,
    "executionTimeUnit": "seconds",
    "rowsAffected": 5000,
    "planCost": 2500
  },
  
  "hardwareConfig": {
    "cores": 8,
    "coresPerSocket": 4,
    "powerPerCore": 12,
    "totalRam": 32,
    "cpuUtilization": 0.7,
    "pue": 1.3,
    "source": "cached" | "detected"
  },
  
  "parameters": {
    "gridIntensity": 233,
    "gridRegion": "EU",
    "totalEmbodiedCarbon": 1600000,
    "hardwareExpectedLifespan": 35040,
    "resourceReservedRatio": 0.05,
    "totalOperatingHours": 11000
  },
  
  "calculations": {
    "cpuPowerWatts": 67.2,
    "memoryPowerWatts": 11.92,
    "totalPowerWatts": 79.12,
    "energyKwh": 1.029,
    "operationalEmissionsGco2eq": 239.76,
    "embodiedEmissionsGco2eq": 0.0000575,
    "totalEmissionsGco2eq": 239.76,
    "sci": 239.76
  },
  
  "formulasUsed": {
    "energy": "E = t × P × PUE / 1000",
    "operational": "O = E × I",
    "embodied": "M = TE × (TiR/EL) × (RR/ToR)",
    "sci": "SCI = (O+M) / R"
  },
  
  "references": {
    "energyMethod": "Green Algorithms 2021",
    "embodiedMethod": "ISO/IEC 21031:2024",
    "gridData": "IEA World Energy Outlook 2023"
  }
}
```

**Outputs**:
- Audit record → D8
- Audit trail JSON

**Data Accessed**:
- D8: Calculation Audit Log (write)

**Compliance**: Enables ISO 14064, GHG Protocol verification

---

## System Block Diagram

### Complete Architecture Overview

The System Block Diagram shows the final production architecture with all layers:

**Layers** (from top to bottom):

1. **Client Layer**: React frontend + API client
2. **API Gateway & Middleware**: Express router, auth, error handling
3. **Business Logic Layer**: Controllers, validators, rule engine
4. **Core Services**: Calculation engines and data processors
5. **Data Layer**: PostgreSQL with 4 tables (Queries, Analysis, Config, Audit)
6. **Reference Data & Caches**: Grid intensity, hardware specs, baselines
7. **External Integrations**: Target database, carbon APIs, hardware vendors
8. **Monitoring & Logging**: Application logging and metrics collection

### Key Architectural Features

**Separation of Concerns**:
- Frontend logic isolated in React components
- Business logic abstracted into controllers and services
- Data access centralized in PostgreSQL
- Calculation logic pure and testable

**Scalability Measures**:
- Stateless API design (horizontal scaling ready)
- Hardware config caching (reduces repeated detection)
- Query result caching (future Redis support)
- Connection pooling to PostgreSQL

**Security & Compliance**:
- Input validation layer (SQL injection prevention)
- Authentication & authorization middleware
- Rate limiting to prevent abuse
- Audit logging for all calculations (ISO requirement)
- Error handling that doesn't expose internals

---

## Phase Mapping

### Project Phases → Architecture Components

#### **Phase 1: gCO2 Weight Estimation** ✅ (COMPLETED)

**Components Involved**:
- P1.0 Query Reception & Validation
- P2.0 Query Execution & Planning
- P3.0 Carbon Calculation (all sub-processes)
- D1, D4, D5, D8 (data stores)
- [carbonCalculator.js](backend/services/carbonCalculator.js)
- [hardwareDetector.js](backend/services/hardwareDetector.js)

**Deliverables**:
- ✅ Energy consumption (kWh)
- ✅ Operational emissions (gCO2eq from grid)
- ✅ Embodied emissions (gCO2eq from hardware)
- ✅ Total emissions & SCI calculation

---

#### **Phase 2: Query Optimization Suggestions** (IN PROGRESS)

**Components to Implement**:
- RuleEngine (Index detection, JOIN hints, etc.)
- P4.0 Sustainability Scoring (needs enhancement)
- Dashboard recommendations UI

**Additional Data Stores**:
- D10: Query Patterns Database (new)
- D11: Index Rules Engine (new)

**Features**:
- ✅ Rule-based query analysis
- ✅ Index recommendations
- ✅ JOIN order optimization hints
- ✅ Partition strategy suggestions

**Code Location**: [indexRuleEngine.js](backend/services/indexRuleEngine.js)

---

#### **Phase 3: Evaluation & Grading Metrics** (PLANNED)

**Components to Add**:
- Enhanced P4.0 with grading matrix
- Metrics dashboard with comparative analysis
- Benchmarking engine

**Metrics to Add**:
- Query complexity scoring
- Performance vs. carbon trade-off analysis
- Efficiency percentile ranking
- SLA compliance metrics
- Cost-to-emissions ratio

**Data Stores**:
- D12: Benchmark Data (new)
- D13: Grading Thresholds (new)

---

#### **Phase 4: Multi-Database Support** (FUTURE)

**Components to Extend**:
- P2.0 Query Execution & Planning (MySQL, SQL Server, etc.)
- [hardwareDetector.js](backend/services/hardwareDetector.js) (driver-specific power consumption)
- Configuration management

**New Data Stores**:
- D14: Database Driver Profiles (new)
- D15: Database-Specific Grid Intensity (new)

**Supported Databases**:
- ✅ PostgreSQL (Phase 1/2/3)
- 🔄 MySQL (Phase 4)
- 🔄 SQL Server (Phase 4)
- 🔄 MongoDB (Phase 4, NoSQL variant)

---

## Data Stores Reference

### D1: Query Store
**Purpose**: Archive all submitted queries  
**Structure**:
```sql
CREATE TABLE queries (
  id UUID PRIMARY KEY,
  userId VARCHAR,
  sqlText TEXT,
  submittedAt TIMESTAMP,
  targetDatabase VARCHAR,
  status VARCHAR
);
```

### D2: Calculation History
**Purpose**: Track all calculation attempts and results  
**Structure**:
```sql
CREATE TABLE analysis_history (
  id UUID PRIMARY KEY,
  queryId UUID REFERENCES queries(id),
  energyKwh DECIMAL(12,9),
  operationalEmissions DECIMAL(12,6),
  embodiedEmissions DECIMAL(12,6),
  totalEmissions DECIMAL(12,6),
  sciScore DECIMAL(12,6),
  calculatedAt TIMESTAMP
);
```

### D3: User Configuration
**Purpose**: Store user-specific settings and preferences  
**Structure**:
```sql
CREATE TABLE user_config (
  userId VARCHAR PRIMARY KEY,
  preferredRegion VARCHAR DEFAULT 'Global',
  gridIntensityOverride DECIMAL(8,2),
  pueFactor DECIMAL(4,2),
  hardwareProfile VARCHAR,
  preferences JSONB
);
```

### D4: Hardware Specs
**Purpose**: Hardware configuration database (cached in memory)  
**Structure**:
```javascript
// In-memory cache (hardwareDetector.js)
{
  "cores": number,
  "coresPerSocket": number,
  "powerPerCore": number,    // Watts
  "totalRam": number,        // GB
  "pue": number,
  "cpuUtilization": number,
  "cacheTimestamp": timestamp
}
```

### D5: Regional Grid Data
**Purpose**: Grid carbon intensity by region  
**Structure**:
```sql
CREATE TABLE grid_intensity (
  region VARCHAR PRIMARY KEY,
  co2PerKwh DECIMAL(8,2),
  updatedAt TIMESTAMP,
  source VARCHAR,
  authority VARCHAR
);
```

### D6: Reports Archive
**Purpose**: Generated reports for export/audit  
**Structure**:
```sql
CREATE TABLE reports (
  id UUID PRIMARY KEY,
  analysisId UUID,
  format VARCHAR,  -- 'json', 'pdf', 'csv'
  content BYTEA,
  generatedAt TIMESTAMP
);
```

### D8: Calculation Audit Log
**Purpose**: Complete audit trail of all calculations (ISO compliant)  
**Structure**:
```sql
CREATE TABLE calculation_audit (
  id UUID PRIMARY KEY,
  analysisId UUID,
  auditData JSONB,
  formulasUsed JSONB,
  references JSONB,
  auditedAt TIMESTAMP
);
```

### D9: Baseline Metrics
**Purpose**: Reference thresholds for scoring  
**Structure**:
```javascript
{
  "sciBaseline": 0.1,
  "costBaseline": 5000,
  "durationBaseline": 500,  // ms
  "rowsBaseline": 10000,
  
  "sciTiers": {
    "EXCELLENT": [90, 100],
    "GOOD": [70, 89],
    "ACCEPTABLE": [50, 69],
    "MODERATE": [30, 49],
    "POOR": [10, 29],
    "CRITICAL": [0, 9]
  },
  
  "weights": {
    "emissions": 0.40,
    "cost": 0.25,
    "duration": 0.20,
    "rows": 0.15
  }
}
```

---

## Component Descriptions

### Backend Services

#### **carbonCalculator.js**
**Responsibility**: Core emissions calculation engine  
**Key Functions**:
- `calculateEnergy()` - Green Algorithms formula
- `calculateOperationalEmissions()` - Grid-based calculation
- `calculateEmbodiedEmissions()` - ISO/IEC 21031 formula
- `calculateSCI()` - Software Carbon Intensity aggregation
- `calculateScore()` - 0-100 sustainability scoring

**Key Constants**:
```javascript
DEFAULTS = {
  TE: 1,600,000,        // Total Embodied Carbon (gCO2eq)
  EL: 35,040,           // Expected Lifespan (hours)
  RR: 0.05,             // Resource Reserved Ratio
  ToR: 11,000,          // Total Operating Hours (annual)
  GRID_INTENSITY: 475,  // Global average (gCO2eq/kWh)
  PUE: 1.3,             // Power Usage Effectiveness
  MEMORY_POWER: 0.3725  // W/GB
};
```

---

#### **hardwareDetector.js**
**Responsibility**: Detect and cache hardware specifications  
**Key Functions**:
- `detectHardware()` - System introspection
- `getCachedConfig()` - Return cached or detect
- `applyUserOverrides()` - Apply configuration

**Caching Strategy**:
```javascript
// Immutable cache (set once per process)
let cachedConfig = null;

function getConfig() {
  if (!cachedConfig) {
    cachedConfig = detectAndCache();
  }
  return { ...cachedConfig }; // Return copy
}
```

---

#### **carbonController.js**
**Responsibility**: Orchestrate the analysis workflow  
**Key Functions**:
- `analyzeQuery()` - Main orchestration
- `executeQuery()` - EXPLAIN ANALYZE
- `calculateEmissions()` - Delegate to calculator
- `generateReport()` - Format results
- `storeResults()` - Persist to database

---

#### **indexRuleEngine.js** (Phase 2)
**Responsibility**: Query optimization suggestions  
**Planned Features**:
- Analyze missing indexes
- Suggest JOIN order improvements
- Recommend partitioning strategies
- Full-text search optimization hints

---

### Frontend Components

#### **Dashboard.jsx**
- System overview
- Recent analyses
- Sustainability metrics summary
- Trend charts

#### **AnalyzePage.jsx**
- Query input editor
- Configuration selectors
- Live results display
- Copy-to-clipboard functionality

#### **ReportsPage.jsx**
- Historical analysis list
- Export functionality (PDF, CSV)
- Comparative charts
- Copy-to-editor feature

#### **SettingsPage.jsx**
- User preferences
- Region selection
- Hardware configuration
- API key management

---

## References & Standards

### Scientific & Technical References

1. **Green Algorithms 2021**
   - Lannelongue, L., Gallo, G., Matasci, N., & Invernizzi, G.
   - "Quantifying the carbon emissions of machine learning"
   - *Journal of Machine Learning Research* (2021)
   - https://arxiv.org/abs/2007.10883

2. **ISO/IEC 21031:2024**
   - Environmental Information - Quantification and Communication of Embodied Carbon
   - Hardware lifecycle assessment standard

3. **Grid Carbon Data Sources**
   - IEA World Energy Outlook: https://www.iea.org/
   - EPA eGRID: https://www.epa.gov/egrid
   - Ember Global Electricity: https://ember-climate.org

4. **Hardware Specifications**
   - Boavizta: https://github.com/Boavizta/boavizta-data-model
   - TDP databases for server specifications

---

## Deployment Architecture

### Development Environment
```
Frontend: http://localhost:5173 (Vite dev server)
Backend: http://localhost:3001 (Node.js Express)
Database: localhost:5432 (PostgreSQL)
```

### Production Environment (Future)
- Frontend: CDN (CloudFront/Azure CDN) + S3
- Backend: Kubernetes (ECS/AKS) with autoscaling
- Database: RDS PostgreSQL with read replicas
- Cache: Redis for hardware config + query results
- Monitoring: CloudWatch/Application Insights + Datadog

---

## Future Enhancements

1. **Real-time Carbon Dashboards**
   - Live query emissions tracking
   - Departmental carbon budgeting

2. **Machine Learning Integration**
   - Predictive query profiling
   - Automated optimization suggestions

3. **Multi-cloud Support**
   - AWS, Azure, GCP cloud-specific carbon factors
   - Serverless (Lambda, Azure Functions) support

4. **Integration Ecosystem**
   - Datadog agent integration
   - Splunk carbon metrics ingestion
   - ServiceNow ITSM connector

5. **Regulatory Compliance**
   - GHG Protocol verification mode
   - ISO 14064 compliance reports
   - Scope 1/2/3 emissions tracking

---

**Document End**  
*For questions or updates, contact the QueryCarbon development team.*
