const DEFAULT_IMPACT = Object.freeze({
  costReduction: '10-30%',
  co2Reduction: '10-30%',
});

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

function hasCause(rootCauses, type) {
  return asArray(rootCauses).some((cause) => cause?.type === type);
}

function getSelectStar(astFeatures) {
  return Boolean(astFeatures?.selectStar ?? astFeatures?.hasSelectStar);
}

function getWhereColumns(astFeatures) {
  return unique(asArray(astFeatures?.whereColumns));
}

function getJoinColumns(astFeatures) {
  return unique(asArray(astFeatures?.joinColumns));
}

function getRelationNames(planMetrics) {
  return unique(asArray(planMetrics?.relationNames));
}

function buildSuggestion(type, suggestion, confidence, reason, expectedImpact, evidence = {}) {
  return {
    suggestion,
    confidence,
    reason,
    expectedImpact: expectedImpact || DEFAULT_IMPACT,
    evidence,
    _internal: {
      type,
    },
  };
}

function confidenceLabelToScore(label) {
  if (label === 'HIGH') {
    return 0.9;
  }

  if (label === 'MEDIUM') {
    return 0.65;
  }

  return 0.3;
}

function mapConfidenceScore(score) {
  if (score > 0.8) {
    return 'HIGH';
  }

  if (score >= 0.5) {
    return 'MEDIUM';
  }

  return 'LOW';
}

function calculateConfidence(evidence = {}, ast = {}, plan = {}) {
  let score = 0;

  const hasStrongEvidence = Boolean(evidence.strongEvidence)
    || (Boolean(plan?.hasSeqScan) && getWhereColumns(ast).length > 0)
    || (Boolean(evidence.scanInefficiency) && toNumber(plan?.rowsScanned) > toNumber(plan?.rowsReturned));

  if (hasStrongEvidence) {
    score += 0.5;
  }

  const astSupports = Boolean(evidence.astSupports)
    || (toNumber(ast?.joinCount) > 0)
    || getWhereColumns(ast).length > 0
    || getSelectStar(ast);

  const planSupports = Boolean(evidence.planSupports)
    || asArray(plan?.joinTypes).length > 0
    || Boolean(plan?.hasSeqScan)
    || toNumber(plan?.rowsReturned) > 0;

  if (astSupports && planSupports) {
    score += 0.3;
  }

  const hasContradictions = Boolean(evidence.hasContradictions)
    || (Boolean(evidence.indexFocused) && Boolean(plan?.hasIndexScan));

  if (!hasContradictions) {
    score += 0.2;
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    label: mapConfidenceScore(score),
  };
}

function isSuggestionEligible(type, ast = {}, plan = {}) {
  if (type === 'JOIN_OPTIMIZATION') {
    return toNumber(ast?.joinCount) > 0 && asArray(plan?.joinTypes).length > 0;
  }

  if (type === 'INDEX_SUGGESTION') {
    return Boolean(plan?.hasSeqScan) && getWhereColumns(ast).length > 0;
  }

  if (type === 'COLUMN_PRUNING') {
    return getSelectStar(ast) && toNumber(ast?.nestingDepth) === 0;
  }

  if (type === 'LIMIT_SUGGESTION') {
    return Boolean(ast?.hasLimit === false) && toNumber(plan?.rowsReturned) > 1000;
  }

  return true;
}

function applyContradictions(suggestion, ast = {}, plan = {}) {
  if (!suggestion || typeof suggestion !== 'object') {
    return { blocked: true, reason: 'Invalid suggestion' };
  }

  const type = suggestion?._internal?.type;
  const joinCount = toNumber(ast?.joinCount);
  const rowsReturned = toNumber(plan?.rowsReturned);

  if (type === 'JOIN_OPTIMIZATION' && joinCount === 0) {
    return { blocked: true, reason: 'No JOIN detected' };
  }

  let score = confidenceLabelToScore(suggestion.confidence);

  if (type === 'INDEX_SUGGESTION' && Boolean(plan?.hasIndexScan)) {
    score -= 0.3;
  }

  if (type === 'LIMIT_SUGGESTION' && rowsReturned < 10) {
    score -= 0.3;
  }

  const normalizedScore = Math.max(0, Math.min(1, score));
  const updatedConfidence = mapConfidenceScore(normalizedScore);

  return {
    blocked: false,
    suggestion: {
      ...suggestion,
      confidence: updatedConfidence,
      expectedImpact: estimateImpactByConfidence(updatedConfidence),
    },
  };
}

