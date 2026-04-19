/**
 * Carbon Calculator Service
 * References: Green Algorithms 2021 (Lannelongue et al.), ISO/IEC 21031:2024
 */

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
};
