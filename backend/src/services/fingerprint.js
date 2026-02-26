import crypto from 'crypto';

/**
 * Normalize query for fingerprinting (strip comments, collapse whitespace)
 */
export function normalizeQuery(sql) {
  if (!sql || typeof sql !== 'string') return '';
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Create fingerprint hash for historical lookup
 */
export function fingerprint(sql) {
  const norm = normalizeQuery(sql);
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 64);
}
