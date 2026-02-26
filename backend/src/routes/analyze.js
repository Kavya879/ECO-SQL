import { Router } from 'express';
import { analyzeQuery } from '../services/analysisService.js';

const router = Router();

router.post('/analyze-query', async (req, res) => {
  try {
    const { query, connectionId, hardwareConfig, dryRun } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Query string is required' });
    }

    const result = await analyzeQuery({
      query: query.trim(),
      connectionId,
      hardwareConfig: hardwareConfig || {},
      dryRun: Boolean(dryRun),
    });

    res.json({
      queryId: result.queryId,
      analyzedAt: result.analyzedAt,
      runtimeMs: result.runtimeMs,
      runtimeSource: result.runtimeSource,
      energyKwh: result.energyKwh,
      operationalCo2: result.operationalCo2,
      embodiedCo2: result.embodiedCo2,
      sciPerQuery: result.sciPerQuery,
      sustainabilityRating: result.sustainabilityRating,
      score: result.score,
      scoreBreakdown: result.scoreBreakdown,
      tier: result.tier,
      classification: result.classification,
      numTables: result.numTables,
      tablesInvolved: result.tablesInvolved,
      plannerCost: result.plannerCost,
      rowsExamined: result.rowsExamined,
    });
  } catch (err) {
    console.error('Analyze error:', err);
    const status = err.message?.includes('required') ? 400 : 500;
    res.status(status).json({
      error: err.message || 'Analysis failed',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

export default router;
