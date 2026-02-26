import pg from 'pg';

const { Pool } = pg;

// App log/metadata store
export const appPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/querycarbon',
});

// Target dataset pool (for EXPLAIN ANALYZE) - configured per-connection
export function createTargetPool(config) {
  return new Pool(config);
}
