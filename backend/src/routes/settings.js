import { Router } from 'express';
import { appPool } from '../config/db.js';
import { SCORE_WEIGHTS, SCORE_BASELINES, TIER_THRESHOLDS } from '../services/scoring.js';

const DEFAULT_SETTINGS = {
  weights: { ...SCORE_WEIGHTS },
  baselines: { ...SCORE_BASELINES },
  tierThresholds: { ...TIER_THRESHOLDS },
  strictMode: false,
};

async function ensureSettingsTable() {
  await appPool.query(`
    CREATE TABLE IF NOT EXISTS querycarbon_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      data JSONB NOT NULL DEFAULT '{}'
    )
  `);
  const r = await appPool.query('SELECT data FROM querycarbon_settings WHERE id = $1', ['default']);
  if (!r.rows.length) {
    await appPool.query(
      'INSERT INTO querycarbon_settings (id, data) VALUES ($1, $2)',
      ['default', JSON.stringify(DEFAULT_SETTINGS)]
    );
  }
}

const router = Router();

router.get('/settings', async (req, res) => {
  try {
    await ensureSettingsTable();
    const r = await appPool.query('SELECT data FROM querycarbon_settings WHERE id = $1', ['default']);
    const data = r.rows[0]?.data || DEFAULT_SETTINGS;
    res.json({ ...DEFAULT_SETTINGS, ...data });
  } catch (err) {
    console.error('get settings error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch settings' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const { weights, tierThresholds, strictMode, baselines } = req.body;

    await ensureSettingsTable();

    const r = await appPool.query('SELECT data FROM querycarbon_settings WHERE id = $1', ['default']);
    const current = r.rows[0]?.data ? { ...DEFAULT_SETTINGS, ...r.rows[0].data } : DEFAULT_SETTINGS;

    const next = { ...current };
    if (weights && typeof weights === 'object') {
      const sum = (weights.w1 ?? 0) + (weights.w2 ?? 0) + (weights.w3 ?? 0) + (weights.w4 ?? 0);
      if (Math.abs(sum - 1) > 0.001) {
        return res.status(400).json({ error: 'Weights must sum to 1.0' });
      }
      next.weights = { ...current.weights, ...weights };
    }
    if (tierThresholds && typeof tierThresholds === 'object') {
      next.tierThresholds = { ...current.tierThresholds, ...tierThresholds };
    }
    if (typeof strictMode === 'boolean') next.strictMode = strictMode;
    if (baselines && typeof baselines === 'object') {
      next.baselines = { ...current.baselines, ...baselines };
    }

    await appPool.query(
      'INSERT INTO querycarbon_settings (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2',
      ['default', JSON.stringify(next)]
    );
    res.json(next);
  } catch (err) {
    console.error('put settings error:', err);
    res.status(500).json({ error: err.message || 'Failed to update settings' });
  }
});

export default router;
