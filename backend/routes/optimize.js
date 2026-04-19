/**
 * POST /api/optimize-query
 * Runs all three optimisation tracks against a stored query and returns ranked findings.
 */

const express = require('express');
const router = express.Router();
const { getQueryById, getExplainPlan } = require('../db/connection');
const { analyzeExplainJson } = require('../services/explainAnalyzer');
const { runSimulations } = require('../services/indexSimulator');
const { analyzeSqlPatterns } = require('../services/sqlPatternMatcher');
const { buildResponse } = require('../services/optimizationRanker');

router.post('/optimize-query', async (req, res) => {
  try {
    const { query_id } = req.body;

    if (!query_id) {
      return res.status(400).json({ error: 'Missing required field: query_id' });
    }

    // ── Step 1: Fetch stored query ──────────────────────────────────────────
    const record = await getQueryById(query_id);
    if (!record) {
      return res.status(404).json({ error: `Query #${query_id} not found in history` });
    }

    const { query_text: sql, database_name: dbName, sci: sciOriginal } = record;
    console.log(`[Optimize] query_id=${query_id} db="${dbName}" sci=${sciOriginal}`);

    // ── Step 2: Get EXPLAIN plan ────────────────────────────────────────────
    let explainJson;
    try {
      explainJson = await getExplainPlan(dbName, sql);
    } catch (err) {
      console.error('[Optimize] EXPLAIN failed:', err.message);
      return res.status(400).json({
        error: 'Could not run EXPLAIN on the stored query',
        detail: err.message,
      });
    }

    // ── Step 3: Track 1 — EXPLAIN pattern analysis ─────────────────────────
    const { findings: track1Findings, rootCost } = analyzeExplainJson(explainJson);
    console.log(`[Optimize] Track 1: ${track1Findings.length} finding(s), rootCost=${rootCost}`);

    // ── Step 4: Track 2 — hypopg simulation ────────────────────────────────
    let hypopgAvailable = false;
    const track2Candidates = track1Findings.filter(f => f.forward_to_track2);

    if (track2Candidates.length > 0) {
      try {
        const simResult = await runSimulations(dbName, sql, track1Findings, sciOriginal);
        hypopgAvailable = simResult.hypopg_available;
        console.log(`[Optimize] Track 2: hypopg_available=${hypopgAvailable}`);
      } catch (err) {
        console.warn('[Optimize] Track 2 simulation error (non-fatal):', err.message);
      }
    }

    // ── Step 5: Track 3 — SQL pattern matching ─────────────────────────────
    const track3Findings = analyzeSqlPatterns(sql);
    console.log(`[Optimize] Track 3: ${track3Findings.length} finding(s)`);

    // ── Step 6: Merge and rank ──────────────────────────────────────────────
    const payload = buildResponse(track1Findings, track3Findings, hypopgAvailable);

    res.json({
      query_id: parseInt(query_id, 10),
      database: dbName,
      sql_snippet: sql.substring(0, 120),
      sci_original: sciOriginal,
      explain_root_cost: rootCost,
      ...payload,
    });
  } catch (err) {
    console.error('[Optimize] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

/**
 * GET /api/history/:id
 * Return a single history record by id (used by QueryDetail page to load query metadata).
 */
router.get('/history/:id', async (req, res) => {
  try {
    const record = await getQueryById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: `Query #${req.params.id} not found` });
    }
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
