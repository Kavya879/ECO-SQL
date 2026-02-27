import { Router } from 'express';
import analyzeRouter from './analyze.js';
import queriesRouter from './queries.js';
import settingsRouter from './settings.js';
import exportRouter from './export.js';

const router = Router();
router.get('/health', (req, res) => res.json({ status: 'ok', service: 'querycarbon-api' }));
router.use('/', analyzeRouter);
router.use('/', queriesRouter);
router.use('/', settingsRouter);
router.use('/', exportRouter);

export default router;
