import { Router } from 'express';
import { appPool } from '../config/db.js';

const router = Router();

router.get('/query-history', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      classification,
      tier,
      search,
      dateRange = '30',
      sortBy = 'analyzed_at',
      sortOrder = 'desc',
    } = req.query;

    const offset = (Math.max(1, +page) - 1) * Math.min(50, Math.max(1, +limit));
    const limitVal = Math.min(50, Math.max(1, +limit));
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
    const validSort = ['analyzed_at', 'sci_gco2eq_per_query', 'runtime_ms', 'classification', 'tier'].includes(sortBy)
      ? sortBy
      : 'analyzed_at';

    let where = [];
    let params = [];
    let i = 1;

    if (classification) {
      where.push(`classification = $${i++}`);
      params.push(classification);
    }
    if (tier) {
      where.push(`tier = $${i++}`);
      params.push(tier);
    }
    if (search && search.trim()) {
      where.push(`query_string ILIKE $${i++}`);
      params.push(`%${search.trim()}%`);
    }
    if (dateRange && dateRange !== 'all') {
      const days = parseInt(dateRange, 10) || 30;
      where.push(`analyzed_at >= NOW() - INTERVAL '${Math.min(365, days)} days'`);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [countRes, summaryRes] = await Promise.all([
      appPool.query(`SELECT COUNT(*)::int as total FROM querycarbon_analyses ${whereClause}`, params),
      appPool.query(
        `SELECT classification, COUNT(*)::int as cnt, COALESCE(SUM(sci_gco2eq_per_query), 0)::float as total_sci
         FROM querycarbon_analyses ${whereClause} GROUP BY classification`,
        params
      ),
    ]);
    const total = countRes.rows[0]?.total ?? 0;
    const summary = (summaryRes.rows || []).reduce(
      (acc, r) => {
        acc[r.classification] = (acc[r.classification] || 0) + (r.cnt || 0);
        acc.totalCo2 += parseFloat(r.total_sci || 0);
        return acc;
      },
      { totalCo2: 0 }
    );

    params.push(limitVal, offset);
    const rows = await appPool.query(
      `SELECT query_id, query_string, analyzed_at, runtime_ms, energy_kwh, 
              sci_gco2eq_per_query, num_tables, tables_involved, classification, tier
       FROM querycarbon_analyses ${whereClause}
       ORDER BY ${validSort} ${order}
       LIMIT $${i++} OFFSET $${i}`,
      params
    );

    const items = rows.rows.map((r) => ({
      queryId: r.query_id,
      queryPreview: (r.query_string || '').slice(0, 80) + (r.query_string?.length > 80 ? '...' : ''),
      analyzedAt: r.analyzed_at,
      runtimeMs: r.runtime_ms != null ? parseFloat(r.runtime_ms) : null,
      energyKwh: r.energy_kwh != null ? parseFloat(r.energy_kwh) : null,
      gco2eq: r.sci_gco2eq_per_query != null ? parseFloat(r.sci_gco2eq_per_query) : null,
      numTables: r.num_tables ?? 0,
      tablesInvolved: r.tables_involved || [],
      classification: r.classification,
      tier: r.tier,
    }));

    res.json({
      items,
      total,
      page: Math.max(1, +page),
      limit: limitVal,
      summary: {
        totalCo2: summary.totalCo2,
        sustainable: summary.SUSTAINABLE ?? 0,
        moderate: summary.MODERATE ?? 0,
        highImpact: summary['HIGH IMPACT'] ?? 0,
      },
    });
  } catch (err) {
    console.error('query-history error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch query history' });
  }
});

router.get('/query-details/:queryId', async (req, res) => {
  try {
    const { queryId } = req.params;
    const r = await appPool.query(
      `SELECT * FROM querycarbon_analyses WHERE query_id = $1`,
      [queryId]
    );
    const row = r.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'Query not found' });
    }

    res.json({
      queryId: row.query_id,
      queryString: row.query_string,
      analyzedAt: row.analyzed_at,
      runtimeMs: row.runtime_ms != null ? parseFloat(row.runtime_ms) : null,
      runtimeSource: row.runtime_source,
      energyKwh: row.energy_kwh != null ? parseFloat(row.energy_kwh) : null,
      operationalCo2: row.operational_co2_gco2eq != null ? parseFloat(row.operational_co2_gco2eq) : null,
      embodiedCo2: row.embodied_co2_gco2eq != null ? parseFloat(row.embodied_co2_gco2eq) : null,
      sciPerQuery: row.sci_gco2eq_per_query != null ? parseFloat(row.sci_gco2eq_per_query) : null,
      sustainabilityRating: row.sustainability_rating,
      score: row.score != null ? parseFloat(row.score) : null,
      scoreBreakdown: row.score_breakdown,
      weightsSnapshot: row.weights_snapshot,
      baselinesSnapshot: row.baselines_snapshot,
      tier: row.tier,
      classification: row.classification,
      numTables: row.num_tables ?? 0,
      tablesInvolved: row.tables_involved || [],
      plannerCost: row.planner_cost != null ? parseFloat(row.planner_cost) : null,
      rowsExamined: row.rows_examined,
    });
  } catch (err) {
    console.error('query-details error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch query details' });
  }
});

