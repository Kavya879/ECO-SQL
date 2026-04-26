const { parseQuery, extractQueryStructure } = require('./sqlParser');
const { parseExplainPlan, extractExplainPlanStructure } = require('./explainParser');
const { analyzeRootCauses } = require('./rootCauseAnalyzer');
const { buildSuggestions } = require('./suggestionEngine');
const { estimateOptimizationImpact } = require('./impactEstimator');
const { calculateAll, DEFAULTS } = require('./carbonCalculator');

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function summarizePlanMetrics(planMetrics = {}) {
  const totalCost = toNumber(planMetrics.totalCost);
  const rowsScanned = toNumber(planMetrics.rowsScanned);
  const rowsReturned = toNumber(planMetrics.rowsReturned);
  const maxNodeCost = toNumber(planMetrics.maxNodeCost);

  return {
    totalCost,
    rowsScanned,
    rowsReturned,
    maxNodeCost,
  };
}

function estimateExecutionSeconds(planMetrics = {}) {
  const totalCost = toNumber(planMetrics.totalCost);
  const rowsScanned = toNumber(planMetrics.rowsScanned);
  const rowsReturned = toNumber(planMetrics.rowsReturned);
  const maxNodeCost = toNumber(planMetrics.maxNodeCost);

  const estimatedSeconds = 0.05 + (totalCost / 4000) + (rowsScanned / 250000) + (rowsReturned / 1000000) + (maxNodeCost / 10000);
  return clamp(estimatedSeconds, 0.05, 30);
}

function estimateCurrentCarbon(planMetrics = {}) {
  const executionSeconds = estimateExecutionSeconds(planMetrics);
  const summary = summarizePlanMetrics(planMetrics);
  const rowsExamined = summary.rowsScanned > 0 ? summary.rowsScanned : summary.rowsReturned;

  const carbon = calculateAll({
    executionSeconds,
    cpuCores: 1,
    powerPerCore: 15,
    cpuUtilization: 0.5,
    memoryGb: 1,
    plannerCost: summary.totalCost || 1,
    rowsExamined,
    pue: DEFAULTS.PUE,
    gridIntensity: DEFAULTS.GRID_INTENSITY,
    te: DEFAULTS.TE,
    el: DEFAULTS.EL,
    rr: DEFAULTS.RR,
    tor: DEFAULTS.ToR,
  });

  return {
    executionSeconds,
    rowsExamined,
    totalEmissions: carbon.total_emissions_gco2eq,
    energyKwh: carbon.energy_kwh,
    sustainabilityScore: carbon.sustainability_score,
  };
}

function severityRank(severity) {
  const value = String(severity || '').toUpperCase();
  if (value === 'CRITICAL') return 4;
  if (value === 'HIGH') return 3;
  if (value === 'MEDIUM') return 2;
  if (value === 'LOW') return 1;
  return 0;
}

function getDominantFactor(rootCauses = []) {
  if (!Array.isArray(rootCauses) || rootCauses.length === 0) {
    return 'NONE';
  }

  const sorted = [...rootCauses].sort((a, b) => severityRank(b?.severity) - severityRank(a?.severity));
  return sorted[0]?.type || 'NONE';
}

function splitSuggestionsByPriority(suggestions = []) {
  const primarySuggestions = [];
  const secondarySuggestions = [];
  const seen = new Set();

  for (const suggestion of suggestions) {
    const key = String(suggestion?.suggestion || '').trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    const confidence = String(suggestion?.confidence || '').toUpperCase();
    if (confidence === 'HIGH' || confidence === 'MEDIUM') {
      primarySuggestions.push(suggestion);
    } else {
      secondarySuggestions.push(suggestion);
    }
  }

  return {
    primarySuggestions,
    secondarySuggestions,
  };
}

async function analyzeQuery(query, explainPlan) {
  const ast = await parseQuery(query);
  const astFeatures = ast ? await extractQueryStructure(ast) : {
    tables: [],
    columns: [],
    selectExpressions: [],
    whereConditions: [],
    groupBy: [],
    orderBy: [],
    joins: [],
    limit: null,
    selectStar: false,
    joinCount: 0,
    joinTypes: [],
    whereColumns: [],
    joinColumns: [],
    hasAggregation: false,
    hasFunctionInWhere: false,
    nestingDepth: 0,
    hasSelectStar: false,
    hasWhere: false,
    hasGroupBy: false,
    hasOrderBy: false,
    hasLimit: false,
    hasSubquery: false,
  };

  const plan = parseExplainPlan(explainPlan);
  const planMetrics = extractExplainPlanStructure(plan);
  const rootCauses = analyzeRootCauses(astFeatures, planMetrics);
  const suggestionResult = buildSuggestions(rootCauses, astFeatures, planMetrics);
  const carbonSnapshot = estimateCurrentCarbon(planMetrics);
  const suggestionGroups = splitSuggestionsByPriority(suggestionResult.suggestions);

  // Keep impact estimation computed for extensibility, while returning the new output contract.
  estimateOptimizationImpact(
    {
      cost: planMetrics.totalCost,
      rows: carbonSnapshot.rowsExamined,
      co2: carbonSnapshot.totalEmissions,
    },
    rootCauses
  );

  return {
    summary: {
      co2: carbonSnapshot.totalEmissions,
      score: carbonSnapshot.sustainabilityScore,
      dominantFactor: getDominantFactor(rootCauses),
    },
    rootCauses,
    primarySuggestions: suggestionGroups.primarySuggestions,
    secondarySuggestions: suggestionGroups.secondarySuggestions,
    skippedSuggestions: suggestionResult.skippedSuggestions,
  };
}

module.exports = {
  analyzeQuery,
  estimateCurrentCarbon,
  estimateExecutionSeconds,
};