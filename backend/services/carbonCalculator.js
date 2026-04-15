/**
 * Carbon Calculator Service
 * References: Green Algorithms 2021 (Lannelongue et al.), ISO/IEC 21031:2024
 */

const indexRuleEngine = require('./indexRuleEngine');

// ===== CONSTANTS =====
const DEFAULTS = {
  PUE: 1.3, // Power Usage Effectiveness
  TE: 150000, // Total Embodied Carbon (gCO2eq) - typical desktop/workstation
  EL: 48180, // Expected hardware lifespan (hours) - 5.5 years
  RR: 0.05, // Resource Reserved ratio (~5% for single query)
  ToR: 11000, // Total Operating time (hours) - 1 year at 8h/day, 250 days
  MEM_POWER: 0.3725, // W/GB
  GRID_INTENSITY: 475, // gCO2eq/kWh - global average (2024)
};

const WEIGHTS = {
  emissions: 0.40,
  cost: 0.25,
  duration: 0.20,
  rows: 0.15,
};

const BASELINES = {
  SCI: 0.1, // gCO2eq - typical for small-medium queries
  cost: 5000, // PostgreSQL cost units - typical for average query (1-10k range)
  duration: 500, // ms - typical query execution time (sweet spot for avg queries)
  rows: 10000, // rows - typical result set size
};

const CLASSIFICATION_TIERS = {
  EXCELLENT: { min: 90, max: 100, label: 'Excellent', description: 'Feasible, green' },
  GOOD: { min: 70, max: 89, label: 'Good', description: 'Feasible' },
  MODERATE: { min: 50, max: 69, label: 'Moderate', description: 'Feasible with caveats' },
  POOR: { min: 25, max: 49, label: 'Poor', description: 'Not recommended' },
  CRITICAL: { min: 0, max: 24, label: 'Critical', description: 'Infeasible (blockable in strict mode)' },
};

const SEVERITY_THRESHOLDS = {
  // Sustainability score thresholds (lower is worse)
  CRITICAL_sustainability: 20,
  HIGH_sustainability: 40,
  MEDIUM_sustainability: 60,
  
  // SCI multipliers
  CRITICAL_sci_multiplier: 5,
  HIGH_sci_multiplier: 3,
  MEDIUM_sci_multiplier: 1.5,
  
  // Runtime multipliers (ms)
  CRITICAL_runtime_multiplier: 10,
  HIGH_runtime_multiplier: 5,
  MEDIUM_runtime_multiplier: 2,
  
  // Inefficiency ratio (node_plan_rows / rows_returned)
  CRITICAL_inefficiency_ratio: 1000,
  HIGH_inefficiency_ratio: 500,
  MEDIUM_inefficiency_ratio: 100,
  
  // Baseline metrics for comparison
  baseline_sci: 10, // gCO2eq
  baseline_runtime_ms: 1000, // milliseconds
};

/**
 * Clamp value between min and max
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Energy Calculation
 * E = t(hours) × (n_c × P_c × u_c + n_mem × P_mem) × PUE / 1000
 * Formula: Energy (kWh) = Time (hours) × Power (W) × PUE / 1000
 *
 * @param {object} params
 * @param {number} params.executionSeconds - Execution time in seconds
 * @param {number} params.cpuCores - Number of CPU cores
 * @param {number} params.powerPerCore - Power per CPU core (W)
 * @param {number} params.cpuUtilization - CPU utilization (0-1)
 * @param {number} params.memoryGb - Memory (GB)
 * @param {number} params.pue - Power Usage Effectiveness (default 1.3)
 * @returns {number} Energy in kWh
 */
function calculateEnergy({
  executionSeconds,
  cpuCores,
  powerPerCore,
  cpuUtilization,
  memoryGb,
  pue = DEFAULTS.PUE,
}) {
  // CPU power consumption
  const cpuPower = cpuCores * powerPerCore * cpuUtilization;
  // Memory power consumption
  const memPower = memoryGb * DEFAULTS.MEM_POWER;
  // Total instantaneous power draw
  const totalPower = cpuPower + memPower;
  
  // Convert seconds to hours and calculate energy consumption
  const executionHours = executionSeconds / 3600;
  // Energy = hours * watts * PUE / 1000 to get kWh
  const energyKwh = (executionHours * totalPower * pue) / 1000;
  
  return energyKwh;
}

