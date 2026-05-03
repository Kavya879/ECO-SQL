/**
 * Track 2b — pg_hint_plan Hint Simulation
 */

const { costToSciDelta } = require('./carbonCalculator');
const { extractTotalCostFromExplainRows } = require('./indexSimulator');

/**
 * Run pg_hint_plan hint simulations (mutates findings in place).
 */
async function simulateHints(findings, sql, client, costBefore, baseSci) {
  const forwarded = findings.filter(
    (f) => f.forward_to_track2b && f.hint && String(f.hint).trim()
  );

  if (!forwarded.length) return findings;

  for (const f of forwarded) {
    try {
      const hintedSql = `/*+ ${f.hint} */\n${sql}`;
      const explainAfter = await client.query(`EXPLAIN (FORMAT JSON) ${hintedSql}`);
      const costAfter = extractTotalCostFromExplainRows(explainAfter.rows);
      const costDelta =
        costBefore != null && costAfter != null ? costAfter - costBefore : null;
      const sciDelta =
        costDelta != null ? costToSciDelta(costDelta, costBefore, baseSci) : null;

      const tag =
        costDelta == null ? 'heuristic' : costDelta < 0 ? 'confirmed' : 'no_improvement';

      f.hint_simulation = tag;
      f.hinted_query = hintedSql;
      f.hint_cost_before = costBefore;
      f.hint_cost_after = costAfter;
      f.hint_cost_delta = costDelta;
      f.hint_sci_delta = sciDelta;
    } catch (err) {
      f.hint_simulation = 'heuristic';
      f.hinted_query = `/*+ ${f.hint} */\n${sql}`;
      f.hint_cost_before = costBefore;
      f.hint_cost_after = null;
      f.hint_cost_delta = null;
      f.hint_sci_delta = null;
      f.hint_simulation_error = err.message;
    }
  }

  return findings;
}

module.exports = {
  simulateHints,
};
