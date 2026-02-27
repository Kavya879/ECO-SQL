import { Router } from 'express';
import { appPool } from '../config/db.js';

const router = Router();

router.get('/export-query/:queryId', async (req, res) => {
  try {
    const { queryId } = req.params;
    const r = await appPool.query('SELECT * FROM querycarbon_analyses WHERE query_id = $1', [queryId]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Query not found' });

    const exportData = {
      queryId: row.query_id,
      queryString: row.query_string,
      analyzedAt: row.analyzed_at,
      runtimeMs: row.runtime_ms,
      runtimeSource: row.runtime_source,
      energyKwh: parseFloat(row.energy_kwh),
      operationalCo2: parseFloat(row.operational_co2_gco2eq),
      embodiedCo2: parseFloat(row.embodied_co2_gco2eq),
      sciPerQuery: parseFloat(row.sci_gco2eq_per_query),
      sustainabilityRating: row.sustainability_rating,
      tier: row.tier,
      classification: row.classification,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="querycarbon-${queryId}.json"`);
    res.send(JSON.stringify(exportData, null, 2));
  } catch (err) {
    console.error('export-query error:', err);
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

router.get('/export-csv', async (req, res) => {
  try {
    const { classification, tier, dateRange = '30', limit = 1000 } = req.query;
    let where = [];
    const params = [];
    let i = 1;

    if (classification) {
      where.push(`classification = $${i++}`);
      params.push(classification);
    }
    if (tier) {
      where.push(`tier = $${i++}`);
      params.push(tier);
    }
    if (dateRange && dateRange !== 'all') {
      const days = Math.min(365, parseInt(dateRange, 10) || 30);
      where.push(`analyzed_at >= NOW() - INTERVAL '${days} days'`);
    }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    params.push(Math.min(5000, Math.max(1, +limit)));

    const rows = await appPool.query(
      `SELECT query_id, LEFT(query_string, 500) as query_snippet, runtime_ms, energy_kwh,
              sci_gco2eq_per_query, num_tables, classification, analyzed_at
       FROM querycarbon_analyses ${whereClause}
       ORDER BY analyzed_at DESC LIMIT $${i}`,
      params
    );

    const headers = ['query_id', 'query_snippet', 'runtime_s', 'energy_kwh', 'gco2eq', 'tables', 'classification', 'timestamp'];
    const lines = [
      headers.join(','),
      ...rows.rows.map((r) =>
        [
          r.query_id,
          `"${(r.query_snippet || '').replace(/"/g, '""')}"`,
          r.runtime_ms != null ? parseFloat(r.runtime_ms) / 1000 : '',
          r.energy_kwh ?? '',
          r.sci_gco2eq_per_query ?? '',
          r.num_tables ?? '',
          r.classification ?? '',
          r.analyzed_at ?? '',
        ].join(',')
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="querycarbon-reports.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('export-csv error:', err);
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

router.get('/export-report', async (req, res) => {
  try {
    const { dateRange = '30' } = req.query;
    const days = dateRange === 'all' ? 3650 : Math.min(365, parseInt(dateRange, 10) || 30);
    const interval = `NOW() - INTERVAL '${days} days'`;

    const [statsRes, trendRes] = await Promise.all([
      appPool.query(
        `SELECT COUNT(*)::int as total, COALESCE(AVG(sci_gco2eq_per_query), 0)::float as avg_sci,
                COALESCE(AVG(sustainability_rating), 0)::float as avg_score
         FROM querycarbon_analyses WHERE analyzed_at >= ${interval}`
      ),
      appPool.query(
        `SELECT DATE(analyzed_at) as d, AVG(sci_gco2eq_per_query)::float as avg_sci, COUNT(*)::int as cnt
         FROM querycarbon_analyses WHERE analyzed_at >= ${interval}
         GROUP BY DATE(analyzed_at) ORDER BY d ASC`
      ),
    ]);

    const s = statsRes.rows[0];
    const report = {
      generatedAt: new Date().toISOString(),
      periodDays: days,
      totalQueries: s?.total ?? 0,
      avgGco2PerQuery: s?.avg_sci ?? 0,
      avgSustainabilityScore: s?.avg_score ?? 0,
      emissionsTrend: (trendRes.rows || []).map((r) => ({ date: r.d, avgSci: r.avg_sci, count: r.cnt })),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="querycarbon-report.json"');
    res.send(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('export-report error:', err);
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

export default router;
