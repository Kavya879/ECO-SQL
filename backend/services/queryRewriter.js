/**
 * Query Rewriter Service
 * Applies safe, carbon-optimizing rewrites to SQL queries
 * Based on fired rule violations and EXPLAIN analysis
 * 
 * Applies rewrites in strict order:
 * 1. Index suggestions (R6, R10, R13) — comments only
 * 2. Structural rewrites (R4, R5, R12, R21) — NOT IN→EXISTS, flatten subqueries
 * 3. Expensive ops (R7, R8, R14, R16, R22) — materialized views, work_mem, templating
 * 4. LIMIT/OFFSET (R1, R3, R20) — add LIMIT, keyset pagination, VACUUM
 * 5. SELECT * (R2) — column placeholder
 * 6. Other optimizations (R9, R11, R15, R17, R18, R19)
 */

// ====================================
// REWRITE 1: Add Missing LIMIT
// ====================================
function rewriteAddMissingLimit(sql, firedRules, context = {}) {
  // Trigger: No LIMIT clause and rows_returned > 10000 OR RC-061 fired
  if (sql.match(/\bLIMIT\b/i)) {
    return null; // Already has LIMIT
  }

  const rc061 = firedRules.find(r => r.rule_id === 'RC-061');
  if (!rc061) {
    return null; // Rule not fired
  }

  const rowsReturned = context.rows_returned || 0;
  if (rowsReturned <= 10000) {
    return null; // Doesn't qualify
  }

  const hasOrderBy = /\bORDER\s+BY\b/i.test(sql);
  let rewrittenSql = sql.trimEnd();
  if (!rewrittenSql.endsWith(';')) {
    rewrittenSql += ';';
  }

  let beforeSnippet = 'No LIMIT clause';
  let afterSnippet = '';

  if (!hasOrderBy) {
    // Add ORDER BY comment with placeholder
    rewrittenSql = rewrittenSql.replace(/;$/, '') +
      '\nORDER BY 1 -- QUERYCARBON: replace 1 with sort column\n' +
      'LIMIT 100;';
    afterSnippet = '...ORDER BY 1 -- replace 1 with sort column\nLIMIT 100;';
  } else {
    rewrittenSql = rewrittenSql.replace(/;$/, '') + '\nLIMIT 100;';
    afterSnippet = '...LIMIT 100;';
  }

  return {
    rule_id: 'R1',
    rewrite_name: 'Add Missing LIMIT',
    description: 'Added LIMIT 100 — unbounded result sets waste serialisation CPU and network energy',
    before_snippet: beforeSnippet,
    after_snippet: afterSnippet,
    estimated_carbon_reduction_pct: 45.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 2: Replace SELECT * with Placeholder
// ====================================
function rewriteSelectStar(sql, firedRules, context = {}) {
  // Trigger: query contains SELECT * or SELECT alias.*
  const selectStarPattern = /SELECT\s+(\w+\.)?\*/i;
  if (!selectStarPattern.test(sql)) {
    return null; // No SELECT *
  }

  const rewrittenSql = sql.replace(
    /SELECT\s+(\w+\.)?\*/gi,
    'SELECT /* QUERYCARBON: specify only needed columns e.g. id, name */'
  );

  if (rewrittenSql === sql) {
    return null; // No change
  }

  return {
    rule_id: 'R2',
    rewrite_name: 'Replace SELECT * with Column Placeholder',
    description: 'SELECT * fetches all columns — unnecessary I/O and network bandwidth per row',
    before_snippet: 'SELECT *',
    after_snippet: 'SELECT /* QUERYCARBON: specify only needed columns e.g. id, name */',
    estimated_carbon_reduction_pct: 35.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 3: Replace OFFSET with Keyset Pagination
// ====================================
function rewriteOffsetToKeyset(sql, firedRules, context = {}) {
  // Trigger: query contains OFFSET with value > 0
  const offsetPattern = /OFFSET\s+(\d+)/i;
  const match = sql.match(offsetPattern);

  if (!match || parseInt(match[1], 10) === 0) {
    return null; // No OFFSET or OFFSET 0
  }

  const offsetValue = parseInt(match[1], 10);
  
  // Remove OFFSET clause
  let rewrittenSql = sql.replace(/\s+OFFSET\s+\d+/i, '');

  // Add keyset filter (assumes id or primary key)
  const wherePattern = /WHERE\s+/i;
  if (wherePattern.test(rewrittenSql)) {
    rewrittenSql = rewrittenSql.replace(wherePattern, 'WHERE id > :last_id AND ');
  } else {
    // No WHERE clause, add new one before ORDER BY
    const orderByPattern = /ORDER\s+BY/i;
    if (orderByPattern.test(rewrittenSql)) {
      rewrittenSql = rewrittenSql.replace(/(\s+ORDER\s+BY)/i, ' WHERE id > :last_id ORDER BY');
    } else {
      rewrittenSql = rewrittenSql.trimEnd() + '\nWHERE id > :last_id';
    }
  }

  // Ensure ORDER BY id exists
  if (!/ORDER\s+BY\s+id/i.test(rewrittenSql)) {
    if (/ORDER\s+BY/i.test(rewrittenSql)) {
      // Has ORDER BY but not by id — comment it
      rewrittenSql = rewrittenSql.replace(
        /ORDER\s+BY/i,
        'ORDER BY id -- QUERYCARBON: or maintain original sort column'
      );
    } else {
      rewrittenSql = rewrittenSql.trimEnd() + '\nORDER BY id';
    }
  }

  return {
    rule_id: 'R3',
    rewrite_name: 'Replace OFFSET with Keyset Pagination',
    description: `OFFSET ${offsetValue} forces scan and discard of ${offsetValue} rows — keyset pagination eliminates this entirely`,
    before_snippet: `... OFFSET ${offsetValue}`,
    after_snippet: '... WHERE id > :last_id ORDER BY id',
    estimated_carbon_reduction_pct: 60.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 4: Replace NOT IN with NOT EXISTS
// ====================================
function rewriteNotInToNotExists(sql, firedRules, context = {}) {
  // Trigger: query contains NOT IN (SELECT ...)
  const notInPattern = /NOT\s+IN\s*\(\s*SELECT\s+/i;
  if (!notInPattern.test(sql)) {
    return null; // No NOT IN
  }

  // This is a complex rewrite requiring subquery extraction
  // For safety, only apply if we can clearly identify the pattern
  const notInFullPattern = /(\w+)\s+NOT\s+IN\s*\(\s*SELECT\s+(\w+)\s+FROM\s+(\w+)(?:\s+WHERE\s+([^)]+))?\)/i;
  const match = sql.match(notInFullPattern);

  if (!match) {
    return null; // Pattern too complex, skip
  }

  const [, outerCol, innerCol, innerTable, whereClause] = match;
  
  // Build NOT EXISTS version
  let existsClause = `NOT EXISTS (SELECT 1 FROM ${innerTable} WHERE ${innerTable}.${innerCol} = ${outerCol}`;
  if (whereClause) {
    existsClause += ` AND ${whereClause}`;
  }
  existsClause += ')';

  const rewrittenSql = sql.replace(notInFullPattern, existsClause);

  return {
    rule_id: 'R4',
    rewrite_name: 'Replace NOT IN with NOT EXISTS',
    description: 'NOT IN replaced with NOT EXISTS — safer with NULLs and enables index use on join column',
    before_snippet: `NOT IN (SELECT ${innerCol} FROM ${innerTable})`,
    after_snippet: `NOT EXISTS (SELECT 1 FROM ${innerTable} WHERE ${innerTable}.${innerCol} = ...)`,
    estimated_carbon_reduction_pct: 30.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 5: Flatten Correlated Subquery in SELECT
// ====================================
function rewriteFlattenSelectSubquery(sql, firedRules, context = {}) {
  // Trigger: SELECT list contains scalar subquery referencing outer table
  // Pattern: SELECT col, (SELECT ... FROM t WHERE t.x = outer.x) ...
  const selectSubqueryPattern = /SELECT\s+[^F]*\(SELECT\s+[^)]+FROM\s+(\w+)\s+WHERE\s+\1\.(\w+)\s*=\s*(\w+)\.(\w+)\)/i;
  
  if (!selectSubqueryPattern.test(sql)) {
    return null; // No correlated subquery in SELECT
  }

  // This is complex; require explicit FROM table recognition
  return null; // Skip complex subquery rewrite — requires full parser
}

// ====================================
// REWRITE 6: Index Suggestion Comment
// ====================================
function rewriteIndexSuggestion(sql, firedRules, context = {}) {
  // Trigger: RC-001, RC-004, RC-011 fired
  const indexRules = firedRules.filter(r => ['RC-001', 'RC-004', 'RC-011'].includes(r.rule_id));
  if (indexRules.length === 0) {
    return null; // No index rule fired
  }

  // Extract table and column from first rule
  const rule = indexRules[0];
  const tableName = rule.affected_node?.relation_name || 'unknown_table';
  const suggestion = rule.fix_suggestion || `CREATE INDEX CONCURRENTLY idx_${tableName}_column ON ${tableName}(column);`;

  const rewrittenSql = `-- QUERYCARBON: ${suggestion}\n${sql}`;

  return {
    rule_id: 'R6',
    rewrite_name: 'Index Suggestion Comment',
    description: `${rule.rule_name} detected — index on filter/join column eliminates full table scan`,
    before_snippet: sql.substring(0, 50).replace(/\n/g, ' ') + '...',
    after_snippet: `-- QUERYCARBON: ${suggestion}\n${sql.substring(0, 40)}...`,
    estimated_carbon_reduction_pct: 70.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 7: Materialized View Template
// ====================================
function rewriteMaterializedViewTemplate(sql, firedRules, context = {}) {
  // Trigger: RC-063 (expensive aggregation)
  const rc063 = firedRules.find(r => r.rule_id === 'RC-063');
  if (!rc063) {
    return null; // Rule not fired
  }

  const hasAggregation = /GROUP\s+BY|SUM\s*\(|COUNT\s*\(|AVG\s*\(|MAX\s*\(|MIN\s*\(/i.test(sql);
  if (!hasAggregation) {
    return null; // No aggregation
  }

  const viewName = 'mv_optimized_view';
  const rewrittenSql = `-- QUERYCARBON: Expensive aggregation detected. Materialize this query to avoid recomputation.
-- CREATE MATERIALIZED VIEW ${viewName} AS
${sql}
-- REFRESH MATERIALIZED VIEW ${viewName};`;

  return {
    rule_id: 'R7',
    rewrite_name: 'Materialized View Template',
    description: 'Aggregation cost > 50000 — materializing pre-computes result, eliminating per-request CPU',
    before_snippet: sql.substring(0, 50).replace(/\n/g, ' ') + '...',
    after_snippet: `-- CREATE MATERIALIZED VIEW ${viewName} AS\n${sql.substring(0, 40)}...`,
    estimated_carbon_reduction_pct: 80.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 8: work_mem Suggestion for Disk Spill
// ====================================
function rewriteWorkMemSuggestion(sql, firedRules, context = {}) {
  // Trigger: Sort node with external merge/sort in EXPLAIN
  // This is detected in context.has_disk_spill
  if (!context.has_disk_spill) {
    return null; // No disk spill detected
  }

  const rewrittenSql = `-- QUERYCARBON: Disk-spilling sort detected. Run before query:
-- SET work_mem = '256MB';
${sql}`;

  return {
    rule_id: 'R8',
    rewrite_name: 'work_mem Suggestion for Disk Spill',
    description: 'Disk sort uses ~10x the energy of in-memory sort — increasing work_mem eliminates spill',
    before_snippet: 'ORDER BY... (external sort)',
    after_snippet: "-- SET work_mem = '256MB';\nSELECT ...",
    estimated_carbon_reduction_pct: 75.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 9: Count(*) to pg_class Lookup
// ====================================
function rewriteCountToReltuples(sql, firedRules, context = {}) {
  // Trigger: query is purely SELECT COUNT(*) FROM table (no WHERE)
  const countPattern = /^\s*SELECT\s+COUNT\s*\(\s*\*\s*\)\s+FROM\s+(\w+)\s*;?\s*$/i;
  const match = sql.match(countPattern);

  if (!match) {
    return null; // Not a simple count
  }

  const tableName = match[1];
  const rewrittenSql = `-- QUERYCARBON: Approximate count (exact requires full scan — use if exact not needed)
SELECT reltuples::bigint AS approximate_count FROM pg_class WHERE relname = '${tableName}';`;

  return {
    rule_id: 'R9',
    rewrite_name: 'COUNT(*) to pg_class Lookup',
    description: 'COUNT(*) full scan reads every tuple for a scalar — pg_class lookup is O(1)',
    before_snippet: `SELECT COUNT(*) FROM ${tableName}`,
    after_snippet: `SELECT reltuples::bigint FROM pg_class WHERE relname = '${tableName}'`,
    estimated_carbon_reduction_pct: 95.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 10: Covering Index Suggestion
// ====================================
function rewriteCoveringIndexSuggestion(sql, firedRules, context = {}) {
  // Trigger: RC-002 (high filter discard)
  const rc002 = firedRules.find(r => r.rule_id === 'RC-002');
  if (!rc002) {
    return null; // Rule not fired
  }

  const tableName = rc002.affected_node?.relation_name || 'unknown_table';
  const suggestion = `CREATE INDEX idx_${tableName}_covering ON ${tableName}(filter_col) INCLUDE (*, needed_cols);`;

  const rewrittenSql = `-- QUERYCARBON: High filter discard detected. Consider covering index:
-- ${suggestion}
${sql}`;

  return {
    rule_id: 'R10',
    rewrite_name: 'Covering Index Suggestion',
    description: 'Index fetches >50% discarded rows — covering index pre-filters and avoids heap fetch',
    before_snippet: `SELECT ... FROM ${tableName}`,
    after_snippet: `-- CREATE INDEX ... INCLUDE (...)\nSELECT ...`,
    estimated_carbon_reduction_pct: 50.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 11: Remove Redundant ORDER BY in Subquery
// ====================================
function rewriteRemoveRedundantOrderBy(sql, firedRules, context = {}) {
  // Trigger: ORDER BY inside subquery without LIMIT
  const subqueryOrderByPattern = /\(\s*SELECT[^)]*\bORDER\s+BY\s+[^)]*\)\s+(?!.*LIMIT)/i;
  
  if (!subqueryOrderByPattern.test(sql)) {
    return null; // No redundant ORDER BY in subquery
  }

  // Remove ORDER BY from inside parentheses subquery (simple case)
  let rewrittenSql = sql.replace(
    /(\(\s*SELECT[^O]*)\s+ORDER\s+BY\s+[^)]*(\s*\))/i,
    '$1$2'
  );

  if (rewrittenSql === sql) {
    return null; // Pattern didn't match exactly
  }

  return {
    rule_id: 'R11',
    rewrite_name: 'Remove Redundant ORDER BY in Subquery',
    description: 'ORDER BY in subquery without LIMIT is discarded by planner — removing saves O(N log N)',
    before_snippet: '(SELECT ... ORDER BY ...)',
    after_snippet: '(SELECT ...)',
    estimated_carbon_reduction_pct: 40.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 12: Replace IN (subquery) with EXISTS
// ====================================
function rewriteInToExists(sql, firedRules, context = {}) {
  // Trigger: query contains col IN (SELECT ...)
  const inPattern = /(\w+)\s+IN\s*\(\s*SELECT\s+(\w+)\s+FROM\s+(\w+)(?:\s+WHERE\s+([^)]+))?\)/i;
  const match = sql.match(inPattern);

  if (!match) {
    return null; // Pattern not found
  }

  const [, outerCol, innerCol, innerTable, whereClause] = match;
  
  let existsClause = `EXISTS (SELECT 1 FROM ${innerTable} WHERE ${innerTable}.${innerCol} = ${outerCol}`;
  if (whereClause) {
    existsClause += ` AND ${whereClause}`;
  }
  existsClause += ')';

  const rewrittenSql = sql.replace(inPattern, existsClause);

  return {
    rule_id: 'R12',
    rewrite_name: 'IN Subquery to EXISTS',
    description: 'IN subquery replaced with EXISTS — EXISTS short-circuits on first match, reducing I/O',
    before_snippet: `${outerCol} IN (SELECT ${innerCol} FROM ${innerTable})`,
    after_snippet: `EXISTS (SELECT 1 FROM ${innerTable} WHERE ...)`,
    estimated_carbon_reduction_pct: 30.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 13: Partial Index Suggestion
// ====================================
function rewritePartialIndexSuggestion(sql, firedRules, context = {}) {
  // Trigger: RC-001 with boolean/status equality condition
  const rc001 = firedRules.find(r => r.rule_id === 'RC-001');
  if (!rc001) {
    return null; // Rule not fired
  }

  // Check for equality on boolean or status columns
  const booleanPattern = /WHERE\s+(\w+)\s*=\s*(true|false|'pending'|'active'|'inactive')/i;
  const match = sql.match(booleanPattern);

  if (!match) {
    return null; // No low-cardinality filter
  }

  const columnName = match[1];
  const tableName = rc001.affected_node?.relation_name || 'table';
  const filterValue = match[2];

  const rewrittenSql = `-- QUERYCARBON: Partial index for low-cardinality filter:
-- CREATE INDEX idx_${tableName}_${columnName} ON ${tableName}(id) WHERE ${columnName} = ${filterValue};
${sql}`;

  return {
    rule_id: 'R13',
    rewrite_name: 'Partial Index Suggestion',
    description: 'Partial index covers only matching rows — fraction of full index size, faster scans',
    before_snippet: `WHERE ${columnName} = ${filterValue}`,
    after_snippet: `-- CREATE INDEX ... WHERE ${columnName} = ${filterValue};\nWHERE ...`,
    estimated_carbon_reduction_pct: 45.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 14: pg_cron Schedule Template
// ====================================
function rewritePgCronSchedule(sql, firedRules, context = {}) {
  // Trigger: RC-062 (long-running, expensive query)
  const rc062 = firedRules.find(r => r.rule_id === 'RC-062');
  if (!rc062) {
    return null; // Rule not fired
  }

  const rewrittenSql = `-- QUERYCARBON: Long-running query detected. Schedule off-peak to reduce carbon:
-- SELECT cron.schedule('querycarbon_offpeak', '0 2 * * *', $$
${sql}
-- $$);`;

  return {
    rule_id: 'R14',
    rewrite_name: 'pg_cron Schedule Template',
    description: 'Query runs during peak grid hours — off-peak scheduling reduces CO2 by up to 30%',
    before_snippet: sql.substring(0, 40).replace(/\n/g, ' ') + '...',
    after_snippet: "-- SELECT cron.schedule('querycarbon_offpeak', '0 2 * * *', $$\nSELECT ...",
    estimated_carbon_reduction_pct: 30.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 15: DISTINCT to GROUP BY
// ====================================
function rewriteDistinctToGroupBy(sql, firedRules, context = {}) {
  // Trigger: SELECT DISTINCT with Plan Rows > 10000
  const distinctPattern = /SELECT\s+DISTINCT\s+(.+?)\s+FROM/i;
  const match = sql.match(distinctPattern);

  if (!match || context.plan_rows <= 10000) {
    return null; // No DISTINCT or small result set
  }

  const columns = match[1];
  let rewrittenSql = sql.replace(
    /SELECT\s+DISTINCT\s+/i,
    'SELECT '
  );

  // Add GROUP BY clause before ORDER BY or at end
  const hasGroupBy = /GROUP\s+BY/i.test(rewrittenSql);
  if (hasGroupBy) {
    return null; // Already has GROUP BY
  }

  const orderByPattern = /(\s+ORDER\s+BY)/i;
  if (orderByPattern.test(rewrittenSql)) {
    rewrittenSql = rewrittenSql.replace(
      orderByPattern,
      ` GROUP BY ${columns}$1`
    );
  } else {
    rewrittenSql = rewrittenSql.trimEnd();
    if (!rewrittenSql.endsWith(';')) rewrittenSql += ';';
    rewrittenSql = rewrittenSql.replace(/;$/, '') + ` GROUP BY ${columns};`;
  }

  return {
    rule_id: 'R15',
    rewrite_name: 'DISTINCT to GROUP BY',
    description: 'DISTINCT replaced with GROUP BY — planner can use indexed GroupAggregate instead of Sort+Unique',
    before_snippet: `SELECT DISTINCT ${columns}`,
    after_snippet: `SELECT ${columns} GROUP BY ${columns}`,
    estimated_carbon_reduction_pct: 50.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 16: Disable Nested Loop for Large Sets
// ====================================
function rewriteDisableNestedLoop(sql, firedRules, context = {}) {
  // Trigger: RC-011 (large nested loop without inner index)
  const rc011 = firedRules.find(r => r.rule_id === 'RC-011');
  if (!rc011) {
    return null; // Rule not fired
  }

  const rewrittenSql = `-- QUERYCARBON: Large nested loop without inner index. Disable for Hash Join:
-- SET enable_nestloop = off; -- forces Hash Join
${sql}
-- SET enable_nestloop = on; -- re-enable after`;

  return {
    rule_id: 'R16',
    rewrite_name: 'Disable Nested Loop for Hash Join',
    description: 'Nested loop O(N×M) replaced with Hash Join O(N+M) — critical for large outer sets',
    before_snippet: 'JOIN without index',
    after_snippet: '-- SET enable_nestloop = off;\nJOIN ...',
    estimated_carbon_reduction_pct: 70.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 17: Extract Repeated Subquery to CTE
// ====================================
function rewriteExtractRepeatedSubquery(sql, firedRules, context = {}) {
  // Trigger: same subquery text appears more than once
  const subqueryPattern = /\(SELECT[^)]+\)/g;
  const subqueries = sql.match(subqueryPattern) || [];

  if (subqueries.length < 2) {
    return null; // Fewer than 2 subqueries
  }

  // Check for exact duplicates
  const uniqueSubqueries = new Set(subqueries);
  if (uniqueSubqueries.size === subqueries.length) {
    return null; // No duplicates
  }

  // Find the repeated subquery
  const counts = {};
  subqueries.forEach(sq => {
    counts[sq] = (counts[sq] || 0) + 1;
  });

  const repeatedSubquery = Object.keys(counts).find(sq => counts[sq] > 1);
  if (!repeatedSubquery) {
    return null;
  }

  const cteName = 'extracted_subquery';
  const rewrittenSql = `WITH ${cteName} AS ` + repeatedSubquery +
    '\n' + sql.replace(new RegExp(repeatedSubquery, 'g'), `SELECT * FROM ${cteName}`);

  return {
    rule_id: 'R17',
    rewrite_name: 'Extract Repeated Subquery to CTE',
    description: 'Repeated subquery extracted to CTE — subexpression computed once instead of twice',
    before_snippet: `... (SELECT ...) ... (SELECT ...)`,
    after_snippet: `WITH extracted_subquery AS (SELECT ...)\n...extracted_subquery...`,
    estimated_carbon_reduction_pct: 40.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 18: Push WHERE Inside UNION
// ====================================
function rewritePushWhereInsideUnion(sql, firedRules, context = {}) {
  // Trigger: UNION wrapped in subquery with WHERE on outside
  const unionSubqueryPattern = /\(\s*SELECT[\s\S]*?UNION[\s\S]*?\)\s+\w+\s+WHERE/i;

  if (!unionSubqueryPattern.test(sql)) {
    return null; // No UNION in subquery with WHERE
  }

  // This is complex; skip unless pattern is very clear
  return null; // Requires full parser
}

// ====================================
// REWRITE 19: UNION to UNION ALL
// ====================================
function rewriteUnionToUnionAll(sql, firedRules, context = {}) {
  // Trigger: UNION (not UNION ALL) on different tables
  const unionPattern = /\bUNION\s+SELECT/i;
  if (!unionPattern.test(sql) || /UNION\s+ALL/i.test(sql)) {
    return null; // No UNION or already UNION ALL
  }

  // Check if branches query different tables
  const fromClauses = sql.match(/FROM\s+(\w+)/gi) || [];
  const tables = new Set(fromClauses.map(f => f.replace(/FROM\s+/i, '').toLowerCase()));

  if (tables.size < 2) {
    return null; // Same table in both branches
  }

  const rewrittenSql = sql.replace(
    /\bUNION\s+SELECT/gi,
    'UNION ALL SELECT'
  );

  // Add comment about assumption
  const withComment = `-- QUERYCARBON: UNION deduplicates with expensive Sort+Unique. Using UNION ALL\n-- if duplicates impossible across different tables.\n${rewrittenSql}`;

  return {
    rule_id: 'R19',
    rewrite_name: 'UNION to UNION ALL',
    description: 'UNION replaced with UNION ALL — eliminates O(N log N) deduplication sort',
    before_snippet: 'UNION SELECT',
    after_snippet: 'UNION ALL SELECT',
    estimated_carbon_reduction_pct: 55.0,
    applied: true,
    rewritten_sql: withComment,
  };
}

// ====================================
// REWRITE 20: VACUUM ANALYZE Suggestion
// ====================================
function rewriteVacuumAnalyzeSuggestion(sql, firedRules, context = {}) {
  // Trigger: RC-073 (plan/actual ratio > 5)
  const rc073 = firedRules.find(r => r.rule_id === 'RC-073');
  if (!rc073) {
    return null; // Rule not fired
  }

  const tableName = rc073.affected_node?.relation_name || 'table';
  const rewrittenSql = `-- QUERYCARBON: Stale statistics or bloat on ${tableName} (plan/actual > 5)
-- Run: VACUUM ANALYZE ${tableName};
${sql}`;

  return {
    rule_id: 'R20',
    rewrite_name: 'VACUUM ANALYZE Suggestion',
    description: 'Bloat causes planner to over-estimate rows — VACUUM restores accuracy',
    before_snippet: `SELECT ... FROM ${tableName}`,
    after_snippet: `-- VACUUM ANALYZE ${tableName};\nSELECT ...`,
    estimated_carbon_reduction_pct: 40.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 21: Implicit Cross Join to Explicit JOIN
// ====================================
function rewriteImplicitCrossJoin(sql, firedRules, context = {}) {
  // Trigger: FROM a, b WHERE a.id = b.a_id (old implicit join syntax)
  const implicitJoinPattern = /FROM\s+(\w+)\s*,\s*(\w+)\s+WHERE\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/i;
  const match = sql.match(implicitJoinPattern);

  if (!match) {
    return null; // No implicit join found
  }

  const [, table1, table2, joinTable1, joinCol1, joinTable2, joinCol2] = match;
  
  let rewrittenSql = sql.replace(
    implicitJoinPattern,
    `FROM ${table1} INNER JOIN ${table2} ON ${joinTable2}.${joinCol2} = ${joinTable1}.${joinCol1} WHERE`
  );

  return {
    rule_id: 'R21',
    rewrite_name: 'Implicit Cross Join to Explicit JOIN',
    description: 'Implicit cross join rewritten as explicit INNER JOIN — planner optimizes explicit joins better',
    before_snippet: `FROM ${table1}, ${table2} WHERE ...`,
    after_snippet: `FROM ${table1} INNER JOIN ${table2} ON ...`,
    estimated_carbon_reduction_pct: 35.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// REWRITE 22: Prepared Statement Template
// ====================================
function rewritePreparedStatementTemplate(sql, firedRules, context = {}) {
  // Trigger: RC-066 (high SCI + repeated execution)
  const rc066 = firedRules.find(r => r.rule_id === 'RC-066');
  if (!rc066) {
    return null; // Rule not fired
  }

  // Extract literal values and replace with placeholders
  let paramCount = 1;
  let templateSql = sql;
  const literals = [];

  // Simple literal replacement (numbers and quoted strings)
  const literalPattern = /(\d+|'[^']*')/g;
  let match;
  while ((match = literalPattern.exec(sql)) !== null) {
    literals.push(match[0]);
    templateSql = templateSql.replace(match[0], `$${paramCount}`, 1);
    paramCount++;
  }

  if (literals.length === 0) {
    return null; // No literals found
  }

  const paramTypes = literals.map(() => 'TYPE').join(', '); // Simplified
  const rewrittenSql = `-- QUERYCARBON: High SCI + repeated execution. Use prepared statement:
-- PREPARE stmt(${paramTypes}) AS
--   ${templateSql};
-- EXECUTE stmt(${literals.join(', ')});
${sql}`;

  return {
    rule_id: 'R22',
    rewrite_name: 'Prepared Statement Template',
    description: 'Prepared statement eliminates parse+plan overhead — saves CPU per call',
    before_snippet: sql.substring(0, 40).replace(/\n/g, ' ') + '...',
    after_snippet: '-- PREPARE stmt(...) AS\n--   SELECT ...',
    estimated_carbon_reduction_pct: 25.0,
    applied: true,
    rewritten_sql: rewrittenSql,
  };
}

// ====================================
// MAIN REWRITER FUNCTION
// ====================================
/**
 * Apply all safe rewrites to SQL in prescribed order
 * 
 * @param {string} sql - Original SQL query
 * @param {Array} firedRules - Array of rule violations from index rule engine
 * @param {object} explainPlan - PostgreSQL EXPLAIN JSON plan root node
 * @param {object} context - Performance context { rows_returned, plan_rows, has_disk_spill, grid_intensity, ... }
 * @returns {object} Structured rewrite response with original/optimized SQL, snippets, and metadata
 */
function rewriteQuery(sql, firedRules = [], explainPlan = null, context = {}) {
  if (!sql || typeof sql !== 'string') {
    return {
      original_sql: sql,
      optimized_sql: sql,
      was_rewritten: false,
      rewrites_applied: [],
      total_rewrites: 0,
      optimization_notes: 'Invalid SQL provided',
    };
  }

  const applied = [];

  // PHASE 1: Index Suggestions (comments only, safe to apply first)
  const rewritePhase1 = [
    { fn: rewriteIndexSuggestion, name: 'R6' },
    { fn: rewriteCoveringIndexSuggestion, name: 'R10' },
    { fn: rewritePartialIndexSuggestion, name: 'R13' },
  ];

  // PHASE 2: Structural Rewrites (safe but require pattern matching)
  const rewritePhase2 = [
    { fn: rewriteNotInToNotExists, name: 'R4' },
    // { fn: rewriteFlattenSelectSubquery, name: 'R5' }, // Too complex
    { fn: rewriteInToExists, name: 'R12' },
    { fn: rewriteImplicitCrossJoin, name: 'R21' },
  ];

  // PHASE 3: Expensive Operations (comments with operational suggestions)
  const rewritePhase3 = [
    { fn: rewriteMaterializedViewTemplate, name: 'R7' },
    { fn: rewriteWorkMemSuggestion, name: 'R8' },
    { fn: rewritePgCronSchedule, name: 'R14' },
    { fn: rewriteDisableNestedLoop, name: 'R16' },
    { fn: rewritePreparedStatementTemplate, name: 'R22' },
  ];

  // PHASE 4: LIMIT/OFFSET/Stats (changes query structure)
  const rewritePhase4 = [
    { fn: rewriteAddMissingLimit, name: 'R1' },
    { fn: rewriteOffsetToKeyset, name: 'R3' },
    { fn: rewriteVacuumAnalyzeSuggestion, name: 'R20' },
  ];

  // PHASE 5: SELECT * (important, safe)
  const rewritePhase5 = [
    { fn: rewriteSelectStar, name: 'R2' },
  ];

  // PHASE 6: Other Optimizations (independent)
  const rewritePhase6 = [
    { fn: rewriteCountToReltuples, name: 'R9' },
    { fn: rewriteRemoveRedundantOrderBy, name: 'R11' },
    { fn: rewriteDistinctToGroupBy, name: 'R15' },
    { fn: rewriteExtractRepeatedSubquery, name: 'R17' },
    // { fn: rewritePushWhereInsideUnion, name: 'R18' }, // Too complex
    { fn: rewriteUnionToUnionAll, name: 'R19' },
  ];

  const allPhases = [rewritePhase1, rewritePhase2, rewritePhase3, rewritePhase4, rewritePhase5, rewritePhase6];
  
  let currentSql = sql;

  for (const phase of allPhases) {
    for (const { fn, name } of phase) {
      const result = fn(currentSql, firedRules, context);
      if (result && result.applied) {
        applied.push(result);
        
        // Update SQL for next rewrite with the actual rewritten version
        if (result.rewritten_sql && result.rewritten_sql !== currentSql) {
          currentSql = result.rewritten_sql;
        }
      }
    }
  }

  // Build optimization notes
  let notes = '';
  
  // Add heuristic suggestions based on performance metrics
  const suggestions = [];
  const sci = context.sci_score || 0;
  const runtime = context.runtime_ms || 0;
  const rowsReturned = context.rows_returned || 0;
  
  // Suggest optimizations based on severity
  if (sci > 50) {
    suggestions.push('High SCI detected — consider adding database indexes on filter/join columns');
  }
  if (runtime > 5000) {
    suggestions.push('Slow query (>5s) — check for missing indexes, n+1 queries, or expensive aggregations');
  }
  if (rowsReturned > 100000) {
    suggestions.push('Large result set (>100k rows) — add LIMIT clause and consider pagination/streaming');
  }
  if (rowsReturned === 0 && runtime > 100) {
    suggestions.push('Empty result set despite slow execution — optimize WHERE conditions or verify indexes exist');
  }
  
  // Check for general optimization opportunities
  const lowerSql = sql.toLowerCase();
  if (lowerSql.includes('select *')) {
    suggestions.push('Query uses SELECT * — specify only needed columns to reduce I/O and network traffic');
  }
  if (lowerSql.match(/\boffset\s+\d+/)) {
    suggestions.push('OFFSET clause found — use keyset pagination for large offsets to avoid scanning discarded rows');
  }
  if (lowerSql.includes('union ') && !lowerSql.includes('union all')) {
    suggestions.push('UNION without ALL causes deduplication overhead — use UNION ALL if duplicates impossible');
  }
  
  if (applied.length === 0) {
    if (suggestions.length > 0) {
      notes = `No automatic rewrites applied, but ${suggestions.length} optimization opportunity(ies) detected:\n`;
      suggestions.forEach((s, idx) => {
        notes += `\n${idx + 1}. ${s}`;
      });
      notes += '\n\nNote: These suggestions require manual review before applying.';
    } else {
      notes = 'Query structure looks good — no obvious optimization patterns detected.';
      if (sci > 25 || runtime > 1000) {
        notes += '\nHowever, the query is expensive. Run EXPLAIN ANALYZE to identify bottlenecks:\n';
        if (sci > 50) notes += '• Check for missing indexes on WHERE conditions\n';
        if (runtime > 5000) notes += '• Look for sequential table scans or nested loops\n';
        notes += '• Consider caching results or scheduling off-peak';
      }
    }
  } else {
    notes = `Applied ${applied.length} rewrite(s) in order:\n`;
    applied.forEach((r, idx) => {
      notes += `\n${idx + 1}. **${r.rewrite_name}** (${r.rule_id}): ${r.description}`;
      notes += `\n   Carbon reduction: ~${r.estimated_carbon_reduction_pct}%`;
    });
    
    const totalReduction = Math.min(95, applied.reduce((sum, r) => sum + r.estimated_carbon_reduction_pct, 0));
    notes += `\n\nTotal estimated carbon reduction: ~${totalReduction}% (conservative, rewrites may overlap in benefits).`;
    
    if (suggestions.length > 0) {
      notes += `\n\nAdditional optimization opportunities:\n`;
      suggestions.forEach((s, idx) => {
        notes += `${idx + 1}. ${s}\n`;
      });
    }
  }

  return {
    original_sql: sql,
    optimized_sql: currentSql !== sql ? currentSql : sql,
    was_rewritten: applied.length > 0 || suggestions.length > 0,
    rewrites_applied: applied,
    total_rewrites: applied.length,
    optimization_notes: notes,
  };
}

// ====================================
// EXPORTS
// ====================================
module.exports = {
  rewriteQuery,
};
