const HIGH_SCAN_RATIO_THRESHOLD = 50;
const JOIN_EXPLOSION_RATIO_THRESHOLD = 10;
const CPU_COST_PER_ROW_THRESHOLD = 1.5;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeRatio(numerator, denominator) {
  const left = toNumber(numerator);
  const right = toNumber(denominator);

  if (right <= 0) {
    return left > 0 ? Infinity : 0;
  }

  return left / right;
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function hasSelectStar(astFeatures) {
  return Boolean(astFeatures?.selectStar ?? astFeatures?.hasSelectStar);
}

function resolveJoinCount(astFeatures = {}, planMetrics = {}) {
  const planJoinCount = Array.isArray(planMetrics?.joinTypes) ? planMetrics.joinTypes.length : 0;
  if (planJoinCount > 0) {
    return planJoinCount;
  }

  return toNumber(astFeatures?.joinCount);
}

function hasJoinActivity(planMetrics, astFeatures) {
  return Boolean(
    (toNumber(planMetrics?.joinTypes?.length) > 0)
    || toNumber(astFeatures?.joinCount) > 0
    || unique(planMetrics?.nodeTypes).some((type) => /join/i.test(String(type)))
  );
}

function buildRootCause(type, severity, evidence, explanation) {
  return {
    type,
    severity,
    evidence,
    explanation,
  };
}

function getHighScanSeverity(ratio) {
  const normalizedRatio = toNumber(ratio);

  if (normalizedRatio > 1000) {
    return 'CRITICAL';
  }

  if (normalizedRatio > 100) {
    return 'HIGH';
  }

  if (normalizedRatio > 10) {
    return 'MEDIUM';
  }

  return 'LOW';
}

function analyzeRootCauses(astFeatures = {}, planMetrics = {}) {
  const findings = [];
  const rowsScanned = toNumber(planMetrics.rowsScanned);
  const rowsReturned = toNumber(planMetrics.rowsReturned);
  const totalCost = toNumber(planMetrics.totalCost);
  const joinCount = resolveJoinCount(astFeatures, planMetrics);
  const scanRatio = safeRatio(rowsScanned, rowsReturned);
  const costPerRow = safeRatio(totalCost, Math.max(rowsReturned, 1));

  if (rowsReturned > 0 && Boolean(planMetrics.hasSeqScan) && Number.isFinite(scanRatio) && scanRatio > HIGH_SCAN_RATIO_THRESHOLD) {
    findings.push(buildRootCause(
      'HIGH_SCAN_INEFFICIENCY',
      getHighScanSeverity(scanRatio),
      {
        rowsScanned,
        rowsReturned,
        ratio: scanRatio,
        threshold: HIGH_SCAN_RATIO_THRESHOLD,
      },
      'The plan scans substantially more rows than it returns.'
    ));
  }

  if (Boolean(planMetrics.hasSeqScan)) {
    findings.push(buildRootCause(
      'FULL_TABLE_SCAN',
      'high',
      {
        hasSeqScan: true,
        nodeTypes: unique(planMetrics.nodeTypes),
        relationNames: unique(planMetrics.relationNames),
      },
      'The plan contains a sequential scan node.'
    ));
  }

  if (hasJoinActivity(planMetrics, astFeatures)) {
    const joinRatio = safeRatio(rowsScanned, Math.max(rowsReturned, 1));
    const joinNodeTypes = unique(planMetrics.joinTypes?.length ? planMetrics.joinTypes : astFeatures.joinTypes);

    if (joinCount > 0 && joinRatio > JOIN_EXPLOSION_RATIO_THRESHOLD) {
      findings.push(buildRootCause(
        'JOIN_EXPLOSION',
        'high',
        {
          joinCount,
          rowsScanned,
          rowsReturned,
          ratio: joinRatio,
          joinTypes: joinNodeTypes,
          threshold: JOIN_EXPLOSION_RATIO_THRESHOLD,
        },
        'Join processing expands row volume much faster than the final output.'
      ));
    }
  }

  if (totalCost >= 50 && costPerRow >= CPU_COST_PER_ROW_THRESHOLD) {
    findings.push(buildRootCause(
      'CPU_HEAVY_QUERY',
      'medium',
      {
        totalCost,
        rowsReturned,
        costPerRow,
        threshold: CPU_COST_PER_ROW_THRESHOLD,
      },
      'The plan has high estimated cost while returning relatively few rows.'
    ));
  }

  if (hasSelectStar(astFeatures)) {
    findings.push(buildRootCause(
      'OVER_FETCHING',
      'medium',
      {
        selectStar: true,
        selectExpressions: unique(astFeatures.selectExpressions),
      },
      'The query selects all columns instead of a narrow projection.'
    ));
  }

  return findings;
}

module.exports = {
  analyzeRootCauses,
  HIGH_SCAN_RATIO_THRESHOLD,
  JOIN_EXPLOSION_RATIO_THRESHOLD,
  CPU_COST_PER_ROW_THRESHOLD,
};