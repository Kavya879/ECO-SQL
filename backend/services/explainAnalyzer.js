/**
 * Track 1 — EXPLAIN Pattern Analysis
 * Walks the EXPLAIN JSON tree and detects performance anti-patterns P1–P10.
 */

const SQL_KEYWORDS = new Set([
  'NOT', 'NULL', 'TRUE', 'FALSE', 'AND', 'OR', 'IN', 'EXISTS', 'IS',
  'LIKE', 'ILIKE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'AS', 'ALL', 'ANY', 'NO',
]);

const FUNCTION_NAMES = ['lower', 'upper', 'date', 'to_char', 'extract', 'coalesce', 'cast'];

// ===================== HELPERS =====================

function extractColumnsFromFilter(filterStr) {
  if (!filterStr) return [];
  const cols = new Set();
  const re = /\b([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:=|<=?|>=?|<>|!=|IS\s+NULL|IS\s+NOT\s+NULL|LIKE\b|ILIKE\b)/gi;
  let m;
  while ((m = re.exec(filterStr)) !== null) {
    const col = m[1].split('.').pop();
    if (!SQL_KEYWORDS.has(col.toUpperCase()) && col.length > 1) {
      cols.add(col.toLowerCase());
    }
  }
  return Array.from(cols);
}

function extractFunctionInfo(filterStr) {
  if (!filterStr) return null;
  // Check for named functions
  const fnPattern = new RegExp(`\\b(${FUNCTION_NAMES.join('|')})\\s*\\(([^)]+)\\)`, 'i');
  const fnMatch = filterStr.match(fnPattern);
  if (fnMatch) {
    return { fn: fnMatch[1].toLowerCase(), expr: fnMatch[0], col: fnMatch[2].trim().split(/[\s,]/)[0] };
  }
  // Check for :: cast operator
  const castMatch = filterStr.match(/([a-zA-Z_][a-zA-Z0-9_]*)::([a-zA-Z_]+)/);
  if (castMatch) {
    return { fn: '::', expr: castMatch[0], col: castMatch[1] };
  }
  return null;
}

function findFirstRelationInSubtree(node) {
  if (!node) return null;
  if (node['Relation Name']) return node['Relation Name'];
  for (const child of (node['Plans'] || [])) {
    const rel = findFirstRelationInSubtree(child);
    if (rel) return rel;
  }
  return null;
}

function subtreeHasIndexScanOnTable(node, tableName) {
  if (!node) return false;
  const nodeType = node['Node Type'] || '';
  if (
    (nodeType === 'Index Scan' || nodeType === 'Index Only Scan') &&
    (!tableName || (node['Relation Name'] || '').toLowerCase() === tableName.toLowerCase())
  ) return true;
  return (node['Plans'] || []).some(c => subtreeHasIndexScanOnTable(c, tableName));
}

function subtreeHasIndexScanBackward(node) {
  if (!node) return false;
  if ((node['Node Type'] || '') === 'Index Scan Backward') return true;
  return (node['Plans'] || []).some(c => subtreeHasIndexScanBackward(c));
}

function getRows(node) {
  return node['Actual Rows'] ?? node['Plan Rows'] ?? 0;
}

function normalizeSortKey(key) {
  return key
    .replace(/\s+(DESC|ASC)$/i, '')
    .replace(/^[^.]+\./, '');
}

// ===================== PATTERN CHECKERS =====================

/**
 * P1 — Sequential scan with filter
 * P2 — Function call on a filter column (suppresses P1 when both match)
 */
function checkP1P2(node, findings, rootCost) {
  if (node['Node Type'] !== 'Seq Scan') return;
  const filter = node['Filter'];
  if (!filter) return;

  const table = node['Relation Name'];
  if (!table) return;

  const actualRows = getRows(node);
  const rowsRemoved = node['Rows Removed by Filter'] ?? 0;

  const hasFn = FUNCTION_NAMES.some(fn => new RegExp(`\\b${fn}\\s*\\(`, 'i').test(filter));
  const hasCast = /::/.test(filter);

  if (hasFn || hasCast) {
    const fnInfo = extractFunctionInfo(filter);
    findings.push({
      pattern_id: 'P2',
      track: 'explain_analysis',
      table,
      severity: 'high',
      simulation: 'heuristic',
      forward_to_track2: true,
      suggestion: `Create a functional/expression index that mirrors the exact filter expression on table "${table}": \`CREATE INDEX ON ${table} (${fnInfo ? fnInfo.expr : 'expression'})\``,
      rationale: `Sequential scan on "${table}" applies a function/cast in the filter \`${filter.substring(0, 100)}\`, which prevents a standard B-tree index from being used.${actualRows > 0 ? ` ${actualRows.toLocaleString()} rows examined, ${rowsRemoved.toLocaleString()} removed by filter.` : ''}`,
      index_ddl: `CREATE INDEX ON ${table} (${fnInfo ? fnInfo.expr : 'expression'})`,
      sci_delta: null,
      cost_before: rootCost,
    });
    return; // P2 suppresses P1
  }

  const cols = extractColumnsFromFilter(filter);
  const severity = actualRows > 10000 ? 'high' : 'medium';

  findings.push({
    pattern_id: 'P1',
    track: 'explain_analysis',
    table,
    severity,
    simulation: 'heuristic',
    forward_to_track2: true,
    suggestion: `Add a B-tree index on the filter column(s)${cols.length > 0 ? ` (${cols.join(', ')})` : ''} on table "${table}"`,
    rationale: `Sequential scan on "${table}" with filter \`${filter.substring(0, 100)}\`. ${actualRows.toLocaleString()} rows examined, ${rowsRemoved.toLocaleString()} removed by filter.`,
    index_ddl: cols.length > 0
      ? `CREATE INDEX ON ${table} (${cols.join(', ')})`
      : `CREATE INDEX ON ${table} (column_name)`,
    sci_delta: null,
    cost_before: rootCost,
  });
}

/**
 * P3 — Sort without supporting index
 */
function checkP3(node, findings, rootCost) {
  if (node['Node Type'] !== 'Sort') return;

  const rows = getRows(node);
  if (rows <= 5000) return;

  const sortKeys = node['Sort Key'] || [];
  const table = findFirstRelationInSubtree(node);
  if (!table) return;

  if (!subtreeHasIndexScanOnTable(node, table)) {
    const cleanKeys = sortKeys.map(normalizeSortKey).filter(Boolean);
    findings.push({
      pattern_id: 'P3',
      track: 'explain_analysis',
      table,
      severity: 'medium',
      simulation: 'heuristic',
      forward_to_track2: true,
      suggestion: `Add an index on the sort key column(s) (${cleanKeys.join(', ')}). If the query also filters, use a composite index with the filter column first and sort column second.`,
      rationale: `Sort node on table "${table}" processes ${rows.toLocaleString()} rows without a supporting index. Sort keys: ${sortKeys.join(', ')}`,
      index_ddl: cleanKeys.length > 0 ? `CREATE INDEX ON ${table} (${cleanKeys.join(', ')})` : null,
      sci_delta: null,
      cost_before: rootCost,
    });
  }
}

/**
 * P4 — Nested loop on large outer set
 */
function checkP4(node, findings, rootCost) {
  if (node['Node Type'] !== 'Nested Loop') return;

  const plans = node['Plans'] || [];
  if (plans.length < 1) return;

  const outerRows = getRows(plans[0]);
  if (outerRows <= 1000) return;

  const severity = outerRows >= 10000 ? 'high' : 'medium';
  const outerTable = findFirstRelationInSubtree(plans[0]);
  const innerTable = plans[1] ? findFirstRelationInSubtree(plans[1]) : null;

  findings.push({
    pattern_id: 'P4',
    track: 'explain_analysis',
    table: outerTable || 'unknown',
    severity,
    simulation: 'heuristic',
    forward_to_track2: true,
    suggestion: `Nested Loop chosen but the outer set is large (${outerRows.toLocaleString()} rows). Ensure join columns on both sides${outerTable ? ` ("${outerTable}"` : ''}${innerTable ? ` and "${innerTable}"` : ''}${outerTable ? ')' : ''} are indexed. If indexes exist and the problem persists, consider \`SET enable_nestloop = off\` at session level.`,
    rationale: `Nested Loop join with ${outerRows.toLocaleString()} outer rows${outerTable ? ` from "${outerTable}"` : ''}${innerTable ? `, joined to "${innerTable}"` : ''}. This is O(outer × inner) scan cost without proper indexes.`,
    index_ddl: outerTable ? `CREATE INDEX ON ${outerTable} (join_column)` : null,
    sci_delta: null,
    cost_before: rootCost,
  });
}

/**
 * P5 — Bad cardinality estimate
 */
function checkP5(node, findings, rootCost) {
  const planRows = node['Plan Rows'];
  const actualRows = node['Actual Rows'];
  if (planRows == null || actualRows == null) return;
  if (planRows === 0 && actualRows === 0) return;

  const ratio = planRows === 0
    ? (actualRows > 0 ? Infinity : 1)
    : Math.max(actualRows / planRows, planRows / actualRows);

  if (ratio <= 10) return;

  const table = node['Relation Name'] || findFirstRelationInSubtree(node) || 'unknown';
  const severity = ratio >= 100 ? 'high' : 'medium';

  findings.push({
    pattern_id: 'P5',
    track: 'explain_analysis',
    table,
    severity,
    simulation: 'heuristic',
    forward_to_track2: false,
    suggestion: `Statistics are stale or missing. Run \`ANALYZE ${table}\`. If the problem persists after ANALYZE, increase statistics target: \`ALTER TABLE ${table} ALTER COLUMN col SET STATISTICS 500\``,
    rationale: `Bad cardinality estimate on "${table}": planner expected ${planRows.toLocaleString()} rows but got ${actualRows.toLocaleString()} (ratio: ${ratio === Infinity ? '∞' : ratio.toFixed(1)}×). This causes the planner to choose suboptimal plans.`,
    index_ddl: null,
    sci_delta: null,
    cost_before: rootCost,
  });
}

/**
 * P6 — CTE used as a materialisation fence
 */
function checkP6(node, findings, rootCost, pgVersion) {
  if (node['Node Type'] !== 'CTE Scan') return;
  if (pgVersion && pgVersion < 12) return;

  const cteName = node['CTE Name'] || 'cte_name';

  findings.push({
    pattern_id: 'P6',
    track: 'explain_analysis',
    table: cteName,
    severity: 'medium',
    simulation: 'heuristic',
    forward_to_track2: false,
    suggestion: `PostgreSQL 12+ materialises CTEs by default, blocking predicate pushdown. If "${cteName}" is referenced only once, inline it as a subquery. Otherwise add NOT MATERIALIZED: \`WITH ${cteName} AS NOT MATERIALIZED (...)\``,
    rationale: `CTE "${cteName}" is materialised as a fence, preventing the planner from pushing predicates into it. The full CTE is evaluated before any outer filters are applied.`,
    index_ddl: null,
    sci_delta: null,
    cost_before: rootCost,
  });
}

/**
 * P7 — Index scan with high filter removal ratio
 */
function checkP7(node, findings, rootCost) {
  if (node['Node Type'] !== 'Index Scan') return;

  const actualRows = node['Actual Rows'] ?? 0;
  const rowsRemoved = node['Rows Removed by Filter'] ?? 0;

  if (rowsRemoved <= actualRows * 5) return;

  const table = node['Relation Name'];
  const indexName = node['Index Name'] || 'index';
  const filter = node['Filter'] || node['Index Cond'] || '';
  const cols = extractColumnsFromFilter(filter);

  findings.push({
    pattern_id: 'P7',
    track: 'explain_analysis',
    table: table || 'unknown',
    severity: 'medium',
    simulation: 'heuristic',
    forward_to_track2: true,
    suggestion: `Index "${indexName}" on "${table}" is not selective enough. ${cols.length > 0 ? `Create a composite index: \`CREATE INDEX ON ${table} (existing_col, ${cols.join(', ')})\`` : 'Consider a partial index with a WHERE clause matching the secondary filter condition.'}`,
    rationale: `Index scan on "${table}" using "${indexName}" passed ${rowsRemoved.toLocaleString()} rows to filter but only ${actualRows.toLocaleString()} survived. The index is found but too broad. Filter: \`${filter.substring(0, 80)}\``,
    index_ddl: table && cols.length > 0
      ? `CREATE INDEX ON ${table} (index_col, ${cols.join(', ')})`
      : (table ? `CREATE INDEX ON ${table} (col) WHERE condition` : null),
    sci_delta: null,
    cost_before: rootCost,
  });
}

/**
 * P8 — Hash join on tiny tables
 */
function checkP8(node, findings, rootCost) {
  if (node['Node Type'] !== 'Hash Join') return;

  const plans = node['Plans'] || [];
  if (plans.length < 2) return;

  const rowsA = getRows(plans[0]);
  const rowsB = getRows(plans[1]);

  if (rowsA >= 100 || rowsB >= 100) return;

  const tableA = findFirstRelationInSubtree(plans[0]);
  const tableB = findFirstRelationInSubtree(plans[1]);

  findings.push({
    pattern_id: 'P8',
    track: 'explain_analysis',
    table: tableA || 'unknown',
    severity: 'low',
    simulation: 'heuristic',
    forward_to_track2: true,
    suggestion: `Hash Join overhead is unnecessary for very small tables${tableA ? ` ("${tableA}"` : ''}${tableB ? ` and "${tableB}"` : ''}${tableA ? ')' : ''}. Ensure both join columns are indexed so the planner switches to a cheaper Nested Loop.`,
    rationale: `Hash Join used on tiny sets: ${rowsA} rows${tableA ? ` from "${tableA}"` : ''} and ${rowsB} rows${tableB ? ` from "${tableB}"` : ''}. Hash table build overhead dominates at this scale.`,
    index_ddl: tableA ? `CREATE INDEX ON ${tableA} (join_column)` : null,
    sci_delta: null,
    cost_before: rootCost,
  });
}

/**
 * P9 — Bitmap heap scan with many pages
 */
function checkP9(node, findings, rootCost) {
  if (node['Node Type'] !== 'Bitmap Heap Scan') return;

  const actualRows = getRows(node);
  if (actualRows <= 50000) return;

  const table = node['Relation Name'];
  const recheckCond = node['Recheck Cond'] || '';
  const cols = extractColumnsFromFilter(recheckCond);

  findings.push({
    pattern_id: 'P9',
    track: 'explain_analysis',
    table: table || 'unknown',
    severity: 'medium',
    simulation: 'heuristic',
    forward_to_track2: true,
    suggestion: `Bitmap scan on "${table}" returns ${actualRows.toLocaleString()} rows — bitmap scans degrade at high row counts. If the column has very low cardinality (boolean/enum), use a partial index per value. If selectivity is high, a regular B-tree index may outperform.`,
    rationale: `Bitmap Heap Scan on "${table}" with ${actualRows.toLocaleString()} rows. Recheck condition: \`${recheckCond.substring(0, 80)}\``,
    index_ddl: table && cols.length > 0 ? `CREATE INDEX ON ${table} (${cols.join(', ')})` : null,
    sci_delta: null,
    cost_before: rootCost,
  });
}

/**
 * P10 — Explicit sort on a column that could use Index Scan Backward
 */
function checkP10(node, findings, rootCost) {
  if (node['Node Type'] !== 'Sort') return;

  const sortKeys = node['Sort Key'] || [];
  const hasDesc = sortKeys.some(k => /\bDESC\b/i.test(k));
  if (!hasDesc) return;

  if (subtreeHasIndexScanBackward(node)) return;

  const table = findFirstRelationInSubtree(node);
  const descKeys = sortKeys.filter(k => /\bDESC\b/i.test(k)).map(normalizeSortKey);

  findings.push({
    pattern_id: 'P10',
    track: 'explain_analysis',
    table: table || 'unknown',
    severity: 'low',
    simulation: 'heuristic',
    forward_to_track2: true,
    suggestion: `A descending sort on (${descKeys.join(', ')}) can use an Index Scan Backward if an index exists. Add the index and the planner will likely choose \`Index Scan Backward\` instead of an explicit sort.`,
    rationale: `Explicit Sort node with DESC key(s) (${sortKeys.join(', ')}) without a supporting index. No Index Scan Backward found in the subtree.`,
    index_ddl: table && descKeys.length > 0
      ? `CREATE INDEX ON ${table} (${descKeys.join(' DESC, ')} DESC)`
      : null,
    sci_delta: null,
    cost_before: rootCost,
  });
}

// ===================== MAIN WALKER =====================

function walkTree(node, findings, context) {
  if (!node || typeof node !== 'object') return;

  checkP1P2(node, findings, context.rootCost);
  checkP3(node, findings, context.rootCost);
  checkP4(node, findings, context.rootCost);
  checkP5(node, findings, context.rootCost);
  checkP6(node, findings, context.rootCost, context.pgVersion);
  checkP7(node, findings, context.rootCost);
  checkP8(node, findings, context.rootCost);
  checkP9(node, findings, context.rootCost);
  checkP10(node, findings, context.rootCost);

  for (const child of (node['Plans'] || [])) {
    walkTree(child, findings, context);
  }
}

/**
 * Analyse a PostgreSQL EXPLAIN JSON plan and return ranked pattern findings.
 *
 * @param {Array|Object} explainJson - Parsed EXPLAIN (FORMAT JSON) output
 * @param {number} pgVersion - PostgreSQL major version (default 14)
 * @returns {{ findings: Array, rootCost: number }}
 */
function analyzeExplainJson(explainJson, pgVersion = 14) {
  const data = typeof explainJson === 'string' ? JSON.parse(explainJson) : explainJson;
  const topLevel = Array.isArray(data) ? data[0] : data;
  const plan = topLevel?.Plan || topLevel;
  const rootCost = plan?.['Total Cost'] || 0;

  const rawFindings = [];
  walkTree(plan, rawFindings, { pgVersion, rootCost });

  // Deduplicate by (table, pattern_id)
  const seen = new Set();
  const deduped = rawFindings.filter(f => {
    const key = `${f.table}:${f.pattern_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // P2 suppresses P1 for the same table
  const p2Tables = new Set(deduped.filter(f => f.pattern_id === 'P2').map(f => f.table));
  const findings = deduped.filter(f => !(f.pattern_id === 'P1' && p2Tables.has(f.table)));

  return { findings, rootCost };
}

module.exports = { analyzeExplainJson };
