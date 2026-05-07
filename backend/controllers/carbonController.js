const db = require('../db/connection');
const { calculateAll, extractTables } = require('../services/carbonCalculator');
const hardwareDetector = require('../services/hardwareDetector');
const { analyzeQuery: analyzeOptimization } = require('../services/queryOptimizer');
const { analyzeExplainJson } = require('../services/explainAnalyzer');
const { analyzeSqlPatterns } = require('../services/sqlPatternMatcher');
const { mergeAndRank } = require('../services/optimizationRanker');
const {
  simulateHypopg,
  extensionAvailable: pgExtensionAvailable,
  extractTotalCostFromExplainRows,
} = require('../services/indexSimulator');
const { simulateHints } = require('../services/hintSimulator');

function enrichFinding(f) {
  const titleParts = [f.pattern_id];
  if (f.table) titleParts.push(f.table);
  return {
    ...f,
    title: titleParts.join(' — '),
    description: [f.rationale, f.suggestion].filter(Boolean).join(' · ') || f.suggestion || '',
  };
}

function computeTotalSciDeltaEstimated(findings) {
  let sum = 0;
  let any = false;
  for (const f of findings) {
    const candidates = [f.sci_delta, f.hint_sci_delta].filter(
      (v) => v != null && typeof v === 'number' && v < 0
    );
    if (candidates.length) {
      sum += Math.min(...candidates);
      any = true;
    }
  }
  return any ? Math.round(sum * 1e7) / 1e7 : null;
}

/**
 * POST /api/analyze
 * Execute SQL query and compute carbon metrics
 * Hardware config parameters are optional; auto-detected if not provided
 */
