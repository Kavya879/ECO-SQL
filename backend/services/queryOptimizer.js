/**
 * Rule-based SQL optimization analyzer for PostgreSQL workloads.
 * Deterministic implementation using regex/string matching only.
 */

const SQL_FUNCTION_PATTERN = /\b(lower|upper|trim|substring|coalesce|date_trunc|extract|cast)\s*\(/i;

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function pushIssue(issues, issue, reason, suggestion) {
  issues.push({ issue, reason, suggestion });
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function tableAliasMap(query) {
  const map = new Map();
  const regex = /\b(from|join)\s+([a-zA-Z_][\w.]*)(?:\s+(?:as\s+)?([a-zA-Z_][\w]*))?/ig;
  let match;

  while ((match = regex.exec(query)) !== null) {
    const table = match[2];
    const alias = match[3];
    map.set(table, table);
    if (alias) {
      map.set(alias, table);
    }
  }

  return map;
}

function findSelectClause(query) {
  const m = query.match(/\bselect\b\s+([\s\S]*?)\s+\bfrom\b/i);
  return m ? m[1] : '';
}

function findClause(query, startKeyword, endKeywords) {
  const endPattern = endKeywords.join('|');
  const regex = new RegExp(`\\b${startKeyword}\\b\\s+([\\s\\S]*?)(?=\\b(?:${endPattern})\\b|$)`, 'i');
  const m = query.match(regex);
  return m ? m[1] : '';
}

function extractColumnRefs(text) {
  const refs = [];
  if (!text) return refs;

  const qualified = /\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\b/g;
  let m;
  while ((m = qualified.exec(text)) !== null) {
    refs.push({ alias: m[1], column: m[2], raw: `${m[1]}.${m[2]}` });
  }

  return refs;
}

function indexStatement(table, column) {
  return `CREATE INDEX idx_${table.replace(/\W/g, '_')}_${column} ON ${table}(${column});`;
}

function expressionIndexStatement(table, expression, suffix) {
  return `CREATE INDEX idx_${table.replace(/\W/g, '_')}_${suffix} ON ${table} (${expression});`;
}

function extractFunctionPredicates(whereClause) {
  const matches = [];
  if (!whereClause) return matches;

  // Example matched shape: LOWER(c.customer_id::text)
  const fnRegex = /\b(lower|upper|trim)\s*\(\s*([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)(\s*::\s*[a-zA-Z_][\w]*)?\s*\)/ig;
  let m;
  while ((m = fnRegex.exec(whereClause)) !== null) {
    matches.push({
      func: m[1].toLowerCase(),
      alias: m[2],
      column: m[3],
      castSuffix: (m[4] || '').replace(/\s+/g, '')
    });
  }

  return matches;
}

function getJoinSegments(query) {
  const segments = [];
  const regex = /\bjoin\b\s+[\s\S]*?(?=\bjoin\b|\bwhere\b|\bgroup\b|\border\b|\blimit\b|\boffset\b|$)/ig;
  let m;
  while ((m = regex.exec(query)) !== null) {
    segments.push(m[0]);
  }
  return segments;
}

function findTopLevelKeywordIndex(sql, keyword) {
  const lowerSql = sql.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  let depth = 0;

  for (let i = 0; i <= lowerSql.length - lowerKeyword.length; i += 1) {
    const ch = lowerSql[i];
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);

    if (depth === 0 && lowerSql.slice(i, i + lowerKeyword.length) === lowerKeyword) {
      const before = i === 0 ? ' ' : lowerSql[i - 1];
      const after = i + lowerKeyword.length >= lowerSql.length ? ' ' : lowerSql[i + lowerKeyword.length];
      if (/\W/.test(before) && /\W/.test(after)) {
        return i;
      }
    }
  }

  return -1;
}

function extractOuterFromClause(sql) {
  const match = sql.match(/\bfrom\b\s+([a-zA-Z_][\w.]*)\s+([a-zA-Z_][\w]*)/i);
  if (!match) return null;
  return { table: match[1], alias: match[2] };
}

function rewriteCorrelatedAggregateSubquery(sql) {
  const outer = extractOuterFromClause(sql);
  if (!outer) return null;

  const selectIndex = findTopLevelKeywordIndex(sql, 'select');
  const fromIndex = findTopLevelKeywordIndex(sql, 'from');
  if (selectIndex < 0 || fromIndex < 0 || fromIndex <= selectIndex) return null;

  const selectClause = sql.slice(selectIndex + 'select'.length, fromIndex).trim();
  const subqueryPattern = /\(\s*select\s+(sum|avg|min|max|count)\s*\(([^)]*)\)\s+from\s+([a-zA-Z_][\w.]*)\s+([a-zA-Z_][\w]*)\s+where\s+([\s\S]*?)\s*\)\s+as\s+([a-zA-Z_][\w]*)/i;
  const subqueryMatch = selectClause.match(subqueryPattern);

  if (!subqueryMatch) return null;

  const aggregateFn = subqueryMatch[1].toUpperCase();
  const aggregateArg = subqueryMatch[2].trim();
  const innerTable = subqueryMatch[3];
  const innerAlias = subqueryMatch[4];
  const whereClause = subqueryMatch[5].trim();
  const outputAlias = subqueryMatch[6];
  const lateralAlias = `${innerAlias}_${outputAlias}`;

  const rewrittenSelectClause = selectClause.replace(subqueryPattern, `${lateralAlias}.${outputAlias}`);
  const fromClauseMatch = sql.slice(fromIndex).match(/^from\s+([a-zA-Z_][\w.]*)\s+([a-zA-Z_][\w]*)([\s\S]*)$/i);
  if (!fromClauseMatch) return null;

  const rewrittenQuery = sql.replace(
    selectClause,
    rewrittenSelectClause
  ).replace(
    /\bfrom\b\s+[a-zA-Z_][\w.]*\s+[a-zA-Z_][\w]*/i,
    `FROM ${fromClauseMatch[1]} ${fromClauseMatch[2]}\nLEFT JOIN LATERAL (\n  SELECT ${aggregateFn}(${aggregateArg}) AS ${outputAlias}\n  FROM ${innerTable} ${innerAlias}\n  WHERE ${whereClause}\n) ${lateralAlias} ON true`
  );

  return normalizeSql(rewrittenQuery);
}

function parseExplainJson(explainJson) {
  if (!explainJson) return null;

  try {
    if (typeof explainJson === 'string') {
      return JSON.parse(explainJson);
    }
    return explainJson;
  } catch (e) {
    return null;
  }
}

function traversePlan(node, cb) {
  if (!node || typeof node !== 'object') return;
  cb(node);

  if (Array.isArray(node.Plans)) {
    node.Plans.forEach((p) => traversePlan(p, cb));
  }

  Object.keys(node).forEach((key) => {
    const val = node[key];
    if (val && typeof val === 'object' && !Array.isArray(val) && key !== 'Plans') {
      traversePlan(val, cb);
    }
    if (Array.isArray(val) && key !== 'Plans') {
      val.forEach((item) => traversePlan(item, cb));
    }
  });
}

function analyzeQuery(query, explainJson = null) {
  const issues = [];
  const indexRecommendations = [];
  const sql = normalizeSql(query);

  if (!sql) {
    return {
      issues: [
        {
          issue: 'No SQL query provided',
          reason: 'Analyzer requires a SQL statement to detect optimization risks.',
          suggestion: 'Provide a valid PostgreSQL query string for deterministic analysis.'
        }
      ],
      indexRecommendations: [],
      summary: {
        performanceImpact: 'No runtime optimization can be assessed without an input query.',
        carbonImpact: 'No carbon-impact estimate can be produced without query workload characteristics.'
      }
    };
  }

  // 1. SELECT *
  if (/\bselect\s+\*/i.test(sql)) {
    pushIssue(
      issues,
      'SELECT * detected',
      'Fetching all columns increases IO, memory use, and transfer time on large tables.',
      'Select only required columns to reduce scanned and returned data.'
    );
  }
  // 2. Missing WHERE clause
  if (/\bselect\b/i.test(sql) && !/\bwhere\b/i.test(sql)) {
    pushIssue(
      issues,
      'Missing WHERE clause',
      'Without filtering, large tables are likely fully scanned.',
      'Add selective WHERE predicates to reduce scanned rows.'
    );
  }

  // 3. Missing LIMIT
  if (/\bselect\b/i.test(sql) && !/\blimit\b/i.test(sql)) {
    pushIssue(
      issues,
      'Missing LIMIT clause',
      'Unbounded result sets can increase runtime and memory usage.',
      'Use pagination only when partial results are acceptable; keep full-result queries unchanged.'
    );
  }

  // 4. Index detection for WHERE/JOIN columns
  const aliasMap = tableAliasMap(sql);
  const whereClause = findClause(sql, 'where', ['group', 'order', 'limit', 'offset']);
  const joinSegments = getJoinSegments(sql);
  const orderClause = findClause(sql, 'order by', ['limit', 'offset']);

  const whereCols = extractColumnRefs(whereClause);
  const joinCols = extractColumnRefs(joinSegments.join(' '));
  const orderCols = extractColumnRefs(orderClause);
  const functionPredicates = extractFunctionPredicates(whereClause);

  unique([...whereCols, ...joinCols, ...orderCols].map((r) => r.raw)).forEach((raw) => {
    const [alias, column] = raw.split('.');
    const table = aliasMap.get(alias);
    if (table && column) {
      indexRecommendations.push(indexStatement(table, column));
    }
  });

  functionPredicates.forEach((fp) => {
    const table = aliasMap.get(fp.alias);
    if (!table) return;
    const cast = fp.castSuffix || '';
    const expression = `${fp.func}(${fp.column}${cast})`;
    const suffix = `${fp.column}_${fp.func}`;
    indexRecommendations.push(expressionIndexStatement(table, expression, suffix));
  });

  if (whereCols.length > 0 || joinCols.length > 0) {
    pushIssue(
      issues,
      'Potential missing indexes on filter/join columns',
      'Columns used in WHERE/JOIN may trigger sequential scans if not indexed.',
      'Create indexes on frequent filter/join columns and validate with EXPLAIN.'
    );
  }

  // 5. Leading wildcard LIKE
  if (/\b(i?like)\s+'%[^']*'/i.test(sql)) {
    pushIssue(
      issues,
      'Leading wildcard LIKE detected',
      "Patterns like LIKE '%value' are non-sargable for standard B-tree indexes.",
      'Avoid leading wildcard where possible or use full-text/trigram indexing.'
    );
  }

  // 6. Functions on columns (non-sargable)
  if (/\bwhere\b[\s\S]*\b(lower|upper|trim|substring|coalesce|date_trunc|extract|cast)\s*\(/i.test(sql) || SQL_FUNCTION_PATTERN.test(whereClause)) {
    pushIssue(
      issues,
      'Function on column in predicate',
      'Applying functions in WHERE can prevent index usage.',
      'Keep predicate logic unchanged and add an equivalent expression index (for example, LOWER(column::text)).'
    );
  }

  // 7. ORDER BY without index
  if (orderCols.length > 0) {
    pushIssue(
      issues,
      'ORDER BY may be unindexed',
      'Sorting large result sets is expensive when sort columns are not indexed.',
      'Add an index on ORDER BY columns, aligned with filter predicates.'
    );
  }

  // 8. Cartesian join
  const hasJoin = /\bjoin\b/i.test(sql);
  const joinWithoutOn = joinSegments.some((seg) => !/\bon\b/i.test(seg) && !/\busing\b/i.test(seg));
  if (hasJoin && joinWithoutOn) {
    pushIssue(
      issues,
      'Possible Cartesian join',
      'JOIN without ON/USING can multiply row counts drastically.',
      'Add explicit join conditions for every JOIN clause.'
    );
  }

  // 9. Unnecessary DISTINCT
  if (/\bselect\s+distinct\b/i.test(sql)) {
    pushIssue(
      issues,
      'DISTINCT detected',
      'DISTINCT adds deduplication cost and can force sort/hash operations.',
      'Remove DISTINCT only after confirming duplicates are not required by business logic.'
    );
  }

  // 10. Repeated subqueries
  const subqueryRegex = /\((\s*select[\s\S]*?)\)/ig;
  const seen = new Map();
  let sub;
  while ((sub = subqueryRegex.exec(sql)) !== null) {
    const key = normalizeSql(sub[1]).toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const hasRepeatedSubquery = Array.from(seen.values()).some((count) => count > 1);
  if (hasRepeatedSubquery) {
    pushIssue(
      issues,
      'Repeated subquery detected',
      'Repeating the same subquery duplicates planning and execution work.',
      'Use a CTE (WITH) to compute once and reuse results.'
    );
  }

  // Optional EXPLAIN analysis
  const parsedExplain = parseExplainJson(explainJson);
  if (parsedExplain) {
    traversePlan(parsedExplain, (node) => {
      const nodeType = String(node['Node Type'] || '');
      const totalCost = Number(node['Total Cost'] || 0);
      const planRows = Number(node['Plan Rows'] || 0);

      if (nodeType.toLowerCase().includes('seq scan')) {
        pushIssue(
          issues,
          'Sequential scan in EXPLAIN plan',
          'Seq Scan on large tables increases CPU and IO significantly.',
          'Add/selectively tune indexes on filter and join columns.'
        );
      }

      if (totalCost >= 10000 || planRows >= 100000) {
        pushIssue(
          issues,
          'High-cost or high-row plan node',
          'Large row scans or expensive nodes increase latency and compute load.',
          'Apply additional filtering, reduce selected columns, and index selective predicates.'
        );
      }
    });
  }

  // Ensure deterministic non-empty issues when query exists.
  if (issues.length === 0) {
    pushIssue(
      issues,
      'No major anti-pattern detected',
      'Query appears structurally reasonable under rule-based checks.',
      'Validate with EXPLAIN (ANALYZE, BUFFERS) and monitor real production cardinality.'
    );
  }

  const dedupedIndexes = unique(indexRecommendations);
  const issueCount = issues.length;

  return {
    issues,
    indexRecommendations: dedupedIndexes,
    summary: {
      performanceImpact: `Addressing ${issueCount} detected issue(s) can reduce full scans, sort work, and row processing time.`,
      carbonImpact: 'Reducing scanned rows and returned columns lowers CPU cycles, energy consumption, and associated carbon emissions.'
    }
  };
}

module.exports = {
  analyzeQuery
};
