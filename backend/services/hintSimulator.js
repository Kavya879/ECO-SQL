/**
 * Track 2b — pg_hint_plan Hint Simulation
 */

const { costToSciDelta } = require('./carbonCalculator');
const { extractTotalCostFromExplainRows } = require('./indexSimulator');

// Strip any leading pg_hint_plan hint blocks (/*+ ... */) from SQL so we never
// double-up hints when the user's own query already starts with a hint comment.
function stripLeadingHints(sql) {
  return sql.replace(/^(\s*\/\*\+[\s\S]*?\*\/\s*)+/, '');
}

async function simulateHints(findings, sql, client, costBefore, baseSci) {
  const forwarded = findings.filter(
    (f) => f.forward_to_track2b && f.hint && String(f.hint).trim()
  );

  if (!forwarded.length) return findings;

  const baseSql = stripLeadingHints(sql);

  for (const f of forwarded) {
    try {
      const hintedSql = `/*+ ${f.hint} */\n${baseSql}`;
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
      f.hinted_query = `/*+ ${f.hint} */\n${baseSql}`;
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