function buildSkippedSuggestion(suggestionType, reason) {
  return {
    suggestionType,
    status: 'not_applicable',
    reason,
  };
}

function pushSkippedSuggestion(skippedSuggestions, suggestionType, reason) {
  if (!suggestionType) {
    return;
  }

  if (skippedSuggestions.some((item) => item.suggestionType === suggestionType)) {
    return;
  }

  skippedSuggestions.push(buildSkippedSuggestion(suggestionType, reason));
}

function inferSkippedReason(type, rootCauses = [], ast = {}, plan = {}) {
  if (type === 'JOIN_OPTIMIZATION') {
    if (toNumber(ast?.joinCount) <= 0 || asArray(plan?.joinTypes).length === 0) {
      return 'No JOIN detected in query';
    }
    if (!hasCause(rootCauses, 'JOIN_EXPLOSION')) {
      return 'No JOIN explosion detected';
    }
    return 'JOIN optimization not applicable';
  }

  if (type === 'INDEX_SUGGESTION') {
    if (getWhereColumns(ast).length === 0) {
      return 'No filter column found for indexing';
    }
    if (!Boolean(plan?.hasSeqScan)) {
      return 'No sequential scan detected for index recommendation';
    }
    if (!hasCause(rootCauses, 'FULL_TABLE_SCAN') && !hasCause(rootCauses, 'HIGH_SCAN_INEFFICIENCY')) {
      return 'No scan inefficiency detected for index suggestion';
    }
    return 'Index suggestion not applicable';
  }

  if (type === 'COLUMN_PRUNING') {
    if (!getSelectStar(ast)) {
      return 'No SELECT * detected for column pruning';
    }
    if (toNumber(ast?.nestingDepth) !== 0) {
      return 'SELECT * appears only in nested query';
    }
    return 'Column pruning not applicable';
  }

  if (type === 'LIMIT_SUGGESTION') {
    if (Boolean(ast?.hasLimit !== false)) {
      return 'Query already has LIMIT clause';
    }
    if (toNumber(plan?.rowsReturned) <= 1000) {
      return 'Returned rows are not high enough for LIMIT suggestion';
    }
    return 'LIMIT suggestion not applicable';
  }

  return 'Suggestion not applicable';
}

function estimateImpactByConfidence(confidence) {
  if (confidence === 'HIGH') {
    return {
      costReduction: '30-70%',
      co2Reduction: '30-70%',
    };
  }

  if (confidence === 'MEDIUM') {
    return {
      costReduction: '15-40%',
      co2Reduction: '15-40%',
    };
  }

  return {
    costReduction: '5-15%',
    co2Reduction: '5-15%',
  };
}

function suggestFromFullTableScan(rootCauses, astFeatures, planMetrics) {
  if (!isSuggestionEligible('INDEX_SUGGESTION', astFeatures, planMetrics)) {
    return null;
  }

  if (!hasCause(rootCauses, 'FULL_TABLE_SCAN')) {
    return null;
  }

  const whereColumns = getWhereColumns(astFeatures);
  if (whereColumns.length === 0) {
    return null;
  }

  const relationNames = getRelationNames(planMetrics);
  const confidence = calculateConfidence({
    strongEvidence: true,
    astSupports: getWhereColumns(astFeatures).length > 0,
    planSupports: Boolean(planMetrics?.hasSeqScan),
    indexFocused: true,
  }, astFeatures, planMetrics).label;
  const suggestedColumn = whereColumns[0];
  const relationLabel = relationNames[0] ? ` on table '${relationNames[0]}'` : '';

  return buildSuggestion(
    'INDEX_SUGGESTION',
    `Add index on column '${suggestedColumn}'${relationLabel}`,
    confidence,
    `A sequential scan was detected and the query filters on column '${suggestedColumn}'. An index can reduce the amount of data read before filtering.`,
    estimateImpactByConfidence(confidence),
    {
      hasSeqScan: Boolean(planMetrics?.hasSeqScan),
      whereColumns,
      relationNames,
    }
  );
}