/**
 * Operational Emissions
 * O = E × I (Green Algorithms 2021, Eq. 5)
 * Where E = Energy (kWh), I = Grid carbon intensity (gCO2eq/kWh)
 *
 * @param {number} energyKwh - Energy consumed (kWh)
 * @param {number} gridIntensity - Grid carbon intensity (gCO2eq/kWh)
 * @returns {number} Operational emissions (gCO2eq)
 */
function calculateOperationalEmissions(energyKwh, gridIntensity = DEFAULTS.GRID_INTENSITY) {
  // Direct multiplication: kWh * gCO2/kWh = gCO2eq
  return energyKwh * gridIntensity;
}

/**
 * Embodied Emissions (Green Algorithms 2021, Eq. 7)
 * M = TE × (T_I/E_L) × (R_R/ToR)
 * Where:
 *   TE = Total embodied carbon (gCO2eq)
 *   T_I = Time in use (hours)
 *   E_L = Expected lifespan (hours)
 *   R_R = Reserved resources (fraction)
 *   ToR = Total operating time (hours)
 *
 * @param {object} params
 * @param {number} params.executionSeconds - Query execution time (seconds)
 * @param {number} params.te - Total embodied carbon (gCO2eq)
 * @param {number} params.el - Expected hardware lifespan (hours)
 * @param {number} params.rr - Resource Reserved ratio (0-1)
 * @param {number} params.tor - Total operating time (hours)
 * @returns {number} Embodied emissions (gCO2eq)
 */
function calculateEmbodiedEmissions({
  executionSeconds,
  te = DEFAULTS.TE,
  el = DEFAULTS.EL,
  rr = DEFAULTS.RR,
  tor = DEFAULTS.ToR,
}) {
  // Convert execution time from seconds to hours (T_I)
  const timeInUseHours = executionSeconds / 3600;
  // Embodied emissions = TE × (T_I / E_L) × (R_R / ToR)
  const embodiedEmissions = te * (timeInUseHours / el) * (rr / tor);
  
  return embodiedEmissions;
}

/**
 * Software Carbon Intensity
 * SCI = (O + M) / R
 * R = Functional unit (1 SQL query)
 *
 * @param {number} operationalEmissions - gCO2eq
 * @param {number} embodiedEmissions - gCO2eq
 * @returns {number} SCI in gCO2eq per query
 */
function calculateSCI(operationalEmissions, embodiedEmissions) {
  const R = 1; // Functional unit: 1 SQL query
  return (operationalEmissions + embodiedEmissions) / R;
}

/**
 * Normalize emissions using log scale to handle large ranges
 * N_emissions = log(SCI + 1) / log(SCI_baseline + 1)
 *
 * @param {number} sci - Software Carbon Intensity
 * @param {number} baseline - SCI baseline (default 1.0)
 * @returns {number} Normalized emissions (0-1 range)
 */
function normalizeEmissions(sci, baseline = BASELINES.SCI) {
  return Math.log(sci + 1) / Math.log(baseline + 1);
}

/**
 * Normalize rows examined using log scale
 * N_rows = log(rows + 1) / log(rows_baseline + 1)
 *
 * @param {number} rows - Rows examined
 * @param {number} baseline - Rows baseline (default 100,000)
 * @returns {number} Normalized rows (0-1 range)
 */
function normalizeRows(rows, baseline = BASELINES.rows) {
  return Math.log(rows + 1) / Math.log(baseline + 1);
}

/**
 * Normalize cost using log scale (like emissions) to handle large ranges
 * N_cost = log(cost + 1) / log(baseline + 1)
 *
 * @param {number} cost - Planner cost
 * @param {number} baseline - Cost baseline (default 5,000)
 * @returns {number} Normalized cost
 */
function normalizeCost(cost, baseline = BASELINES.cost) {
  // Use log scale to cap the impact of very high costs
  return Math.log(cost + 1) / Math.log(baseline + 1);
}

/**
 * Normalize duration using linear scale
 * N_duration = execution_ms / duration_baseline
 *
 * @param {number} durationMs - Execution duration (milliseconds)
 * @param {number} baseline - Duration baseline (default 500 ms)
 * @returns {number} Normalized duration
 */
function normalizeDuration(durationMs, baseline = BASELINES.duration) {
  return durationMs / baseline;
}

