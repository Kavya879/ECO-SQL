/**
 * Sustainability scoring (0-100, higher = greener)
 * S = 100 - clamp((w1×N_emissions + w2×N_cost + w3×N_duration + w4×N_rows) × 100, 0, 100)
 * Log normalization for emissions and rows; linear for cost and duration
 */

export const SCORE_WEIGHTS = {
  w1: 0.40,
  w2: 0.25,
  w3: 0.20,
  w4: 0.15,
};

export const SCORE_BASELINES = {
  SCI_baseline: 1.0,
  cost_baseline: 10_000,
  duration_baseline: 1_000,
  rows_baseline: 100_000,
};

export const TIER_THRESHOLDS = {
  excellent: 90,
  good: 70,
  moderate: 50,
  poor: 25,
};

export function computeSustainabilityScore(
  { sci, planner_cost, execution_ms, rows_examined },
  weights = SCORE_WEIGHTS,
  baselines = SCORE_BASELINES
) {
  const N_emissions = Math.log(sci + 1) / Math.log(baselines.SCI_baseline + 1);
  const N_cost = (planner_cost ?? 0) / baselines.cost_baseline;
  const N_duration = (execution_ms ?? 0) / baselines.duration_baseline;
  const N_rows = Math.log((rows_examined ?? 0) + 1) / Math.log(baselines.rows_baseline + 1);

  const raw = (weights.w1 * N_emissions + weights.w2 * N_cost + weights.w3 * N_duration + weights.w4 * N_rows) * 100;
  const score = Math.max(0, Math.min(100, 100 - raw));

  return {
    score: Math.round(score * 100) / 100,
    breakdown: { emissions: N_emissions, cost: N_cost, duration: N_duration, rows: N_rows },
  };
}

export function tierFromScore(score, thresholds = TIER_THRESHOLDS) {
  if (score >= thresholds.excellent) return 'excellent';
  if (score >= thresholds.good) return 'good';
  if (score >= thresholds.moderate) return 'moderate';
  if (score >= thresholds.poor) return 'poor';
  return 'critical';
}
