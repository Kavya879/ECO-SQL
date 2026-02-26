import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Pool } = pg;

function parseDbUrl(url) {
  if (!url) return { host: 'localhost', port: 5432, database: 'querycarbon', user: 'postgres', password: '' };
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: parseInt(u.port || '5432', 10),
      database: (u.pathname || '/querycarbon').slice(1) || 'querycarbon',
      user: u.username || 'postgres',
      password: (u.password ?? '') + '',
    };
  } catch {
    return { host: 'localhost', port: 5432, database: 'querycarbon', user: 'postgres', password: '' };
  }
}

const appConfig = parseDbUrl(process.env.DATABASE_URL);

// App log/metadata store
export const appPool = new Pool(appConfig);

// Target dataset pool (for EXPLAIN ANALYZE) - configured per-connection
export function createTargetPool(config) {
  return new Pool(config);
}