async function analyzeQuery(req, res) {
  try {
    const analysisStart = process.hrtime.bigint();
    const { sql, database } = req.body;

    // Validate required SQL and database parameters
    if (!sql || typeof sql !== 'string' || !sql.trim()) {
      return res.status(400).json({ error: 'Missing or empty required field: sql' });
    }
    if (!database || typeof database !== 'string' || !database.trim()) {
      return res.status(400).json({ error: 'Missing or empty required field: database' });
    }

    console.log(`[QueryCarbon] Analyzing query on database: "${database}"`);
    console.log(`[QueryCarbon] Query preview: ${sql.substring(0, 80).replace(/\n/g, ' ')}...`);

    // Execute the query and measure actual runtime
    let queryResult;
    try {
      queryResult = await db.executeQueryOnDatabase(database, sql);
      console.log(`[QueryCarbon] ✓ Query executed on "${database}" | DB runtime: ${queryResult.runtimeMs.toFixed(2)}ms | Rows: ${queryResult.rowCount} | Cost: ${queryResult.plannerCost}`);
    } catch (dbErr) {
      console.error(`[QueryCarbon] ✗ Query execution failed on "${database}":`, dbErr.message);
      return res.status(400).json({
        error: 'Query execution failed',
        detail: dbErr.message,
      });
    }

    // Use actual measured runtime
    const runtimeSeconds = queryResult.runtimeMs / 1000;

    // Use auto-detected hardware config, merged with any user-provided overrides
    const hardwareConfig = hardwareDetector.mergeWithDefaults(req.body);

    // Estimate planner cost from runtime if not extracted from EXPLAIN
    // Conservative estimate: use runtime as rough proxy with modest scaling
    let plannerCost = queryResult.plannerCost;
    if (!plannerCost || plannerCost < 10) {
      // Estimate: 100 base cost + (runtimeMs^1.2 * 10) for modest scaling
      // This keeps most short queries in reasonable range (100-2000)
      plannerCost = 100 + Math.pow(queryResult.runtimeMs, 1.2) * 10;
      console.log(`[QueryCarbon] Estimated planner cost: ${plannerCost.toFixed(0)}`);
    }

    // Calculate carbon metrics using updated calculator
    const metrics = calculateAll({
      executionSeconds: runtimeSeconds,
      cpuCores: hardwareConfig.cpuCores,
      powerPerCore: hardwareConfig.powerPerCore,
      cpuUtilization: hardwareConfig.cpuUtilization,
      memoryGb: hardwareConfig.ramGb,
      plannerCost: plannerCost,
      rowsExamined: queryResult.rowCount || 0,
      pue: hardwareConfig.pue,
      gridIntensity: hardwareConfig.gridIntensity,
      te: hardwareConfig.te,
      el: hardwareConfig.el,
      rr: hardwareConfig.rr,
      tor: hardwareConfig.tor,
    });

    // Log detailed metrics for debugging
    console.log(`[QueryCarbon] Energy: ${metrics.energy_kwh} kWh | Op Emissions: ${metrics.operational_emissions_gco2eq} gCO2 | Embodied: ${metrics.embodied_emissions_gco2eq} gCO2 | Total: ${metrics.total_emissions_gco2eq} gCO2 | Score: ${metrics.sustainability_score}`);
    console.log(`[QueryCarbon] Hardware: cores=${hardwareConfig.cpuCores}, power/core=${hardwareConfig.powerPerCore}W, util=${(hardwareConfig.cpuUtilization*100).toFixed(1)}%, ram=${hardwareConfig.ramGb}GB, PUE=${hardwareConfig.pue}`);
    console.log(`[QueryCarbon] Grid Intensity: ${hardwareConfig.gridIntensity} gCO2/kWh | TE: ${hardwareConfig.te} gCO2eq | EL: ${hardwareConfig.el}h | RR: ${hardwareConfig.rr} | ToR: ${hardwareConfig.tor}h`);

    const tables = extractTables(sql);
    const optimization = analyzeOptimization(sql, null);

    // Map metrics for response and persistence
    const responseMetrics = {
      energy_kwh: metrics.energy_kwh,
      operational_emissions_gco2: metrics.operational_emissions_gco2eq,
      embodied_emissions_gco2: metrics.embodied_emissions_gco2eq,
      total_emissions_gco2: metrics.total_emissions_gco2eq,
      sci: metrics.sci_gco2eq_per_query,
      sustainability_score: metrics.sustainability_score,
      classification: metrics.classification,
      tier_label: metrics.tier_label,
      tier_description: metrics.tier_description,
      normalized_metrics: metrics.normalized_metrics,
      grid_intensity_used: metrics.grid_intensity_used,
      pue_used: metrics.pue_used,
    };

    const analysisRuntimeMs = Number(process.hrtime.bigint() - analysisStart) / 1_000_000;
    const analysisRuntimeSeconds = analysisRuntimeMs / 1000;

    // Save to history
    const saved = await db.saveToHistory({
      query_text: sql,
      database_name: database,
      runtime_s: analysisRuntimeSeconds,
      energy_kwh: metrics.energy_kwh,
      operational_emissions_gco2: metrics.operational_emissions_gco2eq,
      embodied_emissions_gco2: metrics.embodied_emissions_gco2eq,
      total_emissions_gco2: metrics.total_emissions_gco2eq,
      sci: metrics.sci_gco2eq_per_query,
      classification: metrics.classification,
      tables_involved: tables,
      hardware_config: hardwareConfig,
    });

    res.json({
      query_id: saved.id,
      created_at: saved.created_at,
      database,
      sql_snippet: sql.substring(0, 120),
      tables_involved: tables,
      row_count: queryResult.rowCount,
      fields: queryResult.fields,
      results_preview: queryResult.rows.slice(0, 10),
      analysis_runtime_ms: analysisRuntimeMs,
      db_runtime_ms: queryResult.runtimeMs,
      actual_runtime_ms: queryResult.runtimeMs,
      runtime_s: analysisRuntimeSeconds,
      db_runtime_s: runtimeSeconds,
      optimization,
      ...responseMetrics,
    });
  } catch (err) {
    console.error('analyzeQuery error:', err);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}

/**
 * GET /api/databases
 */
async function getDatabases(req, res) {
  try {
    const databases = await db.listDatabases();
    res.json({ databases });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/hardware-config
 * Returns auto-detected hardware configuration
 */
function getHardwareConfig(req, res) {
  try {
    const config = hardwareDetector.getAutoDetectedConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/databases/:dbName/tables
 */
async function getTables(req, res) {
  try {
    const { dbName } = req.params;
    const tables = await db.listTables(dbName);
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/history
 */
async function getHistory(req, res) {
  try {
    const { limit = 50, offset = 0, search = '', classification = '', days = 30 } = req.query;
    const result = await db.getHistory({ limit, offset, search, classification, days });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/history/:id
 */
async function getHistoryById(req, res) {
  try {
    const { id } = req.params;
    const row = await db.getHistoryById(id);
    if (!row) {
      return res.status(404).json({ error: 'Query history record not found' });
    }
    return res.json({ row });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/optimize-query
 * Phase 3: EXPLAIN pattern analysis, hypopg index simulation, pg_hint_plan hints,
 * rule-based SQL patterns. Body: { query_id } | { sql, database? }
 */
async function optimizeQuery(req, res) {
  try {
    const { query_id, sql, database: databaseOverride } = req.body || {};
    let queryText = typeof sql === 'string' ? sql.trim() : '';
    let databaseName = typeof databaseOverride === 'string' ? databaseOverride.trim() : '';
    let resolvedQueryId = query_id || null;
    let historicSci = null;

    if (!queryText && query_id) {
      const row = await db.getHistoryById(query_id);
      if (!row) {
        return res.status(404).json({ error: 'Query history record not found for optimization' });
      }
      queryText = String(row.query_text || '').trim();
      databaseName = databaseName || String(row.database_name || '').trim();
      historicSci = row.sci != null ? Number(row.sci) : null;
    }

    if (!queryText) {
      return res.status(400).json({ error: 'Missing required field: query_id or sql' });
    }

    const sqlPatternFindings = analyzeSqlPatterns(queryText);

    if (!databaseName) {
      const ranked = mergeAndRank([], sqlPatternFindings);
      const enriched = ranked.map(enrichFinding);
      return res.json({
        query_id: resolvedQueryId,
        hypopg_available: false,
        pg_hint_plan_available: false,
        explain_plan: null,
        findings: enriched,
        total_sci_delta_estimated: computeTotalSciDeltaEstimated(enriched),
        note:
          'No target database available — only SQL pattern rules ran. Provide a saved query_id with database_name or pass database with sql.',
      });
    }

    const pool = db.getPoolForDatabase(databaseName);
    const client = await pool.connect();

    try {
      const hypopgAvailable = await pgExtensionAvailable(client, 'hypopg');
      const pgHintPlanAvailable = await pgExtensionAvailable(client, 'pg_hint_plan');

      const explainRes = await client.query(`EXPLAIN (FORMAT JSON) ${queryText}`);
      const queryPlan = explainRes.rows[0]?.['QUERY PLAN'];
      const costBefore = extractTotalCostFromExplainRows(explainRes.rows);

      let explainFindings = analyzeExplainJson(queryPlan);

      const sciBase =
        historicSci != null && historicSci > 0 ? historicSci : 0.1;

      if (!hypopgAvailable) {
        explainFindings.forEach((f) => {
          if (f.forward_to_track2) {
            f.simulation = 'heuristic';
            f.cost_before = costBefore;
            f.cost_after = null;
            f.cost_delta = null;
            f.sci_delta = null;
          }
        });
      } else {
        await simulateHypopg(explainFindings, queryText, client, costBefore, sciBase);
      }

      if (!pgHintPlanAvailable) {
        explainFindings.forEach((f) => {
          if (f.forward_to_track2b && f.hint) {
            f.hint_simulation = 'heuristic';
            f.hinted_query = null;
            f.hint_cost_before = costBefore;
            f.hint_cost_after = null;
            f.hint_cost_delta = null;
            f.hint_sci_delta = null;
          }
        });
      } else {
        await simulateHints(explainFindings, queryText, client, costBefore, sciBase);
      }

      const ranked = mergeAndRank(explainFindings, sqlPatternFindings);
      const enriched = ranked.map(enrichFinding);

      return res.json({
        query_id: resolvedQueryId,
        hypopg_available: hypopgAvailable,
        pg_hint_plan_available: pgHintPlanAvailable,
        explain_plan: queryPlan ?? null,
        findings: enriched,
        total_sci_delta_estimated: computeTotalSciDeltaEstimated(enriched),
      });
    } finally {
      client.release();
      await pool.end();
    }
  } catch (err) {
    console.error('optimizeQuery error:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/dashboard
 */
async function getDashboard(req, res) {
  try {
    const { days = 30 } = req.query;
    const data = await db.getDashboardStats(days);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/history/export
 */
async function exportHistory(req, res) {
  try {
    const { days = 30 } = req.query;
    const { rows } = await db.getHistory({ limit: 10000, offset: 0, days });
    
    const headers = ['id','query_text','database_name','runtime_s','energy_kwh','operational_emissions_gco2','embodied_emissions_gco2','total_emissions_gco2','sci','classification','created_at'];
    const csvRows = [headers.join(',')];
    for (const row of rows) {
      csvRows.push(headers.map(h => {
        const val = row[h];
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val ?? '';
      }).join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="querycarbon_history.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /api/history
 * Clear all query history (optional days param to clear older entries)
 */
async function clearHistory(req, res) {
  try {
    const { days } = req.query;
    const result = await db.clearHistory(days);
    res.json({ message: `Cleared ${result.count} records from history`, count: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { analyzeQuery, optimizeQuery, getDatabases, getTables, getHistory, getHistoryById, getDashboard, getHardwareConfig, exportHistory, clearHistory };