function suggestFromSelectStar(rootCauses, astFeatures) {
  if (!isSuggestionEligible('COLUMN_PRUNING', astFeatures, {})) {
    return null;
  }

  if (!hasCause(rootCauses, 'OVER_FETCHING') && !getSelectStar(astFeatures)) {
    return null;
  }

  const confidence = calculateConfidence({
    strongEvidence: getSelectStar(astFeatures),
    astSupports: true,
    planSupports: true,
  }, astFeatures, {}).label;

  return buildSuggestion(
    'COLUMN_PRUNING',
    'Prune unused columns from the SELECT list',
    confidence,
    'The query uses SELECT * or an equivalent top-level star projection, which reads and returns more columns than necessary.',
    estimateImpactByConfidence(confidence),
    {
      selectStar: getSelectStar(astFeatures),
      selectExpressions: asArray(astFeatures?.selectExpressions),
    }
  );
}

function suggestFromHighScanInefficiency(rootCauses, astFeatures, planMetrics) {
  if (!isSuggestionEligible('INDEX_SUGGESTION', astFeatures, planMetrics)) {
    return null;
  }

  if (!hasCause(rootCauses, 'HIGH_SCAN_INEFFICIENCY')) {
    return null;
  }

  const whereColumns = getWhereColumns(astFeatures);
  const joinColumns = getJoinColumns(astFeatures);
  const confidence = calculateConfidence({
    strongEvidence: true,
    astSupports: whereColumns.length > 0 || joinColumns.length > 0,
    planSupports: toNumber(planMetrics?.rowsScanned) > toNumber(planMetrics?.rowsReturned),
    indexFocused: true,
  }, astFeatures, planMetrics).label;

  if (whereColumns.length > 0) {
    return buildSuggestion(
      'INDEX_SUGGESTION',
      `Add filters or indexes on column '${whereColumns[0]}'`,
      confidence,
      `The plan scans far more rows than it returns, and column '${whereColumns[0]}' is already used in the WHERE clause. Tightening the filter or indexing this column can reduce scanned rows.`,
      estimateImpactByConfidence(confidence),
      {
        whereColumns,
        rowsScanned: toNumber(planMetrics?.rowsScanned),
        rowsReturned: toNumber(planMetrics?.rowsReturned),
      }
    );
  }

  if (joinColumns.length > 0) {
    return buildSuggestion(
      'INDEX_SUGGESTION',
      `Add filters or indexes on join column '${joinColumns[0]}'`,
      confidence,
      `The plan scans far more rows than it returns, and join column '${joinColumns[0]}' is present in the query structure. Indexing or narrowing this path can reduce scan volume.`,
      estimateImpactByConfidence(confidence),
      {
        joinColumns,
        rowsScanned: toNumber(planMetrics?.rowsScanned),
        rowsReturned: toNumber(planMetrics?.rowsReturned),
      }
    );
  }

  return buildSuggestion(
    'INDEX_SUGGESTION',
    'Add filters or indexes to reduce scanned rows',
    confidence,
    'The plan scans far more rows than it returns, but no specific filter or join column was extracted for a more targeted recommendation.',
    estimateImpactByConfidence(confidence),
    {
      rowsScanned: toNumber(planMetrics?.rowsScanned),
      rowsReturned: toNumber(planMetrics?.rowsReturned),
    }
  );
}

