const { extractTables, combineImprovements } = require('./carbonCalculator');

const DEFAULT_ROW_THRESHOLD = 10000;
const DEFAULT_LARGE_TABLE_ROWS = 1000000;
const DEFAULT_RUNTIME_MS = 1000;

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function splitTopLevelComma(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const previous = text[i - 1];

    if (char === "'" && previous !== '\\' && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && previous !== '\\' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble) {
      if (char === '(') depth += 1;
      if (char === ')' && depth > 0) depth -= 1;
      if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function uniquePush(target, value) {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}

function parseTableRefs(sql) {
  const refs = [];
  const clauseRegex = /\b(FROM|JOIN)\s+([a-zA-Z_][\w$]*)(?:\.([a-zA-Z_][\w$]*))?(?:\s+(?:AS\s+)?([a-zA-Z_][\w$]*))?/gi;
  let match;

  while ((match = clauseRegex.exec(sql)) !== null) {
    const schema = match[3] ? match[2] : 'public';
    const table = match[3] ? match[3] : match[2];
    const alias = match[4] || table;
    refs.push({ schema, table, alias, fullName: `${schema}.${table}`.toLowerCase() });
  }

  return refs;
}

function parseSelectColumns(sql) {
  const match = sql.match(/\bSELECT\s+(DISTINCT\s+)?([\s\S]+?)\s+\bFROM\b/i);
  if (!match) return [];

  const rawColumns = splitTopLevelComma(match[2].replace(/^DISTINCT\s+/i, ''));
  return rawColumns.map(column => column.trim()).filter(Boolean);
}

function parseGroupByColumns(sql) {
  const match = sql.match(/\bGROUP\s+BY\s+([\s\S]+?)(?:\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|;|$)/i);
  if (!match) return [];
  return splitTopLevelComma(match[1]).map(column => column.trim()).filter(Boolean);
}

function parseOrderByColumns(sql) {
  const match = sql.match(/\bORDER\s+BY\s+([\s\S]+?)(?:\bLIMIT\b|\bOFFSET\b|;|$)/i);
  if (!match) return [];
  return splitTopLevelComma(match[1]).map(column => column.trim()).filter(Boolean);
}

function parseWhereClause(sql) {
  const match = sql.match(/\bWHERE\s+([\s\S]+?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|;|$)/i);
  return match ? match[1].trim() : '';
}

function parseJoinConditions(sql) {
  const joins = [];
  const joinRegex = /\bJOIN\s+[a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?(?:\s+(?:AS\s+)?[a-zA-Z_][\w$]*)?\s+ON\s+([\s\S]+?)(?=\bJOIN\b|\bWHERE\b|\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|;|$)/gi;
  let match;
  while ((match = joinRegex.exec(sql)) !== null) {
    joins.push(match[1].trim());
  }
  return joins;
}

function getTableMetadataMap(tableMetadata = {}) {
  const map = new Map();
  Object.entries(tableMetadata || {}).forEach(([key, value]) => {
    map.set(key.toLowerCase(), value);
  });
  return map;
}

function parseColumnReference(expression) {
  const cleaned = String(expression || '').trim();
  const referenceMatch = cleaned.match(/^([a-zA-Z_][\w$]*)\.([a-zA-Z_][\w$]*)$/);
  if (referenceMatch) {
    return { alias: referenceMatch[1], column: referenceMatch[2] };
  }
  const bareMatch = cleaned.match(/^([a-zA-Z_][\w$]*)$/);
  if (bareMatch) {
    return { alias: null, column: bareMatch[1] };
  }
  return null;
}

function literalType(literal) {
  const value = String(literal || '').trim();
  if (/^'.*'$/.test(value)) return 'text';
  if (/^(true|false)$/i.test(value)) return 'boolean';
  if (/^-?\d+$/.test(value)) return 'integer';
  if (/^-?\d+\.\d+$/.test(value)) return 'numeric';
  if (/^NULL$/i.test(value)) return 'null';
  return 'text';
}

function columnTypeCategory(dataType) {
  const value = String(dataType || '').toLowerCase();
  if (value.includes('int') || value.includes('numeric') || value.includes('decimal') || value.includes('double') || value.includes('real')) {
    return 'numeric';
  }
  if (value.includes('bool')) return 'boolean';
  if (value.includes('date') || value.includes('time')) return 'temporal';
  return 'text';
}

function extractIndexedColumns(indexDefinition) {
  const match = String(indexDefinition || '').match(/\(([^\)]+)\)(?:\s+INCLUDE\s+\(([^\)]+)\))?/i);
  if (!match) return { keyColumns: [], includeColumns: [] };
  return {
    keyColumns: splitTopLevelComma(match[1]).map(part => part.replace(/\bASC\b|\bDESC\b|\bNULLS\s+(FIRST|LAST)\b/gi, '').trim().replace(/"/g, '')),
    includeColumns: match[2] ? splitTopLevelComma(match[2]).map(part => part.trim().replace(/"/g, '')) : [],
  };
}

function hasMatchingIndex(tableInfo, columns) {
  if (!tableInfo || !Array.isArray(tableInfo.indexes)) return false;

  const desired = columns.map(column => String(column).toLowerCase());
  return tableInfo.indexes.some(index => {
    const parsed = extractIndexedColumns(index.definition);
    const keyColumns = parsed.keyColumns.map(column => String(column).toLowerCase());
    if (keyColumns.length < desired.length) return false;
    return desired.every((column, indexPosition) => keyColumns[indexPosition] === column);
  });
}

function tableRowsLarge(tableInfo) {
  return Number(tableInfo?.estimated_rows || 0) >= DEFAULT_LARGE_TABLE_ROWS;
}

function aliasToTable(tableRefs) {
  const map = new Map();
  tableRefs.forEach(ref => {
    map.set(ref.alias.toLowerCase(), ref);
    map.set(ref.table.toLowerCase(), ref);
    map.set(`${ref.schema}.${ref.table}`.toLowerCase(), ref);
  });
  return map;
}

function findTableInfo(ref, metadataMap) {
  if (!ref) return null;
  const keys = [
    `${ref.schema}.${ref.table}`.toLowerCase(),
    ref.table.toLowerCase(),
    `${ref.schema}.${ref.table}`,
  ];

  for (const key of keys) {
    if (metadataMap.has(key)) {
      return metadataMap.get(key);
    }
  }
  return null;
}

function findColumnInfo(tableInfo, columnName) {
  if (!tableInfo || !Array.isArray(tableInfo.columns)) return null;
  const lower = String(columnName || '').toLowerCase();
  return tableInfo.columns.find(column => String(column.name || '').toLowerCase() === lower) || null;
}

function extractComparisonPairs(whereClause) {
  const pairs = [];
  const patterns = [
    /([a-zA-Z_][\w$]*\.[a-zA-Z_][\w$]*)\s*(=|<>|!=|>=|<=|>|<|LIKE|ILIKE)\s*([^\s)]+(?:\s+[^\s)]+)?)/gi,
    /([a-zA-Z_][\w$]*)\s*(=|<>|!=|>=|<=|>|<|LIKE|ILIKE)\s*([^\s)]+(?:\s+[^\s)]+)?)/gi,
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(whereClause)) !== null) {
      pairs.push({ left: match[1], operator: match[2].toUpperCase(), right: match[3].trim() });
    }
  });

  return pairs;
}

