require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ensureHistoryTable } = require('./db/connection');
const carbonRoutes = require('./routes/carbonRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '10mb' }));

app.use('/api', carbonRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Unexpected server error', detail: err.message });
});

async function start() {
  try {
    await ensureHistoryTable();
    console.log('✓ History table ready');
    app.listen(PORT, () => {
      console.log(`✓ QueryCarbon API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
