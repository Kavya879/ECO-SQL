import { Router } from 'express';

const router = Router();

router.post('/analyze-query', (req, res) => {
  res.status(501).json({ error: 'Not implemented - Phase 1' });
});

export default router;
