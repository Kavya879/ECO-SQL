/**
 * Track 2 — hypopg Index Simulation
 * Simulates hypothetical indexes and measures cost impact using the hypopg extension.
 */

const { getPoolForDatabase } = require('../db/connection');

/**
 * Check whether the hypopg extension is installed in the target database.
 */
async function checkHypopgAvailable(client) {
  try {
    const res = await client.query(`SELECT * FROM pg_extension WHERE extname = 'hypopg'`);
    return res.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Run EXPLAIN (no ANALYZE) and return the root Total Cost.
 */
async function getExplainCost(client, sql) {
  const res = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
  const plan = res.rows[0]?.['QUERY PLAN'];
  const data = Array.isArray(plan) ? plan[0] : plan;
  return (data?.Plan ?? data)?.['Total Cost'] ?? 0;
}

/**
 * Create a hypothetical index, re-run EXPLAIN, then drop the index.
 * Always drops in finally to avoid leaking.
 *
 * @param {object} client - Connected pg client
 * @param {string} sql - Original SQL query
 * @param {string} ddl - Index DDL string
 * @param {number} costBefore - Baseline EXPLAIN cost
 * @returns {{ costBefore, costAfter, costDelta, indexrelid }}
 */
async function simulateOneIndex(client, sql, ddl, costBefore) {
  let indexrelid = null;
  try {
    const createRes = await client.query(`SELECT * FROM hypopg_create_index($1)`, [ddl]);
    indexrelid = createRes.rows[0]?.indexrelid;

    const costAfter = await getExplainCost(client, sql);
    return {
      costBefore,
      costAfter,
      costDelta: costAfter - costBefore,
      indexrelid,
    };
  } finally {
    if (indexrelid) {
      try {
        await client.query(`SELECT hypopg_drop_index($1)`, [indexrelid]);
      } catch (dropErr) {
        console.warn('[HypoPG] Failed to drop hypothetical index:', dropErr.message);
      }
    }
  }
}

/**
 * Run Track 2 simulations against a target database.
 * Mutates finding objects in-place, adding simulation status, cost_after, cost_delta, sci_delta.
 *
 * @param {string} dbName - Target database name
 * @param {string} sql - Original SQL query
 * @param {Array} findings - Track 1 findings array (mutated in-place)
 * @param {number} sciOriginal - Original SCI value from the stored query
 * @returns {{ hypopg_available: boolean }}
 */
async function runSimulations(dbName, sql, findings, sciOriginal) {
  const pool = getPoolForDatabase(dbName);
  const client = await pool.connect();

  try {
    const available = await checkHypopgAvailable(client);

    if (!available) {
      console.log('[HypoPG] Extension not available — all simulations marked heuristic');
      return { hypopg_available: false };
    }

    const costBefore = findings[0]?.cost_before || (await getExplainCost(client, sql));

    // Collect findings that need simulation, cap at 5
    const toSimulate = findings
      .filter(f => f.forward_to_track2 && f.index_ddl)
      .slice(0, 5);

    // Check for two findings pointing to the same table with different columns — try composite
    const byTable = {};
    for (const f of toSimulate) {
      if (!byTable[f.table]) byTable[f.table] = [];
      byTable[f.table].push(f);
    }

    // Simulate individual indexes
    for (const f of toSimulate) {
      try {
        const result = await simulateOneIndex(client, sql, f.index_ddl, costBefore);
        const sciDelta = (sciOriginal != null && costBefore > 0)
          ? sciOriginal * (result.costDelta / costBefore)
          : null;

        f.simulation = result.costDelta < 0 ? 'simulated' : 'no_improvement';
        f.cost_before = result.costBefore;
        f.cost_after = result.costAfter;
        f.cost_delta = result.costDelta;
        f.sci_delta = sciDelta;
      } catch (err) {
        console.warn(`[HypoPG] Simulation failed for ${f.pattern_id} on ${f.table}:`, err.message);
        f.simulation = 'heuristic';
      }
    }

    // Attempt composite index for tables with multiple findings
    for (const [table, tableFindgs] of Object.entries(byTable)) {
      if (tableFindgs.length < 2) continue;

      // Extract column lists from each DDL and merge them
      const cols = [];
      for (const f of tableFindgs) {
        const colMatch = f.index_ddl?.match(/\(([^)]+)\)/);
        if (colMatch) {
          colMatch[1].split(',').map(c => c.trim()).forEach(c => {
            if (!cols.includes(c)) cols.push(c);
          });
        }
      }

      if (cols.length < 2) continue;

      const compositeDdl = `CREATE INDEX ON ${table} (${cols.join(', ')})`;
      try {
        const result = await simulateOneIndex(client, sql, compositeDdl, costBefore);
        const sciDelta = (sciOriginal != null && costBefore > 0)
          ? sciOriginal * (result.costDelta / costBefore)
          : null;

        // If composite beats the best individual, annotate the first finding for that table
        const bestIndividual = tableFindgs.reduce((best, f) =>
          (f.cost_delta ?? 0) < (best.cost_delta ?? 0) ? f : best, tableFindgs[0]);

        if (result.costDelta < (bestIndividual.cost_delta ?? 0)) {
          bestIndividual.simulation = result.costDelta < 0 ? 'simulated' : 'no_improvement';
          bestIndividual.cost_after = result.costAfter;
          bestIndividual.cost_delta = result.costDelta;
          bestIndividual.sci_delta = sciDelta;
          bestIndividual.index_ddl = compositeDdl;
          bestIndividual.suggestion += ` (composite index across ${cols.length} columns performed best)`;
        }
      } catch (err) {
        console.warn(`[HypoPG] Composite simulation failed for ${table}:`, err.message);
      }
    }

    return { hypopg_available: true };
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { runSimulations };
