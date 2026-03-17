const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/carbonController');

router.post('/analyze', ctrl.analyzeQuery);
router.get('/databases', ctrl.getDatabases);
router.get('/databases/:dbName/tables', ctrl.getTables);
router.get('/hardware-config', ctrl.getHardwareConfig);
router.get('/history', ctrl.getHistory);
router.delete('/history', ctrl.clearHistory);
router.get('/history/export', ctrl.exportHistory);
router.get('/dashboard', ctrl.getDashboard);

module.exports = router;