function issue(issue, why, rule, fix) {
  return {
    issue,
    why_inefficient: why,
    rule_violated: rule,
    fix,
  };
}

function problem(problemText, why, fix) {
  return {
    problem: problemText,
    why_it_happens: why,
    fix,
  };
}

function buildRuleBasedIssues({ sql, tables, tableMetadata }) {
  const issues = [];
  const normalized = normalizeSql(sql);
  const lower = normalized.toLowerCase();
  const selectColumns = parseSelectColumns(sql);
  const whereClause = parseWhereClause(sql);
  const groupByColumns = parseGroupByColumns(sql);
  const orderByColumns = parseOrderByColumns(sql);
  const joinClauses = parseJoinConditions(sql);
  const tableRefs = parseTableRefs(sql);
  const aliasMap = aliasToTable(tableRefs);
  const metadataMap = getTableMetadataMap(tableMetadata);

  if (/select\s+\*/i.test(sql)) {
    issues.push(issue(
      'Avoid SELECT *',
      'It reads every projected column, increasing heap I/O, memory, and network payload.',
      'Avoid SELECT *',
      'Select only the columns the caller actually needs.'
    ));
  }

  const projectedColumns = selectColumns.filter(column => !/^distinct\b/i.test(column) && !/^count\s*\(/i.test(column) && !/^sum\s*\(/i.test(column));
  if (projectedColumns.length >= 4) {
    const usedColumns = new Set();
    [...whereClause.matchAll(/([a-zA-Z_][\w$]*\.[a-zA-Z_][\w$]*)/g)].forEach(match => usedColumns.add(match[1].toLowerCase()));
    [...orderByColumns, ...groupByColumns].forEach(column => usedColumns.add(column.toLowerCase()));

    const unused = projectedColumns.filter(column => {
      const ref = parseColumnReference(column);
      if (!ref) return false;
      return !usedColumns.has(ref.column.toLowerCase()) && !usedColumns.has(`${ref.alias || ''}.${ref.column}`.toLowerCase());
    });

    if (unused.length > 0) {
      issues.push(issue(
        'Detect unused columns in SELECT',
        'Columns selected but never used in filters, grouping, or ordering still cost I/O and transfer bandwidth.',
        'Detect unused columns in SELECT',
        `Remove unused projected columns: ${unused.join(', ')}.`
      ));
    }
  }

  const notInMatch = sql.match(/\bNOT\s+IN\s*\(\s*SELECT\s+([a-zA-Z_][\w$]*)\s+FROM\s+([a-zA-Z_][\w$]*)(?:\s+WHERE\s+[^\)]*)?\)/i);
  if (notInMatch) {
    issues.push(issue(
      'Detect NOT IN',
      'NOT IN can mis-handle NULLs and prevents early short-circuiting in many plans.',
      'Detect NOT IN (suggest NOT EXISTS)',
      'Rewrite the predicate to NOT EXISTS with a correlated join condition.'
    ));
  }

  if (/\bSELECT\s+[^;]*\(\s*SELECT\b/i.test(sql) || /\bFROM\s*\(\s*SELECT\b/i.test(sql)) {
    issues.push(issue(
      'Detect unnecessary subqueries',
      'Nested subqueries often force repeated execution or block join reordering.',
      'Detect unnecessary subqueries (replace with JOIN / CTE)',
      'Flatten the subquery into a JOIN or factor repeated logic into a CTE.'
    ));
  }

  if (/\bSELECT\s+[^;]*\bSELECT\s+[^;]*\bSELECT\b/i.test(sql) || (sql.match(/\bSELECT\b/gi) || []).length >= 3) {
    issues.push(issue(
      'Detect N+1 query patterns',
      'Repeated dependent lookups often indicate row-by-row access instead of set-based processing.',
      'Detect N+1 query patterns',
      'Replace repeated lookups with a single JOIN or batched CTE-driven query.'
    ));
  }

  if (/\bFROM\s+[^\s,]+\s*,\s*[^\s,]+/i.test(sql) && !/\bJOIN\b/i.test(sql)) {
    issues.push(issue(
      'Detect Cartesian products',
      'A comma-separated FROM without a join predicate multiplies rows across both tables.',
      'Detect Cartesian products (missing JOIN condition)',
      'Rewrite to an explicit JOIN with an equality predicate.'
    ));
  }

  if (/\bSELECT\s+DISTINCT\b/i.test(sql)) {
    issues.push(issue(
      'Detect unnecessary DISTINCT',
      'DISTINCT forces deduplication, usually via sort or hash aggregation, which is expensive on large sets.',
      'Detect unnecessary DISTINCT',
      'Remove DISTINCT if the query is already unique by key or use GROUP BY only when aggregation is required.'
    ));
  }

  if (/\bSELECT\s+DISTINCT\b/i.test(sql) && /\bGROUP\s+BY\b/i.test(sql)) {
    issues.push(issue(
      'Detect redundant DISTINCT with GROUP BY',
      'GROUP BY already performs grouping; adding DISTINCT after that repeats deduplication work.',
      'Detect redundant DISTINCT with GROUP BY',
      'Remove DISTINCT when the grouped columns already guarantee uniqueness.'
    ));
  }

  if (/\bHAVING\b/i.test(sql) && !/\bGROUP\s+BY\b/i.test(sql)) {
    issues.push(issue(
      'Detect HAVING without GROUP BY',
      'HAVING without GROUP BY usually forces aggregation work where a normal WHERE filter would be cheaper.',
      'Detect HAVING without GROUP BY',
      'Move the predicate to WHERE unless it truly filters aggregated results.'
    ));
  }

  if (/\bJOIN\b[\s\S]*\b(?:LOWER|UPPER|DATE|CAST|COALESCE|TRIM|SUBSTRING)\s*\(/i.test(sql)) {
    issues.push(issue(
      'Detect functions in JOIN predicates',
      'Applying a function inside a join condition blocks index use on the join key and can force a scan or hash build.',
      'Detect functions in JOIN predicates',
      'Rewrite the join to compare raw keys or use an indexed generated expression.'
    ));
  }

  if (/\bUNION\b/i.test(sql) && !/\bUNION\s+ALL\b/i.test(sql)) {
    issues.push(issue(
      'Detect UNION without ALL',
      'UNION deduplicates rows and usually introduces a sort or hash step across the full result set.',
      'Detect UNION without ALL',
      'Use UNION ALL when duplicate elimination is not required.'
    ));
  }

  if (/\bORDER\s+BY\b/i.test(sql) && /\bGROUP\s+BY\b/i.test(sql) && !/\bLIMIT\b/i.test(sql)) {
    const orderColumns = orderByColumns.map(column => column.replace(/\s+(ASC|DESC)$/i, '').trim().toLowerCase());
    const groupColumns = groupByColumns.map(column => column.replace(/\s+(ASC|DESC)$/i, '').trim().toLowerCase());
    const sameOrderAndGroup = orderColumns.length > 0 && groupColumns.length > 0 && orderColumns.every(column => groupColumns.includes(column));
    if (sameOrderAndGroup) {
      issues.push(issue(
        'Detect redundant ORDER BY / GROUP BY',
        'Sorting grouped rows again adds work without changing the grouped result shape.',
        'Detect redundant ORDER BY / GROUP BY',
        'Remove the redundant ORDER BY when grouped output order is not required.'
      ));
    }
  }

  if (/\bOR\b/i.test(sql) && /\bWHERE\b/i.test(sql)) {
    issues.push(issue(
      'Detect OR conditions that can be rewritten as UNION',
      'Disjunctive predicates often disable index usage across multiple columns.',
      'Detect OR conditions that can be rewritten as UNION',
      'Split selective OR branches into UNION ALL branches when duplicates cannot occur.'
    ));
  }

  if (/\bOFFSET\s+\d{3,}\b/i.test(sql)) {
    issues.push(issue(
      'Detect large OFFSET pagination',
      'Large OFFSET values force the database to read and discard rows before returning the page.',
      'Detect large OFFSET pagination (suggest keyset pagination)',
      'Use keyset pagination with a stable sort key instead of large OFFSET scans.'
    ));
  }

  if (/\b(IN|EXISTS)\s*\(\s*SELECT\b/i.test(sql)) {
    issues.push(issue(
      'Detect repeated calculations',
      'The same subquery or expression often gets recomputed instead of being materialized once.',
      'Detect repeated calculations (suggest CTE)',
      'Factor repeated logic into a CTE so it is evaluated once.'
    ));
  }

  if (/\b(?:LOWER|UPPER|DATE|CAST|COALESCE|TRIM|SUBSTRING)\s*\(/i.test(sql) || /::[a-z_][\w]*/i.test(sql)) {
    issues.push(issue(
      'Detect functions on indexed columns',
      'Wrapping a column in a function usually blocks index range usage and causes a scan.',
      'Detect functions on indexed columns (non-sargable)',
      'Move the function to the constant side or add a computed/indexed expression that preserves sargability.'
    ));
  }

  if (/LIKE\s+'%[^']*'/i.test(sql) || /ILIKE\s+'%[^']*'/i.test(sql)) {
    issues.push(issue(
      'Detect leading wildcard LIKE',
      'A leading wildcard prevents a normal B-tree index from seeking a prefix range.',
      "Detect leading wildcard LIKE '%x'",
      'Use a prefix search, a trigram index, or a search-specific structure instead of a leading wildcard.'
    ));
  }

  const functionOnColumn = sql.match(/\b(?:LOWER|UPPER|DATE|CAST|COALESCE|TRIM|SUBSTRING)\s*\(\s*([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)\s*\)/i);
  if (functionOnColumn) {
    issues.push(issue(
      'Detect non-sargable predicates',
      'Applying a function to the column side blocks index seeks and turns the predicate into a scan filter.',
      'Detect non-sargable predicates',
      `Rewrite the predicate so ${functionOnColumn[1]} can be compared directly or indexed as an expression.`
    ));
  }

  const joinMatches = [...sql.matchAll(/\bJOIN\s+([a-zA-Z_][\w$.]*)\s+(?:AS\s+)?([a-zA-Z_][\w$]*)?\s*ON\s+([\s\S]+?)(?=\bJOIN\b|\bWHERE\b|\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|;|$)/gi)];
  if (joinMatches.length > 0) {
    const joinConditions = joinMatches.flatMap(match => extractComparisonPairs(match[3]));
    if (joinConditions.length === 0) {
      issues.push(issue(
        'Detect missing indexes on JOIN / WHERE / ORDER BY / GROUP BY',
        'Join and filter columns without indexes usually trigger sequential scans, hash builds, or sort spills.',
        'Detect missing indexes on JOIN / WHERE / ORDER BY / GROUP BY',
        'Add indexes on the join and filter columns that appear in the ON, WHERE, ORDER BY, or GROUP BY clauses.'
      ));
    }
  }

  const comparisonPairs = extractComparisonPairs(whereClause);
  comparisonPairs.forEach(pair => {
    const columnRef = parseColumnReference(pair.left);
    if (!columnRef) return;

    const refTable = aliasMap.get((columnRef.alias || columnRef.column).toLowerCase()) || null;
    const tableInfo = findTableInfo(refTable, metadataMap);
    const columnInfo = findColumnInfo(tableInfo, columnRef.column);
    if (!columnInfo) return;

    const rightType = literalType(pair.right);
    const columnType = columnTypeCategory(columnInfo.data_type);

    if (rightType !== 'text' && columnType === 'text' && /\b\d+\b/.test(pair.right)) {
      issues.push(issue(
        'Detect data type mismatch in joins/filters',
        'Implicit casts on the column side can stop the optimizer from using an index effectively.',
        'Detect data type mismatch in joins/filters',
        `Compare ${columnRef.column} using the same type as ${columnInfo.data_type}.`
      ));
    }

    if (rightType === 'text' && ['numeric', 'boolean', 'temporal'].includes(columnType)) {
      issues.push(issue(
        'Detect data type mismatch in joins/filters',
        'A quoted literal against a typed column can introduce an implicit cast and a scan filter.',
        'Detect data type mismatch in joins/filters',
        `Bind ${columnRef.column} with a ${columnInfo.data_type} value instead of a string literal.`
      ));
    }
  });

  if (issues.length === 0) {
    issues.push(issue(
      'No rule-based issues detected',
      'The SQL text does not match the enforced anti-pattern rules.',
      'N/A',
      'Keep the current shape and rely on the execution-plan and schema sections for further tuning.'
    ));
  }

  return issues;
}

function collectPlanNodes(planNode, accumulator = []) {
  if (!planNode || typeof planNode !== 'object') return accumulator;
  accumulator.push(planNode);
  if (Array.isArray(planNode.Plans)) {
    planNode.Plans.forEach(child => collectPlanNodes(child, accumulator));
  }
  return accumulator;
}

function buildExecutionPlanIssues(planNode, context = {}) {
  const issues = [];
  const nodes = collectPlanNodes(planNode, []);

  nodes.forEach(node => {
    const nodeType = node.NodeType || 'Unknown';
    const planRows = Number(node['Plan Rows'] || 0);
    const actualRows = Number(node['Actual Rows'] || 0);

    if (nodeType === 'Seq Scan' && planRows >= DEFAULT_ROW_THRESHOLD) {
      issues.push(problem(
        'Sequential scan on large table',
        'The planner is reading the table linearly because no selective access path is available.',
        'Create an index on the filter columns or rewrite the predicate so the scan becomes indexable.'
      ));
    }

    if (nodeType === 'Nested Loop' && Array.isArray(node.Plans) && node.Plans.length >= 2) {
      const outerRows = Number(node.Plans[0]['Plan Rows'] || 0);
      const innerRows = Number(node.Plans[1]['Plan Rows'] || 0);
      if (outerRows * innerRows >= 1000000) {
        issues.push(problem(
          'Nested loop on large dataset',
          'Nested loops repeatedly probe the inner side for each outer row, which is expensive when both sides are large.',
          'Add an index on the inner join key or force a hash/merge join with better join-key support.'
        ));
      }
    }

    if ((nodeType === 'Hash Join' || nodeType === 'Merge Join') && planRows >= DEFAULT_ROW_THRESHOLD) {
      issues.push(problem(
        `High-cost ${nodeType}`,
        'The join strategy indicates the planner expects a large input set and is paying a substantial per-row processing cost.',
        'Reduce the input set earlier with selective predicates and indexes on join keys.'
      ));
    }

    if (nodeType === 'Sort' && planRows >= DEFAULT_ROW_THRESHOLD) {
      issues.push(problem(
        'Large sort operation',
        'Sorting a large row set consumes memory and can spill to disk when work_mem is too small.',
        'Add an index that matches the ORDER BY clause or increase work_mem for the session.'
      ));
    }

    if ((nodeType === 'Seq Scan' || nodeType === 'Bitmap Heap Scan') && node.Filter && planRows >= DEFAULT_ROW_THRESHOLD) {
      issues.push(problem(
        'Filter applied after scan instead of before',
        'Rows are being read first and discarded later, which means the filter is not being satisfied by an index or join order.',
        'Add the appropriate index or restructure the predicate so the filter can be applied earlier.'
      ));
    }

    if (actualRows > 0 && planRows > actualRows * 10) {
      issues.push(problem(
        'Planner row estimate is highly skewed',
        'A large estimate error usually means statistics are stale or the distribution is skewed.',
        'Run ANALYZE on the table and consider extended statistics or a better composite index.'
      ));
    }
  });

  if (issues.length === 0) {
    issues.push(problem(
      'No major execution-plan issue detected',
      'The available plan does not show a dominant scan, join, or spill problem.',
      'Keep the current plan shape and focus on schema-level tuning if the workload is still slow.'
    ));
  }

  return issues;
}

function parseConditions(sql) {
  const whereClause = parseWhereClause(sql);
  const conditions = [];
  const equalityPattern = /([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)\s*=\s*([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?|'.*?'|\d+(?:\.\d+)?|true|false)/gi;
  let match;
  while ((match = equalityPattern.exec(whereClause)) !== null) {
    conditions.push({ left: match[1], right: match[2] });
  }
  return conditions;
}

function buildIndexRecommendation(tableRef, columns, metadataMap, includeColumns = []) {
  const descriptor = tableRef || {};
  const tableInfo = descriptor.schema && descriptor.name ? descriptor : findTableInfo(descriptor, metadataMap);
  const schema = tableInfo?.schema || descriptor.schema || 'public';
  const table = tableInfo?.name || descriptor.table || descriptor.name || 'table';
  const cleanColumns = columns.map(column => column.replace(/\bASC\b|\bDESC\b|\bNULLS\s+(FIRST|LAST)\b/gi, '').trim()).filter(Boolean);
  const safeColumns = cleanColumns.map(column => column.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase());
  const indexName = `idx_${table.toLowerCase()}_${safeColumns.join('_')}`.replace(/_+/g, '_').slice(0, 60);

  let statement = `CREATE INDEX CONCURRENTLY ${indexName} ON ${schema}.${table} (${cleanColumns.join(', ')});`;
  if (includeColumns.length > 0) {
    statement = `CREATE INDEX CONCURRENTLY ${indexName} ON ${schema}.${table} (${cleanColumns.join(', ')}) INCLUDE (${includeColumns.join(', ')});`;
  }

  return statement;
}

function buildSchemaIssues({ sql, tableMetadata, tables }) {
  const issues = [];
  const recommendations = [];
  const normalizedTables = tables || [];
  const metadataMap = getTableMetadataMap(tableMetadata);
  const tableRefs = parseTableRefs(sql);
  const selectColumns = parseSelectColumns(sql);
  const groupByColumns = parseGroupByColumns(sql);
  const orderByColumns = parseOrderByColumns(sql);
  const whereClause = parseWhereClause(sql);
  const comparisonPairs = parseConditions(sql);
  const joinClauses = parseJoinConditions(sql);

  const byAlias = aliasToTable(tableRefs);
  const columnsByTable = new Map();

  const addColumn = (tableKey, column) => {
    if (!columnsByTable.has(tableKey)) {
      columnsByTable.set(tableKey, []);
    }
    uniquePush(columnsByTable.get(tableKey), column);
  };

  comparisonPairs.forEach(pair => {
    const leftRef = parseColumnReference(pair.left);
    const rightRef = parseColumnReference(pair.right);

    if (leftRef) {
      const leftTable = byAlias.get((leftRef.alias || leftRef.column).toLowerCase());
      if (leftTable) addColumn(`${leftTable.schema}.${leftTable.table}`.toLowerCase(), leftRef.column);
    }
    if (rightRef) {
      const rightTable = byAlias.get((rightRef.alias || rightRef.column).toLowerCase());
      if (rightTable) addColumn(`${rightTable.schema}.${rightTable.table}`.toLowerCase(), rightRef.column);
    }
  });

  joinClauses.forEach(joinClause => {
    extractComparisonPairs(joinClause).forEach(pair => {
      const leftRef = parseColumnReference(pair.left);
      const rightRef = parseColumnReference(pair.right);

      if (leftRef) {
        const leftTable = byAlias.get((leftRef.alias || leftRef.column).toLowerCase());
        if (leftTable) addColumn(`${leftTable.schema}.${leftTable.table}`.toLowerCase(), leftRef.column);
      }

      if (rightRef) {
        const rightTable = byAlias.get((rightRef.alias || rightRef.column).toLowerCase());
        if (rightTable) addColumn(`${rightTable.schema}.${rightTable.table}`.toLowerCase(), rightRef.column);
      }
    });
  });

  [...groupByColumns, ...orderByColumns].forEach(entry => {
    const ref = parseColumnReference(entry.replace(/\s+(ASC|DESC)$/i, ''));
    if (!ref) return;
    const refTable = byAlias.get((ref.alias || ref.column).toLowerCase());
    if (refTable) addColumn(`${refTable.schema}.${refTable.table}`.toLowerCase(), ref.column);
  });

  if (/\bOFFSET\s+\d{3,}\b/i.test(sql)) {
    issues.push(problem(
      'Large OFFSET pagination',
      'OFFSET forces the database to scan and discard rows before it can return the requested page.',
      'Use keyset pagination and a deterministic sort key instead of a large OFFSET.'
    ));
  }

  normalizedTables.forEach(tableName => {
    const tableInfo = metadataMap.get(tableName.toLowerCase()) || metadataMap.get(`public.${tableName}`.toLowerCase());
    if (!tableInfo) return;

    const candidateColumns = columnsByTable.get(tableName.toLowerCase()) || [];
    if (candidateColumns.length > 0) {
      const indexed = hasMatchingIndex(tableInfo, candidateColumns);
      if (!indexed) {
        recommendations.push(buildIndexRecommendation(tableInfo, candidateColumns, metadataMap));
        issues.push(problem(
          `Missing index on ${tableName}`,
          'The query references filter, join, or sort columns that are not covered by an existing leading index prefix.',
          `Create an index on ${candidateColumns.join(', ')} for ${tableName}.`
        ));
      }
    }

    if (tableRowsLarge(tableInfo) && /\bWHERE\b/i.test(whereClause)) {
      issues.push(problem(
        `Large table ${tableName} needs selective access`,
        'Large tables benefit from selective access paths or partition pruning when predicates are time- or tenant-based.',
        'Consider partitioning on the dominant filter dimension or adding a covering index for the hot access path.'
      ));
    }
  });

  if (issues.length === 0) {
    issues.push(problem(
      'No schema/data issue detected',
      'The available metadata does not show a clear index, selectivity, or partitioning gap.',
      'Keep the current schema design and revisit with actual statistics if the workload grows.'
    ));
  }

  return { issues, recommendations };
}

function containsUnsafeRewrite(sql) {
  return /\bSELECT\s+\*\b/i.test(sql) || /:\w+/.test(sql) || /ORDER\s+BY\s+1/i.test(sql);
}

function replaceSelectColumns(sql, columns) {
  if (!Array.isArray(columns) || columns.length === 0) return sql;
  return sql.replace(/(\bSELECT\s+(?:DISTINCT\s+)?)([\s\S]+?)(\s+\bFROM\b)/i, (match, selectPrefix, selectBody, fromToken) => {
    const compact = columns.map(column => column.trim()).filter(Boolean);
    if (compact.length === 0) return match;
    return `${selectPrefix}${compact.join(',\n    ')}${fromToken}`;
  });
}

function removeUnusedProjectedColumns(sql, ruleBasedIssues = []) {
  const issueEntry = (ruleBasedIssues || []).find(item => /unused columns in select/i.test(item.issue || ''));
  if (!issueEntry || !issueEntry.fix) return sql;

  const unusedMatch = issueEntry.fix.match(/Remove unused projected columns:\s*(.+?)\.?$/i);
  if (!unusedMatch) return sql;

  const unusedColumns = splitTopLevelComma(unusedMatch[1]).map(item => item.trim().toLowerCase());
  if (unusedColumns.length === 0) return sql;

  const selectColumns = parseSelectColumns(sql);
  if (selectColumns.length === 0) return sql;

  const keptColumns = selectColumns.filter(column => !unusedColumns.includes(column.trim().toLowerCase()));
  if (keptColumns.length === 0 || keptColumns.length === selectColumns.length) return sql;

  return replaceSelectColumns(sql, keptColumns);
}

function normalizeNonSargableComparisons(sql) {
  let rewritten = sql;
  rewritten = rewritten.replace(
    /LOWER\(\s*([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)::text\s*\)\s*=\s*LOWER\(\s*([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)::text\s*\)/gi,
    '$1::text = $2::text'
  );
  rewritten = rewritten.replace(
    /LOWER\(\s*([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)\s*\)\s*=\s*LOWER\(\s*([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)\s*\)/gi,
    '$1 = $2'
  );
  return rewritten;
}

function rewriteUnionToUnionAll(sql, ruleBasedIssues = []) {
  const hasUnionIssue = (ruleBasedIssues || []).some(item => /UNION without ALL/i.test(item.issue || ''));
  if (!hasUnionIssue) return sql;
  return sql.replace(/\bUNION\b(?!\s+ALL)/i, 'UNION ALL');
}

function rewriteScalarAggregateSubqueryToJoin(sql, ruleBasedIssues = []) {
  const hasSubqueryIssue = (ruleBasedIssues || []).some(item => /unnecessary subqueries/i.test(item.issue || ''));
  if (!hasSubqueryIssue) return sql;

  const pattern = /\(\s*SELECT\s+(SUM|COUNT|AVG|MIN|MAX)\s*\(\s*([a-zA-Z_][\w$]*)\.([a-zA-Z_][\w$]*)\s*\)\s+FROM\s+([a-zA-Z_][\w$]*)\s+([a-zA-Z_][\w$]*)\s+WHERE\s+LOWER\(\s*\5\.([a-zA-Z_][\w$]*)::text\s*\)\s*=\s*LOWER\(\s*([a-zA-Z_][\w$]*)\.([a-zA-Z_][\w$]*)::text\s*\)\s*\)\s+AS\s+([a-zA-Z_][\w$]*)/i;
  const match = sql.match(pattern);
  if (!match) return sql;

  const [fullExpr, aggregateFn, innerAggAlias, innerAggCol, innerTable, innerAlias, innerJoinCol, outerAlias, outerJoinCol, outputAlias] = match;
  const joinAlias = `qc_${outputAlias}`;

  const replacementSelectExpr = `${joinAlias}.${outputAlias} AS ${outputAlias}`;
  let rewritten = sql.replace(fullExpr, replacementSelectExpr);

  const joinBlock = `\nLEFT JOIN (\n  SELECT\n    ${innerAlias}.${innerJoinCol}::text AS join_key,\n    ${aggregateFn}(${innerAlias}.${innerAggCol}) AS ${outputAlias}\n  FROM ${innerTable} ${innerAlias}\n  GROUP BY ${innerAlias}.${innerJoinCol}::text\n) ${joinAlias} ON ${joinAlias}.join_key = ${outerAlias}.${outerJoinCol}::text`;

  rewritten = rewritten.replace(/(\bFROM\s+[a-zA-Z_][\w$]*\s+[a-zA-Z_][\w$]*)([\s\S]*?)(\bWHERE\b|\bGROUP\s+BY\b|\bORDER\s+BY\b|;|$)/i,
    (m, fromClause, middle, tail) => `${fromClause}${joinBlock}${middle}${tail}`
  );

  return rewritten;
}

function applyRuleDrivenRewrites(sql, ruleBasedIssues = []) {
  let rewritten = String(sql || '').trim();
  if (!rewritten) return { sql: rewritten, changed: false };

  rewritten = rewriteScalarAggregateSubqueryToJoin(rewritten, ruleBasedIssues);
  rewritten = normalizeNonSargableComparisons(rewritten);
  rewritten = removeUnusedProjectedColumns(rewritten, ruleBasedIssues);
  rewritten = rewriteUnionToUnionAll(rewritten, ruleBasedIssues);

  return {
    sql: rewritten,
    changed: rewritten.trim() !== String(sql || '').trim(),
  };
}

function synthesizeSuggestedRewrite(sql, ruleBasedIssues = []) {
  const originalSql = String(sql || '').trim();
  const suggestions = [];

  if ((ruleBasedIssues || []).some(item => /unnecessary subqueries/i.test(item.issue || ''))) {
    suggestions.push('-- Suggested rewrite: replace scalar subquery with a LEFT JOIN aggregate.');
  }
  if ((ruleBasedIssues || []).some(item => /unused columns in select/i.test(item.issue || ''))) {
    suggestions.push('-- Suggested rewrite: select only required columns.');
  }
  if ((ruleBasedIssues || []).some(item => /functions on indexed columns|non-sargable/i.test(item.issue || ''))) {
    suggestions.push('-- Suggested rewrite: remove function wrappers from indexed comparison columns.');
  }

  const prefix = suggestions.length > 0 ? `${suggestions.join('\n')}\n` : '-- Suggested rewrite\n';
  return `${prefix}${originalSql}`;
}

function buildOptimizedQuery({ sql, rewriteResult, indexRecommendations, ruleBasedIssues, executionPlanIssues, schemaIssues }) {
  const originalSql = String(sql || '').trim();
  const rewrites = rewriteResult?.optimized_sql && rewriteResult.optimized_sql !== rewriteResult.original_sql && !containsUnsafeRewrite(rewriteResult.optimized_sql)
    ? rewriteResult.optimized_sql.trim()
    : originalSql;

  const rewrittenFromRules = applyRuleDrivenRewrites(rewrites, ruleBasedIssues);
  if (rewrittenFromRules.changed) {
    return rewrittenFromRules.sql;
  }

  const hasFindings = (ruleBasedIssues || []).some(item => item.rule_violated !== 'N/A')
    || (executionPlanIssues || []).some(item => !/No major execution-plan issue detected/i.test(item.problem || ''))
    || (schemaIssues || []).some(item => !/No schema\/data issue detected/i.test(item.problem || ''))
    || (indexRecommendations || []).length > 0;

  if (hasFindings) {
    return synthesizeSuggestedRewrite(rewrites, ruleBasedIssues);
  }

  return rewrites;
}

function estimateImpact({ runtimeMs, sciGco2, ruleBasedIssues, planIssues }) {
  const reductions = [];
  if ((ruleBasedIssues || []).some(item => /SELECT \*/i.test(item.issue))) reductions.push(35);
  if ((ruleBasedIssues || []).some(item => /NOT IN/i.test(item.issue))) reductions.push(30);
  if ((ruleBasedIssues || []).some(item => /OFFSET/i.test(item.issue))) reductions.push(60);
  if ((planIssues || []).some(item => /Sequential scan/i.test(item.problem))) reductions.push(70);
  if ((planIssues || []).some(item => /Nested loop/i.test(item.problem))) reductions.push(65);
  if ((planIssues || []).some(item => /Large sort/i.test(item.problem))) reductions.push(40);

  const combinedRuntimeReductionPct = reductions.length > 0 ? combineImprovements(reductions) : 0;
  const combinedCarbonReductionPct = Math.max(0, Math.min(95, Math.round((combinedRuntimeReductionPct * 1.05) * 100) / 100));
  const estimatedRuntimeMs = Math.max(0, Math.round(runtimeMs * (1 - combinedRuntimeReductionPct / 100) * 100) / 100);
  const estimatedSci = Math.max(0, Math.round(sciGco2 * (1 - combinedCarbonReductionPct / 100) * 1e6) / 1e6);

  return {
    before: {
      runtime_ms: Math.round(runtimeMs * 100) / 100,
      sci_gco2eq: Math.round(sciGco2 * 1e6) / 1e6,
    },
    after: {
      runtime_ms: estimatedRuntimeMs,
      sci_gco2eq: estimatedSci,
    },
    expected_improvement: {
      runtime_reduction_pct: combinedRuntimeReductionPct,
      carbon_reduction_pct: combinedCarbonReductionPct,
    },
  };
}

function buildTradeOffs({ ruleBasedIssues, schemaIssues, optimizedQuery }) {
  const tradeOffs = [];
  if ((ruleBasedIssues || []).some(item => /SELECT \*/i.test(item.issue))) {
    tradeOffs.push('Narrower projections improve performance but require the caller to manage a more explicit column list.');
  }
  if ((schemaIssues || []).some(item => /Missing index/i.test(item.problem))) {
    tradeOffs.push('Indexes improve reads but increase write overhead, storage use, and vacuum maintenance cost.');
  }
  if (/WITH\s+/i.test(optimizedQuery)) {
    tradeOffs.push('CTEs can improve readability and reuse, but on older PostgreSQL versions they may prevent some planner inlining.');
  }
  if ((ruleBasedIssues || []).some(item => /OFFSET/i.test(item.issue))) {
    tradeOffs.push('Keyset pagination is faster at scale but requires a stable sort key and application-side cursor handling.');
  }
  if (tradeOffs.length === 0) {
    tradeOffs.push('No material trade-off was introduced beyond the existing query shape.');
  }
  return tradeOffs;
}

function formatStrictReport(report) {
  const section = (title, lines) => `${title}\n${lines.map(line => `- ${line}`).join('\n')}`;

  const ruleLines = (report.rule_based_issues || []).map(item => [
    `Issue: ${item.issue}`,
    `Why inefficient: ${item.why_inefficient}`,
    `Rule violated: ${item.rule_violated}`,
    `Fix: ${item.fix}`,
  ].join('\n'));

  const planLines = (report.execution_plan_issues || []).map(item => [
    `Problem: ${item.problem}`,
    `Why it happens: ${item.why_it_happens}`,
    `Fix: ${item.fix}`,
  ].join('\n'));

  const schemaLines = (report.data_schema_issues || []).map(item => [
    `Problem: ${item.problem}`,
    `Fix: ${item.fix}`,
  ].join('\n'));

  const indexLines = (report.index_recommendations || []).map(statement => statement);
  const tradeOffLines = (report.trade_offs || []).map(item => item);

  return [
    '1. RULE-BASED ISSUES',
    ruleLines.length > 0 ? ruleLines.map(line => `- ${line}`).join('\n') : '- Issue: None detected\n- Why inefficient: No strict rule-based anti-pattern was triggered.\n- Rule violated: N/A\n- Fix: Keep the current shape and rely on the remaining sections.',
    '',
    '2. EXECUTION PLAN ISSUES',
    planLines.length > 0 ? planLines.map(line => `- ${line}`).join('\n') : '- Problem: None detected\n- Why it happens: The available plan does not show a dominant execution bottleneck.\n- Fix: Keep the current plan shape.',
    '',
    '3. DATA / SCHEMA ISSUES',
    schemaLines.length > 0 ? schemaLines.map(line => `- ${line}`).join('\n') : '- Problem: None detected\n- Fix: Keep the current schema design.',
    '',
    '4. OPTIMIZED QUERY',
    report.optimized_query || report.original_query || '',
    '',
    '5. INDEX RECOMMENDATIONS',
    indexLines.length > 0 ? indexLines.map(line => `- ${line}`).join('\n') : '- None required',
    '',
    '6. PERFORMANCE IMPACT',
    `- Before: runtime ${report.performance_impact.before.runtime_ms} ms, SCI ${report.performance_impact.before.sci_gco2eq} gCO2eq`,
    `- After: runtime ${report.performance_impact.after.runtime_ms} ms, SCI ${report.performance_impact.after.sci_gco2eq} gCO2eq`,
    `- Expected improvement: ${report.performance_impact.expected_improvement.runtime_reduction_pct}% runtime, ${report.performance_impact.expected_improvement.carbon_reduction_pct}% carbon`,
    '',
    '7. TRADE-OFFS',
    tradeOffLines.length > 0 ? tradeOffLines.map(line => `- ${line}`).join('\n') : '- No additional trade-offs identified',
  ].join('\n');
}

function analyzeQueryOptimization({
  sql,
  planNode = null,
  tables = [],
  tableMetadata = {},
  runtimeMs = DEFAULT_RUNTIME_MS,
  sciGco2 = 0,
  rewriteResult = null,
  plannerCost = 0,
}) {
  const ruleBasedIssues = buildRuleBasedIssues({ sql, tables, tableMetadata });
  const executionPlanIssues = buildExecutionPlanIssues(planNode, { runtimeMs, plannerCost });
  const schemaResult = buildSchemaIssues({ sql, tableMetadata, tables });
  const optimizedQuery = buildOptimizedQuery({
    sql,
    rewriteResult,
    indexRecommendations: schemaResult.recommendations,
    ruleBasedIssues,
    executionPlanIssues,
    schemaIssues: schemaResult.issues,
  });
  const performanceImpact = estimateImpact({
    runtimeMs,
    sciGco2,
    ruleBasedIssues,
    planIssues: executionPlanIssues,
  });
  const tradeOffs = buildTradeOffs({
    ruleBasedIssues,
    schemaIssues: schemaResult.issues,
    optimizedQuery,
  });

  const report = {
    rule_based_issues: ruleBasedIssues,
    execution_plan_issues: executionPlanIssues,
    data_schema_issues: schemaResult.issues,
    optimized_query: optimizedQuery,
    index_recommendations: schemaResult.recommendations,
    performance_impact: performanceImpact,
    trade_offs: tradeOffs,
    query_comparison: {
      original_sql: String(sql || '').trim(),
      suggested_sql: optimizedQuery,
      changed: optimizedQuery.trim() !== String(sql || '').trim(),
    },
  };

  return {
    ...report,
    report_text: formatStrictReport({
      ...report,
      original_query: sql,
    }),
  };
}

module.exports = {
  analyzeQueryOptimization,
  formatStrictReport,
};