/**
 * Calculate Sustainability Score (0-100)
 * S = 100 - clamp((w1×N_emissions + w2×N_cost + w3×N_duration + w4×N_rows) × 100, 0, 100)
 * Higher = greener
 *
 * @param {object} params
 * @param {number} params.sci - Software Carbon Intensity (gCO2eq)
 * @param {number} params.plannerCost - PostgreSQL planner cost
 * @param {number} params.executionMs - Execution duration (milliseconds)
 * @param {number} params.rowsExamined - Rows examined
 * @param {object} params.weights - Custom weights (optional)
 * @param {object} params.baselines - Custom baselines (optional)
 * @returns {number} Sustainability score (0-100)
 */
function calculateSustainabilityScore({
  sci,
  plannerCost,
  executionMs,
  rowsExamined,
  weights = WEIGHTS,
  baselines = BASELINES,
}) {
  // Normalize all metrics
  const normEmissions = normalizeEmissions(sci, baselines.SCI);
  const normCost = normalizeCost(plannerCost, baselines.cost);
  const normDuration = normalizeDuration(executionMs, baselines.duration);
  const normRows = normalizeRows(rowsExamined, baselines.rows);

  // Calculate weighted sum
  const weightedSum =
    weights.emissions * normEmissions +
    weights.cost * normCost +
    weights.duration * normDuration +
    weights.rows * normRows;

  // Apply formula: subtract from 100 and scale
  const score = 100 - clamp(weightedSum * 100, 0, 100);

  return Math.round(score);
}

/**
 * Classify sustainability score into tiers
 *
 * @param {number} score - Sustainability score (0-100)
 * @returns {object} Tier information with label and description
 */
function classifyScore(score) {
  for (const [key, tier] of Object.entries(CLASSIFICATION_TIERS)) {
    if (score >= tier.min && score <= tier.max) {
      return {
        tier: key,
        label: tier.label,
        description: tier.description,
        score,
      };
    }
  }
  // Fallback (shouldn't happen with proper clamping)
  return {
    tier: 'CRITICAL',
    label: 'Critical',
    description: 'Infeasible (blockable in strict mode)',
    score: 0,
  };
}

/**
 * IMPROVEMENT PATTERN DETECTION AND ANALYSIS
 * Detects SQL anti-patterns and estimates optimization potential
 */

/**
 * Detect all applicable optimization patterns in query plan and SQL
 * Returns array of { pattern, runtime_reduction_pct }
 *
 * @param {object} params
 * @param {string} params.sql - SQL query text
 * @param {number} params.plan_rows - Rows in query plan (scanned rows)
 * @param {number} params.rows_returned - Actual rows returned
 * @param {object} params.query_plan - PostgreSQL EXPLAIN plan (optional)
 * @returns {Array} Array of detected patterns with reduction percentages
 */
