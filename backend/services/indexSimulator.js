/**
 * Track 2 — hypopg Index Simulation
 */

const { costToSciDelta } = require('./carbonCalculator');

function extractTotalCostFromExplainRows(rows) {
  if (!rows || !rows[0]) return null;
  const planWrapper = rows[0]['QUERY PLAN'];
  if (Array.isArray(planWrapper) && planWrapper[0]?.Plan) {
    return Number(planWrapper[0].Plan['Total Cost']);
  }
  return null;
}

function parseIndexDdl(ddl) {
  if (!ddl) return null;
  const m = String(ddl).match(/CREATE\s+INDEX\s+ON\s+([^\s(]+)\s*\(\s*([^)]+)\s*\)/i);
  if (!m) return null;
  const table = m[1].trim();
  const colsPart = m[2].trim();
  const columns = colsPart.split(',').map((c) => c.trim()).filter(Boolean);
  return { table, columns, raw: ddl.trim() };
}

async function extensionAvailable(client, extName) {
  const r = await client.query(
    'SELECT COUNT(*)::int AS cnt FROM pg_extension WHERE extname = $1',
    [extName]
  );
  return r.rows[0]?.cnt > 0;
}

async function dropHypoIndex(client, indexrelid) {
  if (indexrelid == null) return;
  try {
    await client.query('SELECT hypopg_drop_index($1)', [indexrelid]);
  } catch {
    /* ignore */
  }
}

/**
 * Run hypopg simulations on explain findings (mutates findings in place).
 */
async function simulateHypopg(findings, sql, client, costBefore, baseSci) {
  const forwarded = findings.filter(
    (f) => f.forward_to_track2 && f.index_ddl && String(f.index_ddl).trim()
  );

  if (!forwarded.length) return findings;

  const tableGroups = new Map();
  for (const f of forwarded) {
    const parsed = parseIndexDdl(f.index_ddl);
    if (!parsed || !parsed.columns.length) continue;
    if (!tableGroups.has(parsed.table)) tableGroups.set(parsed.table, []);
    tableGroups.get(parsed.table).push({ finding: f, parsed });
  }

  const simulationTasks = [];

  for (const [table, items] of tableGroups) {
    const allCols = [...new Set(items.flatMap((i) => i.parsed.columns))];
    if (allCols.length >= 2) {
      const compositeDdl = `CREATE INDEX ON ${table}(${allCols.join(', ')})`;
      simulationTasks.push({
        ddl: compositeDdl,
        findings: items.map((i) => i.finding),
        priority: Math.max(...items.map((i) => severityScore(i.finding.severity))),
      });
    } else {
      for (const item of items) {
        simulationTasks.push({
          ddl: item.parsed.raw,
          findings: [item.finding],
          priority: severityScore(item.finding.severity),
        });
      }
    }
  }

  simulationTasks.sort((a, b) => b.priority - a.priority);
  const MAX_SIMS = 5;
  const seenDdl = new Set();
  const tasks = [];
  for (const t of simulationTasks) {
    if (seenDdl.has(t.ddl)) continue;
    seenDdl.add(t.ddl);
    tasks.push(t);
    if (tasks.length >= MAX_SIMS) break;
  }

  for (const task of tasks) {
    let indexrelid = null;
    try {
      const createRes = await client.query('SELECT indexrelid FROM hypopg_create_index($1)', [
        task.ddl,
      ]);
      indexrelid = createRes.rows[0]?.indexrelid ?? null;

      const explainAfter = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
      const costAfter = extractTotalCostFromExplainRows(explainAfter.rows);
      const costDelta =
        costBefore != null && costAfter != null ? costAfter - costBefore : null;
      const sciDelta =
        costDelta != null ? costToSciDelta(costDelta, costBefore, baseSci) : null;

      const tag =
        costDelta == null ? 'heuristic' : costDelta < 0 ? 'simulated' : 'no_improvement';

      for (const f of task.findings) {
        f.simulation = tag;
        f.cost_before = costBefore;
        f.cost_after = costAfter;
        f.cost_delta = costDelta;
        f.sci_delta = sciDelta;
        if (tag === 'simulated' || tag === 'no_improvement') {
          f.index_ddl = task.ddl;
        }
      }
    } catch (err) {
      for (const f of task.findings) {
        f.simulation = 'heuristic';
        f.simulation_error = err.message;
        f.cost_before = costBefore;
        f.cost_after = null;
        f.cost_delta = null;
        f.sci_delta = null;
      }
    } finally {
      await dropHypoIndex(client, indexrelid);
    }
  }

  for (const f of forwarded) {
    if (!f.simulation) {
      f.simulation = 'heuristic';
      f.cost_before = costBefore;
      f.cost_after = null;
      f.cost_delta = null;
      f.sci_delta = null;
    }
  }

  return findings;
}

function severityScore(sev) {
  if (sev === 'high') return 3;
  if (sev === 'medium') return 2;
  return 1;
}

module.exports = {
  simulateHypopg,
  extensionAvailable,
  extractTotalCostFromExplainRows,
};
