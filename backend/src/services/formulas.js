/**
 * Carbon emission formulas (Green Algorithms 2021, ISO/IEC 21031:2024)
 * @see plan.md and README.md for full documentation
 */

// Embodied emissions defaults
export const EMBODIED_DEFAULTS = {
  TE: 1_600_000,      // Total Embodied Carbon (gCO2eq) - mid-range server
  EL: 35_040,         // Expected lifespan (hours) - 4 years
  RR: 0.5,            // Resource Reserved ratio (shared server)
};

// Memory power per GB (W) - Green Algorithms
const P_MEM_PER_GB = 0.3725;

/**
 * Energy (kWh): E = t × (n_c × P_c × u_c + n_mem × 0.3725) × PUE × 0.001
 */
export function energyKwh({ t, n_c, P_c, u_c, n_mem, PUE = 1.3 }) {
  const powerWatts = n_c * P_c * u_c + n_mem * P_MEM_PER_GB;
  return t * powerWatts * PUE * 0.001;
}

/**
 * Operational Emissions: O = E × I (gCO2eq)
 */
export function operationalEmissions(energyKwh, I) {
  return energyKwh * I;
}

/**
 * Embodied Emissions: M = TE × (TiR / EL) × (RR / ToR)
 * TiR = query time in hours; ToR typically 1
 */
export function embodiedEmissions({ TE, TiR, EL, RR, ToR = 1 }) {
  return TE * (TiR / EL) * (RR / ToR);
}

/**
 * Software Carbon Intensity: SCI = (O + M) / R, R = 1
 */
export function sci(operationalCo2, embodiedCo2, R = 1) {
  return (operationalCo2 + embodiedCo2) / R;
}
