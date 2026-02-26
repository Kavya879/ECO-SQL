/**
 * Default hardware and emission parameters for Phase 1
 */

export const HARDWARE_DEFAULTS = {
  cpu_cores: 16,
  P_c: 5,           // W per core (typical)
  cpu_utilization: 0.65,
  ram_gb: 64,
  pue: 1.3,
  grid_carbon_intensity: 442,  // India 2024 gCO2eq/kWh
};

export const EMBODIED_DEFAULTS = {
  TE: 1_600_000,
  EL: 35_040,
  RR: 0.5,
};

// Calibration: planner cost units → ms (heuristic; calibrate from benchmarks)
export const COST_TO_MS_CALIBRATION = 0.01;

export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
