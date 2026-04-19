require('dotenv').config();
const { Pool } = require('pg');

const cfg = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  database: process.env.DB_NAME || 'postgres',
};

console.log('[QueryCarbon] DB config:', { ...cfg, password: cfg.password ? '***' : '(empty — check .env!)' });

const defaultPool = new Pool({ ...cfg, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });

function getPoolForDatabase(dbName) {
  return new Pool({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    database: dbName, max: 3, connectionTimeoutMillis: 5000,
  });
}

async function listDatabases() {
  const client = await defaultPool.connect();
  try {
    const result = await client.query(`
      SELECT datname AS name FROM pg_database
      WHERE datistemplate = false
      ORDER BY datname ASC
    `);
    console.log(`[DB] Available databases: ${result.rows.map(r => r.name).join(', ')}`);
    return result.rows;
  } finally {
    client.release();
  }
}

async function listTables(dbName) {
  const pool = getPoolForDatabase(dbName);
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT table_name AS name, table_schema AS schema
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog','information_schema')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `);
    return result.rows;
  } finally {
    client.release();
    await pool.end();
  }
}

async function executeQueryOnDatabase(dbName, sql) {
  console.log(`[DB] Creating pool for database: "${dbName}"`);
  const pool = getPoolForDatabase(dbName);
  const client = await pool.connect();
  console.log(`[DB] Connected to database: "${dbName}"`);
  try {
    // Get EXPLAIN plan to extract planner cost
    let plannerCost = 0;
    try {
      const explainResult = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
      if (explainResult.rows && explainResult.rows[0]) {
        const plan = explainResult.rows[0]['QUERY PLAN'];
        if (Array.isArray(plan) && plan[0]) {
          plannerCost = plan[0]['Total Cost'] || 0;
        }
      }
      console.log(`[DB] Planner cost extracted: ${plannerCost}`);
    } catch (explainErr) {
      console.warn(`[DB] Could not extract planner cost (expected for non-SELECT queries):`, explainErr.message);
    }

    // Execute the actual query
    const start = process.hrtime.bigint();
    const result = await client.query(sql);
    const end = process.hrtime.bigint();
    const runtimeMs = Number(end - start) / 1_000_000;
    console.log(`[DB] Query executed. Runtime: ${runtimeMs.toFixed(3)}ms, Rows returned: ${result.rowCount}, Planner cost: ${plannerCost}`);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      fields: result.fields ? result.fields.map(f => f.name) : [],
      runtimeMs,
      plannerCost,
    };
  } finally {
    client.release();
    await pool.end();
    console.log(`[DB] Connection closed for database: "${dbName}"`);
  }
}

async function ensureHistoryTable() {
  const client = await defaultPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS querycarbon_history (
        id SERIAL PRIMARY KEY,
        query_text TEXT NOT NULL,
        database_name VARCHAR(255),
        runtime_s DOUBLE PRECISION,
        energy_kwh DOUBLE PRECISION,
        operational_emissions_gco2 DOUBLE PRECISION,
        embodied_emissions_gco2 DOUBLE PRECISION,
        total_emissions_gco2 DOUBLE PRECISION,
        sci DOUBLE PRECISION,
        classification VARCHAR(50),
        tables_involved TEXT[],
        hardware_config JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } finally {
    client.release();
  }
}

async function saveToHistory(data) {
  const client = await defaultPool.connect();
  try {
    const result = await client.query(
      `INSERT INTO querycarbon_history 
        (query_text, database_name, runtime_s, energy_kwh, operational_emissions_gco2,
         embodied_emissions_gco2, total_emissions_gco2, sci, classification, tables_involved, hardware_config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, created_at`,
      [
        data.query_text, data.database_name, data.runtime_s, data.energy_kwh,
        data.operational_emissions_gco2, data.embodied_emissions_gco2,
        data.total_emissions_gco2, data.sci, data.classification,
        data.tables_involved, JSON.stringify(data.hardware_config),
      ]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function getHistory({ limit = 50, offset = 0, search = '', classification = '', days = 30 } = {}) {
  const client = await defaultPool.connect();
  try {
    const conditions = [`created_at >= NOW() - INTERVAL '${parseInt(days)} days'`];
    const params = [];
    let idx = 1;
    if (search) { conditions.push(`query_text ILIKE $${idx}`); params.push(`%${search}%`); idx++; }
    if (classification && classification !== 'all') { conditions.push(`classification = $${idx}`); params.push(classification.toUpperCase()); idx++; }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await client.query(`SELECT COUNT(*) FROM querycarbon_history ${where}`, params);
    params.push(parseInt(limit), parseInt(offset));
    const rows = await client.query(
      `SELECT * FROM querycarbon_history ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );
    return { rows: rows.rows, total: parseInt(countRes.rows[0].count) };
  } finally {
    client.release();
  }
}

async function getDashboardStats(days = 30) {
  const client = await defaultPool.connect();
  try {
    const d = parseInt(days);
    const stats = await client.query(`
      SELECT
        COUNT(*) AS total_queries,
        COALESCE(SUM(total_emissions_gco2) / 1000, 0) AS total_co2_kg,
        COUNT(*) FILTER (WHERE classification = 'HIGH IMPACT') AS high_impact,
        COUNT(*) FILTER (WHERE classification = 'SUSTAINABLE') AS sustainable,
        COALESCE(AVG(total_emissions_gco2), 0) AS avg_gco2_per_query
      FROM querycarbon_history
      WHERE created_at >= NOW() - INTERVAL '${d} days'
    `);
    const trend = await client.query(`
      SELECT DATE_TRUNC('day', created_at) AS day,
        AVG(total_emissions_gco2) AS avg_gco2
      FROM querycarbon_history
      WHERE created_at >= NOW() - INTERVAL '${d} days'
      GROUP BY day ORDER BY day ASC
    `);
    const recent = await client.query(`
      SELECT id, query_text, total_emissions_gco2, classification, runtime_s, created_at, database_name, tables_involved
      FROM querycarbon_history ORDER BY created_at DESC LIMIT 5
    `);
    const pie = await client.query(`
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE classification='SUSTAINABLE') * 100.0 / NULLIF(COUNT(*),0), 0) AS sustainable_pct,
        COALESCE(COUNT(*) FILTER (WHERE classification='MODERATE') * 100.0 / NULLIF(COUNT(*),0), 0) AS moderate_pct,
        COALESCE(COUNT(*) FILTER (WHERE classification='HIGH IMPACT') * 100.0 / NULLIF(COUNT(*),0), 0) AS high_impact_pct
      FROM querycarbon_history
      WHERE created_at >= NOW() - INTERVAL '${d} days'
    `);
    return { stats: stats.rows[0], trend: trend.rows, recent: recent.rows, distribution: pie.rows[0] };
  } finally {
    client.release();
  }
}

async function clearHistory(days) {
  const client = await defaultPool.connect();
  try {
    let query = 'DELETE FROM querycarbon_history';
    if (days && parseInt(days) > 0) {
      const d = parseInt(days);
      query += ` WHERE created_at < NOW() - INTERVAL '${d} days'`;
    }
    const result = await client.query(query);
    console.log(`[DB] Cleared ${result.rowCount} records from history`);
    return { count: result.rowCount };
  } finally {
    client.release();
  }
}

module.exports = { defaultPool, listDatabases, listTables, executeQueryOnDatabase, ensureHistoryTable, saveToHistory, getHistory, getDashboardStats, clearHistory };