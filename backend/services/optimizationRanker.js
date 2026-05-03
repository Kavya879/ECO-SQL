/**
 * Merges and ranks findings from all optimization tracks.
 */

const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 };

function simulationRank(f) {
  const sim = f.simulation;
  const hintSim = f.hint_simulation;
  if (sim === 'simulated' || hintSim === 'confirmed') return 2;
  if (sim === 'no_improvement' || hintSim === 'no_improvement') return 1;
  if (sim === 'heuristic' || hintSim === 'heuristic') return 0;
  return 0;
}

function effectiveSciDelta(f) {
  const a = f.sci_delta;
  const b = f.hint_sci_delta;
  if (a != null && b != null) return Math.min(a, b);
  if (a != null) return a;
  if (b != null) return b;
  return null;
}

/**
 * If Track 1 and Track 3 flag the same table+column, keep Track 1 (has EXPLAIN evidence).
 */
function dedupeExplainOverSql(explainFindings, sqlFindings) {
  const explainKeys = new Set();
  for (const ef of explainFindings) {
    const t = (ef.table || '').toLowerCase();
    const c = (ef.column || '').toLowerCase();
    if (t && c) explainKeys.add(`${t}|${c}`);
  }

  return sqlFindings.filter((sf) => {
    const t = (sf.table || '').toLowerCase();
    const c = (sf.column || '').toLowerCase();
    if (t && c && explainKeys.has(`${t}|${c}`)) return false;
    return true;
  });
}

function mergeAndRank(explainFindings, sqlFindings) {
  const dedupedSql = dedupeExplainOverSql(explainFindings, sqlFindings);
  const merged = [...explainFindings, ...dedupedSql];

  merged.sort((a, b) => {
    const sevA = SEVERITY_ORDER[a.severity] || 0;
    const sevB = SEVERITY_ORDER[b.severity] || 0;
    if (sevB !== sevA) return sevB - sevA;

    const simA = simulationRank(a);
    const simB = simulationRank(b);
    if (simB !== simA) return simB - simA;

    const sciA = effectiveSciDelta(a);
    const sciB = effectiveSciDelta(b);
    if (sciA == null && sciB == null) return 0;
    if (sciA == null) return 1;
    if (sciB == null) return -1;
    return sciA - sciB;
  });

  return merged;
}

module.exports = { mergeAndRank, dedupeExplainOverSql };