function detectOptimizationPatterns({
  sql = '',
  plan_rows = 0,
  rows_returned = 1,
  query_plan = null,
}) {
  const patterns = [];

  if (!sql) return patterns;

  const sqlUpper = sql.toUpperCase().replace(/\s+/g, ' ').trim();

  // 1. Seq Scan → Index (plan_rows > 10000): 70%, else 40%
  if (sqlUpper.includes('SEQSCAN') || /FROM\s+\w+\s+WHERE/i.test(sql)) {
    const reduction = plan_rows > 10000 ? 70 : 40;
    patterns.push({ pattern: 'SEQ_SCAN_WITHOUT_INDEX', runtime_reduction_pct: reduction });
  }

  // 2. Hash Join → Index Nested Loop: 50%
  if (sqlUpper.includes('HASHJOIN') || /\bJOIN\b.*\bJOIN\b/i.test(sql)) {
    patterns.push({ pattern: 'HASH_JOIN_CANDIDATE', runtime_reduction_pct: 50 });
  }

  // 3. Sort without index: 30%
  if (sqlUpper.includes('SORT') || /ORDER\s+BY\s+(?!.*INDEX)/i.test(sql)) {
    patterns.push({ pattern: 'SORT_WITHOUT_INDEX', runtime_reduction_pct: 30 });
  }

  // 4. Correlated subquery: 55%
  if (/\(SELECT.*FROM.*WHERE.*\.[\w]+\s*=\s*[\w]+\.[\w]+\)/i.test(sql) || 
      /EXISTS\s*\(/i.test(sql)) {
    patterns.push({ pattern: 'CORRELATED_SUBQUERY', runtime_reduction_pct: 55 });
  }

  // 5. Missing LIMIT: 60%
  if (!sqlUpper.includes('LIMIT') && (sqlUpper.includes('SELECT') && 
      Math.abs(plan_rows - rows_returned) > rows_returned * 5)) {
    patterns.push({ pattern: 'MISSING_LIMIT', runtime_reduction_pct: 60 });
  }

  // 6. Aggregation without index: 35%
  if (sqlUpper.includes('GROUP BY') || /COUNT\s*\(|SUM\s*\(|AVG\s*\(/i.test(sql)) {
    patterns.push({ pattern: 'AGGREGATION_WITHOUT_INDEX', runtime_reduction_pct: 35 });
  }

  // 7. N+1 subquery pattern (SELECT x WHERE id IN (SELECT...)) or EXISTS: 65%
  if (/WHERE\s+\w+\s+IN\s*\(SELECT/i.test(sql) || /EXISTS\s*\(SELECT/i.test(sql)) {
    patterns.push({ pattern: 'N_PLUS_ONE_SUBQUERY', runtime_reduction_pct: 65 });
  }

  // 8. Materialized view candidate (repeated GROUP BY + JOIN): 45%
  if ((sqlUpper.match(/GROUP\s+BY/g) || []).length > 0 && 
      (sqlUpper.match(/JOIN/g) || []).length >= 2) {
    patterns.push({ pattern: 'MATERIALIZED_VIEW_CANDIDATE', runtime_reduction_pct: 45 });
  }

  // 9. Result cache hit potential (repetitive query pattern): 80%
  // This is detected when same aggregations or joins appear multiple times
  if ((sqlUpper.match(/COUNT \*|COUNT \(/g) || []).length > 1 ||
      (sqlUpper.match(/SELECT/g) || []).length > 1) {
    patterns.push({ pattern: 'RESULT_CACHE_CANDIDATE', runtime_reduction_pct: 80 });
  }

  return patterns;
}

/**
 * Combine multiple rule improvements using multiplicative formula:
 * total = 1 - product of (1 - r_i/100) for each triggered rule
 *
 * @param {Array<number>} reductions - Array of reduction percentages
 * @returns {number} Combined reduction percentage
 */
function combineImprovements(reductions) {
  if (!reductions || reductions.length === 0) return 0;
  if (reductions.length === 1) return reductions[0];

  // 1 - (1-r1/100) * (1-r2/100) * (1-r3/100) ... = combined improvement
  const product = reductions.reduce((acc, r) => {
    return acc * (1 - r / 100);
  }, 1);

  return Math.round((1 - product) * 100 * 100) / 100; // 2 decimal places
}

/**
 * Calculate estimated improvements from applying detected patterns
 *
 * @param {object} params
 * @param {string} params.sql - SQL query text
 * @param {number} params.plan_rows - Rows examined in plan
 * @param {number} params.rows_returned - Rows actually returned
 * @param {number} params.current_runtime_ms - Current query runtime
 * @param {number} params.current_sci_gco2 - Current SCI score
 * @param {number} params.grid_carbon_intensity - Grid carbon intensity gCO2/kWh (default 475)
 * @param {object} params.query_plan - PostgreSQL query plan (optional)
 * @returns {object} Improvement estimates with patterns and savings
 */
function calculateImprovementEstimate({
  sql = '',
  plan_rows = 0,
  rows_returned = 1,
  current_runtime_ms = 0,
  current_sci_gco2 = 0,
  grid_carbon_intensity = 475,
  query_plan = null,
}) {
  // Detect applicable patterns
  const patterns = detectOptimizationPatterns({
    sql,
    plan_rows,
    rows_returned,
    query_plan,
  });

  if (patterns.length === 0) {
    return {
      patterns_detected: [],
      combined_runtime_reduction_pct: 0,
      combined_cost_reduction_pct: 0,
      combined_carbon_reduction_pct: 0,
      estimated_runtime_improved_ms: current_runtime_ms,
      estimated_sci_improved_gco2: current_sci_gco2,
      improvement_potential_high: false,
    };
  }

  // Extract reduction percentages
  const reductions = patterns.map(p => p.runtime_reduction_pct);

  // Combine improvements using multiplicative formula
  const runtime_reduction_pct = combineImprovements(reductions);

  // Cost reduction = runtime_reduction * 0.85
  const cost_reduction_pct = Math.round(runtime_reduction_pct * 0.85 * 100) / 100;

  // Carbon reduction = runtime_reduction * (1 + (grid_intensity - 400) / 1000)
  const carbon_multiplier = 1 + (grid_carbon_intensity - 400) / 1000;
  const carbon_reduction_pct = Math.round(runtime_reduction_pct * carbon_multiplier * 100) / 100;

  // Calculate absolute improvements
  const estimated_runtime_improved_ms = current_runtime_ms * (1 - runtime_reduction_pct / 100);
  const estimated_sci_improved_gco2 = current_sci_gco2 * (1 - carbon_reduction_pct / 100);

  // High improvement potential: > 30% combined reduction
  const improvement_potential_high = runtime_reduction_pct > 30;

  return {
    patterns_detected: patterns.map(p => ({
      pattern: p.pattern,
      runtime_reduction_pct: p.runtime_reduction_pct,
    })),
    combined_runtime_reduction_pct: runtime_reduction_pct,
    combined_cost_reduction_pct: cost_reduction_pct,
    combined_carbon_reduction_pct: carbon_reduction_pct,
    estimated_runtime_improved_ms: Math.round(estimated_runtime_improved_ms * 100) / 100,
    estimated_sci_improved_gco2: Math.round(estimated_sci_improved_gco2 * 1e6) / 1e6,
    improvement_potential_high: improvement_potential_high,
    recommendations: generateRecommendations(patterns),
  };
}

/**
 * Generate actionable recommendations based on detected patterns
 *
 * @param {Array} patterns - Array of detected pattern objects
 * @returns {Array<string>} List of recommendations
 */
function generateRecommendations(patterns) {
  const recommendations = [];
  const patternSet = new Set(patterns.map(p => p.pattern));

  if (patternSet.has('SEQ_SCAN_WITHOUT_INDEX')) {
    recommendations.push('Create index on WHERE clause columns');
  }
  if (patternSet.has('HASH_JOIN_CANDIDATE')) {
    recommendations.push('Consider index nested loop join or denormalization');
  }
  if (patternSet.has('SORT_WITHOUT_INDEX')) {
    recommendations.push('Add index on ORDER BY columns');
  }
  if (patternSet.has('CORRELATED_SUBQUERY')) {
    recommendations.push('Replace correlated subquery with JOIN');
  }
  if (patternSet.has('MISSING_LIMIT')) {
    recommendations.push('Add LIMIT clause to reduce result set');
  }
  if (patternSet.has('AGGREGATION_WITHOUT_INDEX')) {
    recommendations.push('Index columns used in GROUP BY / aggregation');
  }
  if (patternSet.has('N_PLUS_ONE_SUBQUERY')) {
    recommendations.push('Use JOIN instead of IN/EXISTS subquery');
  }
  if (patternSet.has('MATERIALIZED_VIEW_CANDIDATE')) {
    recommendations.push('Create materialized view for repeated aggregations');
  }
  if (patternSet.has('RESULT_CACHE_CANDIDATE')) {
    recommendations.push('Enable query result caching for repetitive queries');
  }

  return recommendations;
}

/**
 * Calculate severity score based on multiple performance and efficiency factors
 *
 * @param {object} params
 * @param {number} params.sustainability_score - Sustainability score (0-100)
 * @param {number} params.sci_score - Software Carbon Intensity (gCO2eq)
 * @param {number} params.runtime_ms - Query execution time (milliseconds)
 * @param {number} params.node_plan_rows - Rows examined (from query plan)
 * @param {number} params.rows_returned - Rows returned to user
 * @param {object} params.thresholds - Custom thresholds (optional, uses SEVERITY_THRESHOLDS defaults)
 * @returns {object} Severity info with level, flags, and comparative metrics
 */
function calculateSeverityScore({
  sustainability_score,
  sci_score,
  runtime_ms,
  node_plan_rows = 0,
  rows_returned = 1, // Avoid division by zero
  thresholds = SEVERITY_THRESHOLDS,
}) {
  // Calculate inefficiency ratio (how many rows examined per row returned)
  const inefficiencyRatio = rows_returned > 0 ? node_plan_rows / rows_returned : node_plan_rows;

  // Score flags for each severity level
  const criticalFlags = [];
  const highFlags = [];
  const mediumFlags = [];

  // === CRITICAL CHECKS ===
  if (sustainability_score < thresholds.CRITICAL_sustainability) {
    criticalFlags.push('sustainability_score');
  }
  if (sci_score > thresholds.baseline_sci * thresholds.CRITICAL_sci_multiplier) {
    criticalFlags.push('sci_score');
  }
  if (runtime_ms > thresholds.baseline_runtime_ms * thresholds.CRITICAL_runtime_multiplier) {
    criticalFlags.push('runtime_ms');
  }
  if (inefficiencyRatio > thresholds.CRITICAL_inefficiency_ratio) {
    criticalFlags.push('inefficiency_ratio');
  }

  // === HIGH CHECKS ===
  if (sustainability_score >= thresholds.CRITICAL_sustainability && 
      sustainability_score < thresholds.HIGH_sustainability) {
    highFlags.push('sustainability_score');
  }
  if (sci_score > thresholds.baseline_sci * thresholds.HIGH_sci_multiplier &&
      sci_score <= thresholds.baseline_sci * thresholds.CRITICAL_sci_multiplier) {
    highFlags.push('sci_score');
  }
  if (runtime_ms > thresholds.baseline_runtime_ms * thresholds.HIGH_runtime_multiplier &&
      runtime_ms <= thresholds.baseline_runtime_ms * thresholds.CRITICAL_runtime_multiplier) {
    highFlags.push('runtime_ms');
  }
  if (inefficiencyRatio > thresholds.HIGH_inefficiency_ratio &&
      inefficiencyRatio <= thresholds.CRITICAL_inefficiency_ratio) {
    highFlags.push('inefficiency_ratio');
  }

  // === MEDIUM CHECKS ===
  if (sustainability_score >= thresholds.HIGH_sustainability && 
      sustainability_score < thresholds.MEDIUM_sustainability) {
    mediumFlags.push('sustainability_score');
  }
  if (sci_score > thresholds.baseline_sci * thresholds.MEDIUM_sci_multiplier &&
      sci_score <= thresholds.baseline_sci * thresholds.HIGH_sci_multiplier) {
    mediumFlags.push('sci_score');
  }
  if (runtime_ms > thresholds.baseline_runtime_ms * thresholds.MEDIUM_runtime_multiplier &&
      runtime_ms <= thresholds.baseline_runtime_ms * thresholds.HIGH_runtime_multiplier) {
    mediumFlags.push('runtime_ms');
  }
  if (inefficiencyRatio > thresholds.MEDIUM_inefficiency_ratio &&
      inefficiencyRatio <= thresholds.HIGH_inefficiency_ratio) {
    mediumFlags.push('inefficiency_ratio');
  }

  // === DETERMINE SEVERITY LEVEL ===
  let severity, label, description;

  if (criticalFlags.length > 0) {
    severity = 'CRITICAL';
    label = 'Critical';
    description = 'Query requires immediate optimization to meet SLA/carbon targets';
  } else if (highFlags.length > 0) {
    severity = 'HIGH';
    label = 'High';
    description = 'Query should be optimized';
  } else if (mediumFlags.length > 0) {
    severity = 'MEDIUM';
    label = 'Medium';
    description = 'Query can be improved';
  } else {
    severity = 'LOW';
    label = 'Low';
    description = 'Query is performing well';
  }

  return {
    severity,
    label,
    description,
    flags: {
      critical: criticalFlags,
      high: highFlags,
      medium: mediumFlags,
    },
    metrics: {
      sustainability_score,
      sci_score,
      runtime_ms,
      node_plan_rows,
      rows_returned,
      inefficiency_ratio: Math.round(inefficiencyRatio * 100) / 100,
    },
    thresholds_applied: {
      critical_sustainability: thresholds.CRITICAL_sustainability,
      critical_sci_max: Math.round(thresholds.baseline_sci * thresholds.CRITICAL_sci_multiplier * 100) / 100,
      critical_runtime_max: Math.round(thresholds.baseline_runtime_ms * thresholds.CRITICAL_runtime_multiplier),
      critical_inefficiency_max: thresholds.CRITICAL_inefficiency_ratio,
    },
  };
}

/**
 * Extract table names from SQL query
 *
 * @param {string} sql - SQL query string
 * @returns {Array<string>} Array of table names
 */
function extractTables(sql) {
  const tables = new Set();
  // Match FROM and JOIN clauses
  const fromRegex = /\bFROM\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;
  const joinRegex = /\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;
  let match;
  while ((match = fromRegex.exec(sql)) !== null) tables.add(match[1].toLowerCase());
  while ((match = joinRegex.exec(sql)) !== null) tables.add(match[1].toLowerCase());
  return Array.from(tables);
}

/**
 * Comprehensive Carbon Analysis Calculation
 * Implements all formulas from Green Algorithms 2021 and ISO/IEC 21031:2024
 *
 * @param {object} params
 * @param {number} params.executionSeconds - Query execution time (seconds)
 * @param {number} params.cpuCores - Number of CPU cores
 * @param {number} params.powerPerCore - Power per CPU core (W)
 * @param {number} params.cpuUtilization - CPU utilization (0-1)
 * @param {number} params.memoryGb - Memory used (GB)
 * @param {number} params.plannerCost - PostgreSQL planner cost
 * @param {number} params.rowsExamined - Rows examined
 * @param {number} params.pue - Power Usage Effectiveness (default 1.3)
 * @param {number} params.gridIntensity - Grid carbon intensity gCO2eq/kWh (default 442)
 * @param {number} params.te - Total embodied carbon (default 1,600,000)
 * @param {number} params.el - Expected hardware lifespan hours (default 35,040)
 * @param {number} params.rr - Resource reserved ratio (default 0.5)
 * @param {number} params.tor - Total operating time (default 1)
 * @param {object} params.weights - Custom weights (optional)
 * @param {object} params.baselines - Custom baselines (optional)
 * @returns {object} Comprehensive carbon analysis
 */
function calculateAll({
  executionSeconds,
  cpuCores,
  powerPerCore,
  cpuUtilization,
  memoryGb,
  plannerCost,
  rowsExamined,
  pue = DEFAULTS.PUE,
  gridIntensity = DEFAULTS.GRID_INTENSITY,
  te = DEFAULTS.TE,
  el = DEFAULTS.EL,
  rr = DEFAULTS.RR,
  tor = DEFAULTS.ToR,
  weights = WEIGHTS,
  baselines = BASELINES,
  sql = null, // Optional: for improvement estimation
  planNode = null, // Optional: for index rule analysis
}) {
  // Step 1: Calculate Energy (kWh)
  const energyKwh = calculateEnergy({
    executionSeconds,
    cpuCores,
    powerPerCore,
    cpuUtilization,
    memoryGb,
    pue,
  });

  // Step 2: Calculate Operational Emissions (gCO2eq)
  const operationalEmissions = calculateOperationalEmissions(energyKwh, gridIntensity);

  // Step 3: Calculate Embodied Emissions (gCO2eq)
  const embodiedEmissions = calculateEmbodiedEmissions({
    executionSeconds,
    te,
    el,
    rr,
    tor,
  });

  // Step 4: Calculate Software Carbon Intensity (SCI)
  const sci = calculateSCI(operationalEmissions, embodiedEmissions);

  // Step 5: Calculate Sustainability Score (0-100)
  const sustainabilityScore = calculateSustainabilityScore({
    sci,
    plannerCost,
    executionMs: executionSeconds * 1000,
    rowsExamined,
    weights,
    baselines,
  });

  // Step 6: Classify into tier
  const classification = classifyScore(sustainabilityScore);

  // Step 7: Calculate severity score based on multiple factors
  const severity = calculateSeverityScore({
    sustainability_score: sustainabilityScore,
    sci_score: sci,
    runtime_ms: executionSeconds * 1000,
    node_plan_rows: rowsExamined,
    rows_returned: rowsExamined, // Use rowsExamined as proxy for rows_returned
  });

  // Step 8: Calculate improvement potential
  const improvements = calculateImprovementEstimate({
    sql,
    plan_rows: rowsExamined,
    rows_returned: rowsExamined,
    current_runtime_ms: executionSeconds * 1000,
    current_sci_gco2: sci,
    grid_carbon_intensity: gridIntensity,
  });

  // Step 9: Analyze PostgreSQL query plan for index-related issues
  let indexAnalysis = {
    violations: [],
    rule_count: 0,
    high_severity: 0,
    medium_severity: 0,
    combined_runtime_reduction_pct: 0,
    combined_carbon_reduction_pct: 0,
  };
  if (planNode) {
    try {
      indexAnalysis = indexRuleEngine.analyzeIndexPatterns(planNode, {
        planner_cost: plannerCost,
        grid_intensity: gridIntensity,
        sql_text: sql,
      });
    } catch (err) {
      console.warn('[IndexRuleEngine] Analysis failed:', err.message);
    }
  }

  return {
    // Execution metrics
    execution_seconds: executionSeconds,
    
    // Energy consumption - keep high precision as values are tiny
    energy_kwh: Math.max(0, Math.round(energyKwh * 1e9) / 1e9), // 9 decimal places for micro/nano queries
    
    // Emissions breakdown - use 6 decimal places for accuracy
    operational_emissions_gco2eq: Math.max(0, Math.round(operationalEmissions * 1e6) / 1e6),
    embodied_emissions_gco2eq: Math.max(0, Math.round(embodiedEmissions * 1e6) / 1e6),
    total_emissions_gco2eq: Math.max(0, Math.round((operationalEmissions + embodiedEmissions) * 1e6) / 1e6),
    
    // Carbon intensity
    sci_gco2eq_per_query: Math.max(0, Math.round(sci * 1e6) / 1e6),
    
    // Sustainability assessment
    sustainability_score: sustainabilityScore,
    classification: classification.tier,
    tier_label: classification.label,
    tier_description: classification.description,
    
    // Query severity assessment (CRITICAL, HIGH, MEDIUM, LOW)
    severity: severity.severity,
    severity_label: severity.label,
    severity_description: severity.description,
    severity_flags: severity.flags,
    severity_metrics: severity.metrics,
    
    // Improvement estimate - identifies optimization opportunities
    improvements: {
      patterns_detected: improvements.patterns_detected,
      combined_runtime_reduction_pct: improvements.combined_runtime_reduction_pct,
      combined_cost_reduction_pct: improvements.combined_cost_reduction_pct,
      combined_carbon_reduction_pct: improvements.combined_carbon_reduction_pct,
      estimated_runtime_improved_ms: improvements.estimated_runtime_improved_ms,
      estimated_sci_improved_gco2: improvements.estimated_sci_improved_gco2,
      improvement_potential_high: improvements.improvement_potential_high,
      recommendations: improvements.recommendations,
    },

    // Index rule violations - PostgreSQL query plan analysis
    index_violations: indexAnalysis.violations,
    index_rule_count: indexAnalysis.rule_count,
    index_high_severity: indexAnalysis.high_severity,
    index_medium_severity: indexAnalysis.medium_severity,
    index_combined_runtime_reduction_pct: indexAnalysis.combined_runtime_reduction_pct,
    index_combined_carbon_reduction_pct: indexAnalysis.combined_carbon_reduction_pct,
    
    // Grid and hardware parameters used
    grid_intensity_used: gridIntensity,
    pue_used: pue,
    
    // Normalized metrics for debugging/transparency
    normalized_metrics: {
      emissions: Math.round(normalizeEmissions(sci, baselines.SCI) * 100) / 100,
      cost: Math.round(normalizeCost(plannerCost, baselines.cost) * 100) / 100,
      duration: Math.round(normalizeDuration(executionSeconds * 1000, baselines.duration) * 100) / 100,
      rows: Math.round(normalizeRows(rowsExamined, baselines.rows) * 100) / 100,
    },
    
    // Configuration snapshot for reproducibility
    configuration: {
      weights: { ...weights },
      baselines: { ...baselines },
    },
  };
}

module.exports = {
  calculateAll,
  calculateEnergy,
  calculateOperationalEmissions,
  calculateEmbodiedEmissions,
  calculateSCI,
  calculateSustainabilityScore,
  calculateSeverityScore,
  calculateImprovementEstimate,
  detectOptimizationPatterns,
  combineImprovements,
  generateRecommendations,
  classifyScore,
  normalizeEmissions,
  normalizeRows,
  normalizeCost,
  normalizeDuration,
  extractTables,
  clamp,
  DEFAULTS,
  WEIGHTS,
  BASELINES,
  CLASSIFICATION_TIERS,
  SEVERITY_THRESHOLDS,
};
