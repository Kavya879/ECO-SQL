/**
 * Carbon Calculator Service
 * Implements Green Algorithms formulas (Lannelongue et al., 2021)
 */

/**
 * Green Algorithms Energy Equation
 * E = t × (n_c × P_c × u_c + n_mem × 0.3725) × PUE × 0.001
 *
 * @param {object} params
 * @param {number} params.runtimeHours - Query runtime in hours
 * @param {number} params.cpuCores - Number of CPU cores
 * @param {number} params.powerPerCore - Power per core in Watts
 * @param {number} params.cpuUtilization - CPU utilization 0–1
 * @param {number} params.ramGb - RAM in GB
 * @param {number} params.pue - Power Usage Effectiveness
 * @returns {number} Energy in kWh
 */
function calculateEnergy({ runtimeHours, cpuCores, powerPerCore, cpuUtilization, ramGb, pue }) {
  const cpuPower = cpuCores * powerPerCore * cpuUtilization;
  const memPower = ramGb * 0.3725;
  const energy = runtimeHours * (cpuPower + memPower) * pue * 0.001;
  return energy;
}

/**
 * Operational Emissions
 * O = E × I
 *
 * @param {number} energyKwh
 * @param {number} gridIntensity - gCO2eq/kWh
 * @returns {number} gCO2eq
 */
function calculateOperationalEmissions(energyKwh, gridIntensity) {
  return energyKwh * gridIntensity;
}

/**
 * Embodied Emissions (SCI Specification)
 * M = TE × (TiR / EL) × (RR / ToR)
 *
 * @param {object} params
 * @param {number} params.te - Total embodied carbon (gCO2eq)
 * @param {number} params.tir - Time in reporting period (hours) = runtimeHours
 * @param {number} params.el - Hardware lifespan (hours)
 * @param {number} params.rr - Reserved resource ratio (0–1)
 * @param {number} params.tor - Total operating time (hours)
 * @returns {number} gCO2eq
 */
function calculateEmbodiedEmissions({ te, tir, el, rr, tor }) {
  return te * (tir / el) * (rr / tor);
}

/**
 * Software Carbon Intensity
 * SCI = (O + M) / R
 * For Phase 1: R = 1 (one SQL query)
 *
 * @param {number} operational - gCO2eq
 * @param {number} embodied - gCO2eq
 * @returns {number} gCO2eq / query
 */
function calculateSCI(operational, embodied) {
  const R = 1;
  return (operational + embodied) / R;
}

/**
 * Classify emissions level
 * Sustainable: 0–2.0, Moderate: 2.0–5.0, High Impact: 5.0+
 */
function classifyEmissions(totalGco2) {
  if (totalGco2 < 2.0) return 'SUSTAINABLE';
  if (totalGco2 < 5.0) return 'MODERATE';
  return 'HIGH IMPACT';
}

/**
 * Sustainability score (0–100, higher = greener)
 */
function calculateSustainabilityScore(totalGco2) {
  if (totalGco2 <= 0) return 100;
  const score = Math.max(0, Math.round(100 - (totalGco2 / 10) * 100));
  return Math.min(100, score);
}

/**
 * Extract table names from SQL query
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
 * Main calculation entry point
 */
function calculateAll({
  runtimeSeconds,
  cpuCores,
  powerPerCore,
  cpuUtilization,
  ramGb,
  pue,
  gridIntensity,
  te,
  el,
  rr,
  tor,
}) {
  const runtimeHours = runtimeSeconds / 3600;

  const energyKwh = calculateEnergy({
    runtimeHours,
    cpuCores,
    powerPerCore,
    cpuUtilization,
    ramGb,
    pue,
  });

  const operationalEmissions = calculateOperationalEmissions(energyKwh, gridIntensity);

  const embodiedEmissions = calculateEmbodiedEmissions({
    te,
    tir: runtimeHours,
    el,
    rr,
    tor,
  });

  const totalEmissions = operationalEmissions + embodiedEmissions;
  const sci = calculateSCI(operationalEmissions, embodiedEmissions);
  const classification = classifyEmissions(totalEmissions);
  const sustainabilityScore = calculateSustainabilityScore(totalEmissions);

  return {
    runtime_s: runtimeSeconds,
    runtime_hours: runtimeHours,
    energy_kwh: energyKwh,
    operational_emissions_gco2: operationalEmissions,
    embodied_emissions_gco2: embodiedEmissions,
    total_emissions_gco2: totalEmissions,
    sci,
    classification,
    sustainability_score: sustainabilityScore,
  };
}

module.exports = { calculateAll, extractTables, classifyEmissions };
