/**
 * Merge, deduplicate, and rank findings from all three tracks.
 *
 * Ranking rules:
 *   1. Severity: high → medium → low
 *   2. Simulation status: simulated → heuristic → no_improvement → not_applicable
 *   3. sci_delta ascending (most negative = most improvement = first); nulls go last
 *
 * Deduplication: if Track 1 and Track 3 both flag the same table for a similar issue,
 * keep the Track 1 finding (it has EXPLAIN evidence).
 */

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const SIMULATION_RANK = { simulated: 0, heuristic: 1, no_improvement: 2, not_applicable: 3 };

/**
 * Sort findings according to the plan's ranking rules.
 */
function rankFindings(findings) {
  return [...findings].sort((a, b) => {
    // 1. Severity
    const sevDiff = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    if (sevDiff !== 0) return sevDiff;

    // 2. Simulation status
    const simDiff = (SIMULATION_RANK[a.simulation] ?? 99) - (SIMULATION_RANK[b.simulation] ?? 99);
    if (simDiff !== 0) return simDiff;

    // 3. sci_delta: most negative (most improvement) first; nulls go last
    if (a.sci_delta !== null && b.sci_delta !== null) {
      return a.sci_delta - b.sci_delta;
    }
    if (a.sci_delta !== null) return -1;
    if (b.sci_delta !== null) return 1;

    return 0;
  });
}

/**
 * Merge Track 1 + Track 3 findings, preferring Track 1 for the same table.
 * Track 3 findings with no table never conflict and are always kept.
 */
function mergeAndDeduplicate(track1Findings, track3Findings) {
  // Build a set of tables already covered by Track 1 index-type findings
  const track1IndexTables = new Set(
    track1Findings
      .filter(f => f.index_ddl)
      .map(f => f.table?.toLowerCase())
      .filter(Boolean)
  );

  // Drop Track 3 findings that are already covered by a Track 1 finding for the same table
  const filteredTrack3 = track3Findings.filter(f3 => {
    if (!f3.table) return true; // no table conflict possible
    return !track1IndexTables.has(f3.table?.toLowerCase());
  });

  return [...track1Findings, ...filteredTrack3];
}

/**
 * Build the final response payload from the three tracks' outputs.
 *
 * @param {Array} track1 - Findings from explainAnalyzer (possibly mutated by indexSimulator)
 * @param {Array} track3 - Findings from sqlPatternMatcher
 * @param {boolean} hypopgAvailable - Whether hypopg was detected in the target DB
 * @returns {object} Final response body fields
 */
function buildResponse(track1, track3, hypopgAvailable) {
  const merged = mergeAndDeduplicate(track1, track3);
  const ranked = rankFindings(merged);

  const totalSciDelta = ranked.reduce((sum, f) => {
    return f.sci_delta != null ? sum + f.sci_delta : sum;
  }, 0);

  return {
    findings: ranked,
    total_findings: ranked.length,
    hypopg_available: hypopgAvailable,
    total_sci_delta_estimated: ranked.some(f => f.sci_delta != null) ? totalSciDelta : null,
  };
}

module.exports = { buildResponse, rankFindings, mergeAndDeduplicate };
