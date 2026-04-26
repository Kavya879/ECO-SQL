const CURRENT_METRIC_KEYS = {
  cost: ['cost', 'plannerCost', 'totalCost'],
  rows: ['rows', 'rowsScanned', 'rowsReturned', 'rowCount'],
  co2: ['co2', 'co2g', 'totalCo2', 'totalEmissions', 'currentCo2'],
};

const ROOT_CAUSE_TYPES = {
  FULL_TABLE_SCAN: 'FULL_TABLE_SCAN',
  OVER_FETCHING: 'OVER_FETCHING',
  HIGH_SCAN_INEFFICIENCY: 'HIGH_SCAN_INEFFICIENCY',
  JOIN_EXPLOSION: 'JOIN_EXPLOSION',
  CPU_HEAVY_QUERY: 'CPU_HEAVY_QUERY',
};

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getMetric(metrics, keys) {
  for (const key of keys) {
    if (metrics && Object.prototype.hasOwnProperty.call(metrics, key)) {
      const value = toNumber(metrics[key]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }

  return 0;
}

function getCurrentMetrics(currentMetrics = {}) {
  return {
    cost: getMetric(currentMetrics, CURRENT_METRIC_KEYS.cost),
    rows: getMetric(currentMetrics, CURRENT_METRIC_KEYS.rows),
    co2: getMetric(currentMetrics, CURRENT_METRIC_KEYS.co2),
  };
}

function hasRootCause(rootCauses, type) {
  return asArray(rootCauses).some((rootCause) => rootCause?.type === type);
}

function getCauseEvidence(rootCauses, type) {
  return asArray(rootCauses).find((rootCause) => rootCause?.type === type)?.evidence || {};
}

function estimateSelectStarImpact() {
  return {
    costReductionPercent: 15,
    energyReductionPercent: 15,
    co2ReductionPercent: 15,
  };
}

function estimateFromHighScan(rootCauses, currentMetrics) {
  const evidence = getCauseEvidence(rootCauses, ROOT_CAUSE_TYPES.HIGH_SCAN_INEFFICIENCY);
  const ratio = toNumber(evidence.ratio);
  const rowsScanned = toNumber(evidence.rowsScanned || currentMetrics.rows);

  if (ratio <= 0) {
    return null;
  }

  const ratioDriven = clamp(100 - (100 / Math.max(ratio, 1)), 20, 85);
  const rowDriven = rowsScanned > 0 ? clamp(20 + Math.log10(rowsScanned + 1) * 12, 20, 80) : 20;
  const base = Math.max(ratioDriven, rowDriven);

  return {
    costReductionPercent: base,
    energyReductionPercent: base,
    co2ReductionPercent: base,
  };
}

function estimateFromFullScan(rootCauses) {
  if (!hasRootCause(rootCauses, ROOT_CAUSE_TYPES.FULL_TABLE_SCAN)) {
    return null;
  }

  const scanCause = asArray(rootCauses).find((rootCause) => rootCause?.type === ROOT_CAUSE_TYPES.FULL_TABLE_SCAN) || {};
  const hasFilterColumns = asArray(scanCause.evidence?.filterColumns).length > 0 || asArray(scanCause.evidence?.whereColumns).length > 0;

  const reduction = hasFilterColumns ? 72 : 64;

  return {
    costReductionPercent: reduction,
    energyReductionPercent: reduction,
    co2ReductionPercent: reduction,
  };
}

function estimateFromJoinExplosion(rootCauses) {
  if (!hasRootCause(rootCauses, ROOT_CAUSE_TYPES.JOIN_EXPLOSION)) {
    return null;
  }

  const joinCause = asArray(rootCauses).find((rootCause) => rootCause?.type === ROOT_CAUSE_TYPES.JOIN_EXPLOSION) || {};
  const ratio = toNumber(joinCause.evidence?.ratio);
  const base = ratio > 0 ? clamp(35 + Math.log10(ratio + 1) * 12, 35, 75) : 45;

  return {
    costReductionPercent: base,
    energyReductionPercent: base,
    co2ReductionPercent: base,
  };
}

function estimateFromCpuHeavyQuery(rootCauses) {
  if (!hasRootCause(rootCauses, ROOT_CAUSE_TYPES.CPU_HEAVY_QUERY)) {
    return null;
  }

  const cpuCause = asArray(rootCauses).find((rootCause) => rootCause?.type === ROOT_CAUSE_TYPES.CPU_HEAVY_QUERY) || {};
  const costPerRow = toNumber(cpuCause.evidence?.costPerRow);
  const base = costPerRow > 0 ? clamp(18 + costPerRow * 8, 20, 55) : 20;

  return {
    costReductionPercent: base,
    energyReductionPercent: base,
    co2ReductionPercent: base,
  };
}

function estimateFromSelectStar(rootCauses) {
  if (!hasRootCause(rootCauses, ROOT_CAUSE_TYPES.OVER_FETCHING)) {
    return null;
  }

  return estimateSelectStarImpact();
}

function combineEstimates(estimates) {
  const activeEstimates = estimates.filter(Boolean);
  if (activeEstimates.length === 0) {
    return {
      costReductionPercent: 0,
      energyReductionPercent: 0,
      co2ReductionPercent: 0,
    };
  }

  const aggregate = activeEstimates.reduce((accumulator, estimate) => {
    accumulator.cost = 1 - ((1 - accumulator.cost) * (1 - clamp(estimate.costReductionPercent, 0, 95) / 100));
    accumulator.energy = 1 - ((1 - accumulator.energy) * (1 - clamp(estimate.energyReductionPercent, 0, 95) / 100));
    accumulator.co2 = 1 - ((1 - accumulator.co2) * (1 - clamp(estimate.co2ReductionPercent, 0, 95) / 100));
    return accumulator;
  }, {
    cost: 0,
    energy: 0,
    co2: 0,
  });

  return {
    costReductionPercent: Math.round(clamp(aggregate.cost * 100, 0, 95)),
    energyReductionPercent: Math.round(clamp(aggregate.energy * 100, 0, 95)),
    co2ReductionPercent: Math.round(clamp(aggregate.co2 * 100, 0, 95)),
  };
}

function adjustCo2ForCarbonModel(currentMetrics, estimate) {
  const { co2 } = currentMetrics;

  if (co2 <= 0) {
    return estimate;
  }

  const carbonFloorFactor = co2 < 0.01 ? 0.85 : co2 < 0.1 ? 0.9 : 0.95;

  return {
    ...estimate,
    co2ReductionPercent: Math.round(clamp(estimate.co2ReductionPercent * carbonFloorFactor, 0, 95)),
  };
}

function estimateOptimizationImpact(currentMetrics = {}, rootCauses = []) {
  const normalizedMetrics = getCurrentMetrics(currentMetrics);

  const estimates = [
    estimateFromFullScan(rootCauses),
    estimateFromHighScan(rootCauses, normalizedMetrics),
    estimateFromJoinExplosion(rootCauses),
    estimateFromCpuHeavyQuery(rootCauses),
    estimateFromSelectStar(rootCauses),
  ];

  const combined = combineEstimates(estimates);
  const adjusted = adjustCo2ForCarbonModel(normalizedMetrics, combined);

  return {
    estimatedImprovement: {
      costReductionPercent: adjusted.costReductionPercent,
      energyReductionPercent: adjusted.energyReductionPercent,
      co2ReductionPercent: adjusted.co2ReductionPercent,
    },
  };
}

module.exports = {
  estimateOptimizationImpact,
};