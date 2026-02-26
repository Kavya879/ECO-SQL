import { Router } from 'express';
import analyzeRouter from './analyze.js';

const router = Router();
router.get('/health', (req, res) => res.json({ status: 'ok', service: 'querycarbon-api' }));
router.use('/', analyzeRouter);

export default router;
