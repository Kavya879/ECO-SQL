const db = require('../db/connection');
const { calculateAll, extractTables } = require('../services/carbonCalculator');
const hardwareDetector = require('../services/hardwareDetector');

/**
 * POST /api/analyze
 * Execute SQL query and compute carbon metrics
 * Hardware config parameters are optional; auto-detected if not provided
 */
async function analyzeQuery(req, res) {
  try {
    const { sql, database } = req.body;

    // Validate required SQL and database parameters
    if (!sql || typeof sql !== 'string' || !sql.trim()) {
      return res.status(400).json({ error: 'Missing or empty required field: sql' });
    }
    if (!database || typeof database !== 'string' || !database.trim()) {
      return res.status(400).json({ error: 'Missing or empty required field: database' });
    }

    // Execute the query and measure actual runtime
    let queryResult;
    try {
      queryResult = await db.executeQueryOnDatabase(database, sql);
    } catch (dbErr) {
      return res.status(400).json({
        error: 'Query execution failed',
        detail: dbErr.message,
      });
    }

    const runtimeSeconds = queryResult.runtimeMs / 1000;

    // Use auto-detected hardware config, merged with any user-provided overrides
    const hardwareConfig = hardwareDetector.mergeWithDefaults(req.body);

    // Calculate carbon metrics
    const metrics = calculateAll({
      runtimeSeconds,
      cpuCores: hardwareConfig.cpuCores,
      powerPerCore: hardwareConfig.powerPerCore,
      cpuUtilization: hardwareConfig.cpuUtilization,
      ramGb: hardwareConfig.ramGb,
      pue: hardwareConfig.pue,
      gridIntensity: hardwareConfig.gridIntensity,
      te: hardwareConfig.te,
      el: hardwareConfig.el,
      rr: hardwareConfig.rr,
      tor: hardwareConfig.tor,
    });

    const tables = extractTables(sql);

    // Save to history
    const saved = await db.saveToHistory({
      query_text: sql,
      database_name: database,
      runtime_s: runtimeSeconds,
      energy_kwh: metrics.energy_kwh,
      operational_emissions_gco2: metrics.operational_emissions_gco2,
      embodied_emissions_gco2: metrics.embodied_emissions_gco2,
      total_emissions_gco2: metrics.total_emissions_gco2,
      sci: metrics.sci,
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
      ...metrics,
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

module.exports = { analyzeQuery, getDatabases, getTables, getHistory, getDashboard, getHardwareConfig, exportHistory };