router.get('/dashboard-stats', async (req, res) => {
  try {
    const { dateRange = '30' } = req.query;
    const days = dateRange === 'all' ? 3650 : Math.min(365, parseInt(dateRange, 10) || 30);
    const interval = `NOW() - INTERVAL '${days} days'`;

    const prevInterval = `NOW() - INTERVAL '${days * 2} days' AND analyzed_at < ${interval}`;

    const [totalRes, avgRes, prevAvgRes, classRes, trendRes, recentRes] = await Promise.all([
      appPool.query(`SELECT COUNT(*)::int as c FROM querycarbon_analyses WHERE analyzed_at >= ${interval}`),
      appPool.query(
        `SELECT COALESCE(AVG(sci_gco2eq_per_query), 0)::float as avg_sci,
                COALESCE(AVG(sustainability_rating), 0)::float as avg_score,
                COUNT(*)::int as cnt
         FROM querycarbon_analyses WHERE analyzed_at >= ${interval}`
      ),
      appPool.query(
        `SELECT COALESCE(AVG(sci_gco2eq_per_query), 0)::float as avg_sci,
                COALESCE(AVG(sustainability_rating), 0)::float as avg_score
         FROM querycarbon_analyses WHERE analyzed_at >= ${prevInterval}`
      ),
      appPool.query(
        `SELECT classification, COUNT(*)::int as cnt
         FROM querycarbon_analyses WHERE analyzed_at >= ${interval}
         GROUP BY classification`
      ),
      appPool.query(
        `SELECT DATE(analyzed_at) as d, AVG(sci_gco2eq_per_query)::float as avg_sci
         FROM querycarbon_analyses WHERE analyzed_at >= ${interval}
         GROUP BY DATE(analyzed_at) ORDER BY d ASC`
      ),
      appPool.query(
        `SELECT query_id, query_string, analyzed_at, runtime_ms, sci_gco2eq_per_query, classification
         FROM querycarbon_analyses WHERE analyzed_at >= ${interval}
         ORDER BY analyzed_at DESC LIMIT 5`
      ),
    ]);

    const total = totalRes.rows[0]?.c ?? 0;
    const avgSci = avgRes.rows[0]?.avg_sci ?? 0;
    const avgScore = avgRes.rows[0]?.avg_score ?? 0;
    const prevAvgSci = prevAvgRes.rows[0]?.avg_sci ?? avgSci;
    const prevAvgScore = prevAvgRes.rows[0]?.avg_score ?? avgScore;
    const pctChangeSci = prevAvgSci > 0 ? ((avgSci - prevAvgSci) / prevAvgSci) * 100 : 0;
    const pctChangeScore = prevAvgScore > 0 ? (avgScore - prevAvgScore) : 0;
    const byClass = Object.fromEntries((classRes.rows || []).map((r) => [r.classification, r.cnt]));
    const trend = (trendRes.rows || []).map((r) => ({ date: r.d, avgSci: r.avg_sci }));
    const recent = (recentRes.rows || []).map((r) => ({
      queryId: r.query_id,
      queryPreview: (r.query_string || '').slice(0, 50) + (r.query_string?.length > 50 ? '...' : ''),
      analyzedAt: r.analyzed_at,
      runtimeMs: r.runtime_ms != null ? parseFloat(r.runtime_ms) : null,
      gco2eq: r.sci_gco2eq_per_query != null ? parseFloat(r.sci_gco2eq_per_query) : null,
      classification: r.classification,
    }));

    const sustainable = byClass.SUSTAINABLE ?? 0;
    const highImpact = byClass['HIGH IMPACT'] ?? 0;
    const moderate = byClass.MODERATE ?? 0;
    const totalClass = sustainable + highImpact + moderate;
    const pctSustainable = totalClass ? Math.round((sustainable / totalClass) * 100) : 0;
    const pctHighImpact = totalClass ? Math.round((highImpact / totalClass) * 100) : 0;

    res.json({
      totalQueries: total,
      avgGco2PerQuery: avgSci,
      sustainabilityScore: Math.round(avgScore),
      totalCo2Saved: 0,
      pctChangeSci,
      pctChangeScore,
      classificationCounts: { sustainable, moderate, highImpact },
      classificationPercentages: { sustainable: pctSustainable, highImpact: pctHighImpact },
      emissionsTrend: trend,
      recentQueries: recent,
      baselineReference: trend.length ? trend.reduce((a, t) => a + t.avgSci, 0) / trend.length : avgSci,
    });
  } catch (err) {
    console.error('dashboard-stats error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch dashboard stats' });
  }
});

export default router;