function suggestFromJoinExplosion(rootCauses, astFeatures, planMetrics) {
  const hasAstJoin = toNumber(astFeatures?.joinCount) > 0;
  const hasPlanJoin = asArray(planMetrics?.joinTypes).length > 0;

  if (!hasAstJoin || !hasPlanJoin) {
    // Internal-only skip metadata for diagnostics.
    return {
      _internal: {
        type: 'JOIN_OPTIMIZATION',
        skippedReason: 'No JOIN detected',
      },
    };
  }

  if (!isSuggestionEligible('JOIN_OPTIMIZATION', astFeatures, planMetrics)) {
    return null;
  }

  if (!hasCause(rootCauses, 'JOIN_EXPLOSION')) {
    return null;
  }

  const joinColumns = getJoinColumns(astFeatures);
  const joinTypes = unique(asArray(planMetrics?.joinTypes).concat(asArray(astFeatures?.joinTypes)));
  const confidence = calculateConfidence({
    strongEvidence: true,
    astSupports: toNumber(astFeatures?.joinCount) > 0,
    planSupports: asArray(planMetrics?.joinTypes).length > 0,
  }, astFeatures, planMetrics).label;

  const targetColumn = joinColumns[0] || 'join keys';
  const joinTypeLabel = joinTypes.length > 0 ? ` (${joinTypes.join(', ')})` : '';

  return buildSuggestion(
    'JOIN_OPTIMIZATION',
    `Optimize join conditions around '${targetColumn}'`,
    confidence,
    `The join path expands rows rapidly${joinTypeLabel}. The join keys are contributing to the row growth, so join condition selectivity should be improved.`,
    estimateImpactByConfidence(confidence),
    {
      joinCount: toNumber(astFeatures?.joinCount),
      joinTypes,
      joinColumns,
      rowsScanned: toNumber(planMetrics?.rowsScanned),
      rowsReturned: toNumber(planMetrics?.rowsReturned),
    }
  );
}

function buildSuggestions(rootCauses = [], astFeatures = {}, planMetrics = {}) {
  const suggestions = [];
  const skippedSuggestions = [];
  const addedTypes = new Set();
  const SKIPPABLE_TYPES = ['JOIN_OPTIMIZATION', 'INDEX_SUGGESTION', 'COLUMN_PRUNING', 'LIMIT_SUGGESTION'];

  const candidates = [
    suggestFromFullTableScan(rootCauses, astFeatures, planMetrics),
    suggestFromSelectStar(rootCauses, astFeatures),
    suggestFromHighScanInefficiency(rootCauses, astFeatures, planMetrics),
    suggestFromJoinExplosion(rootCauses, astFeatures, planMetrics),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate?._internal?.skippedReason) {
      pushSkippedSuggestion(skippedSuggestions, candidate?._internal?.type || 'UNKNOWN', candidate._internal.skippedReason);
      continue;
    }

    const contradictionResult = applyContradictions(candidate, astFeatures, planMetrics);
    if (contradictionResult.blocked) {
      pushSkippedSuggestion(skippedSuggestions, candidate?._internal?.type || 'UNKNOWN', contradictionResult.reason || 'Suggestion blocked by contradiction check');
      continue;
    }

    const finalCandidate = contradictionResult.suggestion;
    addedTypes.add(finalCandidate?._internal?.type || 'UNKNOWN');
    const uiCandidate = {
      suggestion: finalCandidate.suggestion,
      confidence: finalCandidate.confidence,
      reason: finalCandidate.reason,
      expectedImpact: finalCandidate.expectedImpact,
      evidence: finalCandidate.evidence || {},
    };

    if (!suggestions.some((item) => normalizeText(item.suggestion) === normalizeText(uiCandidate.suggestion))) {
      suggestions.push(uiCandidate);
    }
  }

  for (const type of SKIPPABLE_TYPES) {
    if (!addedTypes.has(type) && !skippedSuggestions.some((item) => item.suggestionType === type)) {
      pushSkippedSuggestion(skippedSuggestions, type, inferSkippedReason(type, rootCauses, astFeatures, planMetrics));
    }
  }

  return {
    suggestions,
    skippedSuggestions,
  };
}

module.exports = {
  buildSuggestions,
  isSuggestionEligible,
  calculateConfidence,
  applyContradictions,
};