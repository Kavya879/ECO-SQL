import { appPool, createTargetPool } from '../config/db.js';
import {
  energyKwh,
  operationalEmissions,
  embodiedEmissions,
  sci,
  EMBODIED_DEFAULTS,
} from './formulas.js';
import {
  computeSustainabilityScore,
  tierFromScore,
  SCORE_WEIGHTS,
  SCORE_BASELINES,
} from './scoring.js';
import { parseExplainJson, getRuntimeMs, getPlannerCost, getRowsExamined } from './explainParser.js';
import { fingerprint } from './fingerprint.js';
import {
  HARDWARE_DEFAULTS,
  COST_TO_MS_CALIBRATION,
  DEMO_USER_ID,
} from '../config/defaults.js';

/**
 * Extract table names from SQL (simple heuristic)
 */
function extractTables(sql) {
  const tables = new Set();
  const fromMatch = sql.matchAll(/\b(?:from|join)\s+([a-z0-9_."]+)/gi);
  for (const m of fromMatch) tables.add(m[1].split(/[\s.]/)[0].replace(/"/g, ''));
  return Array.from(tables);
}

/**
 * Get historical average runtime (ms) by fingerprint
 */
async function getHistoricalRuntime(client, fp) {
  const r = await client.query(
    `SELECT AVG(runtime_ms)::float as avg_ms FROM querycarbon_analyses 
     WHERE query_fingerprint = $1 AND runtime_source = 'measured' AND runtime_ms IS NOT NULL`,
    [fp]
  );
  const avg = r.rows[0]?.avg_ms;
  return avg != null && avg > 0 ? avg : null;
}

/**
 * Run analysis: EXPLAIN ANALYZE or dry-run, compute emissions, persist, return result
 */
export async function analyzeQuery({
  query,
  connectionId,
  hardwareConfig = {},
  dryRun = false,
}) {
  const hw = { ...HARDWARE_DEFAULTS, ...hardwareConfig };
  const emb = { ...EMBODIED_DEFAULTS, ...(hardwareConfig.embodied || {}) };

  const targetConfig = {
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432', 10),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: (process.env.TARGET_DB_PASSWORD ?? '') + '',
    database: process.env.TARGET_DB_NAME || 'postgres',
  };

  let runtimeMs = null;
  let plannerCost = null;
  let rowsExamined = null;
  let explainOutput = null;
  let runtimeSource = 'measured';

  const targetPool = createTargetPool(targetConfig);
  const appClient = await appPool.connect();

  try {
    const fp = fingerprint(query);
    const tables = extractTables(query);

    if (!dryRun) {
      try {
        const explainResult = await targetPool.query(
          'EXPLAIN (ANALYZE, FORMAT JSON) ' + query
        );
        const parsed = parseExplainJson(explainResult.rows);
        if (parsed) {
          explainOutput = parsed;
          runtimeMs = getRuntimeMs(parsed) ?? parsed.actualTime;
          plannerCost = getPlannerCost(parsed);
          rowsExamined = getRowsExamined(parsed);
          runtimeSource = 'measured';
        }
      } catch (err) {
        // Fall through to dry-run fallback on EXPLAIN failure
      }
    }

    if (runtimeMs == null && dryRun) {
      const histMs = await getHistoricalRuntime(appClient, fp);
      if (histMs != null) {
        runtimeMs = histMs;
        runtimeSource = 'estimated';
      } else {
        const costResult = await targetPool.query('EXPLAIN (FORMAT JSON) ' + query);
        const parsed = parseExplainJson(costResult.rows);
        plannerCost = parsed ? getPlannerCost(parsed) : null;
        if (plannerCost != null) {
          runtimeMs = plannerCost * COST_TO_MS_CALIBRATION * 1000;
          runtimeSource = 'estimated';
        }
      }
    }

    if (runtimeMs == null) {
      throw new Error('Could not obtain runtime. Run without dryRun, or ensure historical data/EXPLAIN is available.');
    }

    const t = runtimeMs / 1000;
    const TiR = t / 3600;

    const n_c = hw.cpu_cores ?? 16;
    const P_c = hw.P_c ?? 5;
    const u_c = (hw.cpu_utilization ?? 65) / 100;
    const n_mem = hw.ram_gb ?? 64;
    const PUE = hw.pue ?? 1.3;
    const I = hw.grid_carbon_intensity ?? 442;

    const E = energyKwh({ t, n_c, P_c, u_c, n_mem, PUE });
    const O = operationalEmissions(E, I);
    const M = embodiedEmissions({ TE: emb.TE, TiR, EL: emb.EL, RR: emb.RR });
    const sciVal = sci(O, M, 1);

    const { score, breakdown } = computeSustainabilityScore({
      sci: sciVal,
      planner_cost: plannerCost ?? 0,
      execution_ms: runtimeMs,
      rows_examined: rowsExamined ?? 0,
    });
    const tier = tierFromScore(score);

    const classification =
      tier === 'excellent' || tier === 'good'
        ? 'SUSTAINABLE'
        : tier === 'moderate'
        ? 'MODERATE'
        : 'HIGH IMPACT';

    const row = await appClient.query(
      `INSERT INTO querycarbon_analyses (
        user_id, database_type, query_string, query_fingerprint,
        runtime_ms, runtime_source, planner_cost, rows_examined,
        num_tables, tables_involved, explain_output,
        energy_kwh, operational_co2_gco2eq, embodied_co2_gco2eq,
        sci_gco2eq_per_query, sustainability_rating, score, score_breakdown,
        weights_snapshot, baselines_snapshot, tier, classification,
        pue, grid_carbon_intensity, cpu_cores, ram_gb, cpu_utilization,
        te_gco2eq, el_hours, rr
      ) VALUES (
        $1, 'PostgreSQL', $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
        $22, $23, $24, $25, $26, $27, $28, $29
      )
      RETURNING query_id, analyzed_at`,
      [
        DEMO_USER_ID,
        query,
        fp,
        runtimeMs,
        runtimeSource,
        plannerCost,
        rowsExamined,
        tables.length,
        tables.length ? tables : null,
        explainOutput ? JSON.stringify(explainOutput) : null,
        E,
        O,
        M,
        sciVal,
        Math.round(score),
        score,
        JSON.stringify(breakdown),
        JSON.stringify(SCORE_WEIGHTS),
        JSON.stringify(SCORE_BASELINES),
        tier,
        classification,
        PUE,
        I,
        n_c,
        n_mem,
        u_c * 100,
        emb.TE,
        emb.EL,
        emb.RR,
      ]
    );

    const { query_id, analyzed_at } = row.rows[0];

    return {
      queryId: query_id,
      analyzedAt: analyzed_at,
      runtimeMs,
      runtimeSource,
      energyKwh: E,
      operationalCo2: O,
      embodiedCo2: M,
      sciPerQuery: sciVal,
      sustainabilityRating: Math.round(score),
      score,
      scoreBreakdown: breakdown,
      tier,
      classification,
      numTables: tables.length,
      tablesInvolved: tables,
      plannerCost,
      rowsExamined,
    };
  } finally {
    appClient.release();
    await targetPool.end();
  }
}
