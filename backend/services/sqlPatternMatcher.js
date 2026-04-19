/**
 * Track 3 — Rule-Based SQL Rewriting
 * Operates on the raw SQL string. Each rule fires independently.
 * Returns rewrite_suggestion objects — human-readable descriptions, not rewritten SQL.
 */

// R1 — NOT IN with subquery
function matchR1(sql) {
  if (!/NOT\s+IN\s*\(\s*SELECT/i.test(sql)) return null;
  return makeFinding({
    rule_id: 'R1',
    severity: 'high',
    suggestion: 'Rewrite NOT IN (SELECT ...) as a LEFT JOIN anti-join: `SELECT a.* FROM a LEFT JOIN b ON a.id = b.a_id WHERE b.a_id IS NULL`',
    rationale: 'NOT IN with a subquery evaluates the subquery for every outer row and silently returns false for the entire set if any subquery row is NULL — a correctness bug as well as a performance issue.',
  });
}

// R2 — NOT EXISTS (correlated subquery)
function matchR2(sql) {
  if (!/NOT\s+EXISTS\s*\(\s*SELECT/i.test(sql)) return null;
  // Detect correlation: subquery WHERE references something — simplified heuristic
  const subMatch = sql.match(/NOT\s+EXISTS\s*\(([^)]+)\)/is);
  if (!subMatch || !/WHERE/i.test(subMatch[1])) return null;
  return makeFinding({
    rule_id: 'R2',
    severity: 'medium',
    suggestion: 'Rewrite the correlated NOT EXISTS as a LEFT JOIN anti-join: `SELECT a.* FROM a LEFT JOIN b ON a.id = b.a_id WHERE b.a_id IS NULL`. This is typically faster at scale.',
    rationale: 'A correlated NOT EXISTS subquery re-executes for every outer row, making the query O(n×m). A LEFT JOIN anti-join processes both sets once.',
  });
}

// R3 — SELECT * in subquery or CTE
function matchR3(sql) {
  const inSubquery = /\(\s*SELECT\s+\*/i.test(sql);
  const inCte = /WITH\s+\w+\s+AS\s*\(\s*SELECT\s+\*/i.test(sql);
  if (!inSubquery && !inCte) return null;
  return makeFinding({
    rule_id: 'R3',
    severity: 'medium',
    suggestion: 'Replace SELECT * in the subquery/CTE with only the columns actually referenced by the outer query. This reduces I/O and memory pressure.',
    rationale: 'SELECT * in a subquery forces the engine to fetch all columns even when only one or two are needed by the outer query.',
  });
}

// R4 — OR conditions on the same column that could be IN
function matchR4(sql) {
  const re = /\b(\w+)\s*=\s*[^\s=][^\s]*\s+OR\s+\1\s*=/gi;
  if (!re.test(sql)) return null;
  return makeFinding({
    rule_id: 'R4',
    severity: 'low',
    suggestion: 'Rewrite repeated OR equality checks on the same column as `col IN (X, Y, Z)`. Cleaner and equally efficient in PostgreSQL.',
    rationale: 'Multiple `col = X OR col = Y` conditions on the same column are verbose and error-prone. The IN form is equivalent in PostgreSQL and easier to maintain.',
  });
}

// R5 — DISTINCT used to mask a missing JOIN condition
function matchR5(sql) {
  if (!/SELECT\s+DISTINCT\b/i.test(sql)) return null;
  if (!/\bJOIN\b/i.test(sql)) return null;
  return makeFinding({
    rule_id: 'R5',
    severity: 'medium',
    suggestion: 'Audit the JOIN condition first — DISTINCT after a JOIN often hides a missing or incorrect join condition. If duplicates are expected, use GROUP BY instead of DISTINCT to make intent explicit.',
    rationale: 'SELECT DISTINCT with a JOIN frequently indicates a missing join predicate that produces duplicate rows. DISTINCT masks the symptom rather than fixing the root cause.',
  });
}

// R6 — OFFSET with large value (deep pagination)
function matchR6(sql) {
  const offsetMatch = sql.match(/\bOFFSET\s+(\d+)/i);
  if (!offsetMatch) return null;

  const offsetVal = parseInt(offsetMatch[1], 10);
  if (offsetVal <= 1000) return null;

  const severity = offsetVal > 10000 ? 'high' : 'medium';
  return makeFinding({
    rule_id: 'R6',
    severity,
    suggestion: `Use keyset (cursor) pagination instead of OFFSET ${offsetVal.toLocaleString()}. Track the last seen sort-column value: \`WHERE sort_col > last_seen_value ORDER BY sort_col LIMIT n\``,
    rationale: `LIMIT n OFFSET ${offsetVal.toLocaleString()} forces the engine to scan and discard ${offsetVal.toLocaleString()} rows on every page request — O(offset) work even though only n rows are returned.`,
  });
}

// R7 — Implicit type coercion in WHERE clause
function matchR7(sql) {
  const re = /\b(\w+(?:_id|_at|_date|_count|_num|_amount))\s*=\s*'[^']+'/gi;
  if (!re.test(sql)) return null;
  return makeFinding({
    rule_id: 'R7',
    severity: 'medium',
    suggestion: 'Ensure the literal type matches the column type. Use explicit casts on the literal (e.g. `::int`, `::date`, `::timestamptz`) rather than relying on implicit coercion, which suppresses index use.',
    rationale: 'A typed column (like _id, _at, _date) compared to a string literal forces an implicit cast on every row, preventing the planner from using an index.',
  });
}

// R8 — Wildcard LIKE with leading wildcard
function matchR8(sql) {
  if (!/LIKE\s+'%/i.test(sql)) return null;
  return makeFinding({
    rule_id: 'R8',
    severity: 'high',
    suggestion: "Avoid leading wildcards (LIKE '%...'). Use a trailing wildcard (LIKE 'prefix%') for prefix search, or install pg_trgm and use a GIN index (`gin_trgm_ops`) for arbitrary substring search.",
    rationale: "A LIKE pattern with a leading wildcard cannot use a B-tree index. The engine must do a full sequential scan of the table.",
  });
}

// R9 — HAVING without GROUP BY
function matchR9(sql) {
  if (!/\bHAVING\b/i.test(sql)) return null;
  if (/\bGROUP\s+BY\b/i.test(sql)) return null;
  return makeFinding({
    rule_id: 'R9',
    severity: 'medium',
    suggestion: 'Replace HAVING with WHERE. Use HAVING only when filtering on aggregate results (e.g. `HAVING COUNT(*) > 5`). Without GROUP BY, HAVING applies to the entire result as one group.',
    rationale: 'HAVING without GROUP BY treats the entire result set as a single group. The intent was almost certainly a WHERE clause.',
  });
}

// R10 — Correlated subquery in SELECT list
function matchR10(sql) {
  // Check for subquery (SELECT inside SELECT column list, before FROM)
  const beforeFrom = sql.match(/^([\s\S]*?)\bFROM\b/i)?.[1] || '';
  if (!/\(\s*SELECT\b/i.test(beforeFrom)) return null;
  return makeFinding({
    rule_id: 'R10',
    severity: 'high',
    suggestion: 'Rewrite the correlated subquery in the SELECT list as a LEFT JOIN, or use a window function if it computes an aggregate relative to the outer row.',
    rationale: 'A subquery in the SELECT column list re-executes for every row in the outer result set — O(n) subquery executions, which is very expensive for large outer sets.',
  });
}

// R11 — COUNT(column) vs COUNT(*)
function matchR11(sql) {
  // Match COUNT(col) where col is not * or 1
  if (!/\bCOUNT\s*\(\s*(?!\s*\*|\s*1\s*\))([a-zA-Z_"'[`])/i.test(sql)) return null;
  return makeFinding({
    rule_id: 'R11',
    severity: 'low',
    suggestion: "If NULL exclusion is not intentional, replace COUNT(column) with COUNT(*). COUNT(*) is faster as it doesn't need to inspect column values. If NULL exclusion is intentional, add a comment to clarify.",
    rationale: 'COUNT(column) skips NULLs and requires inspecting each value; COUNT(*) counts all rows without value inspection and is faster.',
  });
}

// R12 — UNION instead of UNION ALL
function matchR12(sql) {
  if (!/\bUNION\b/i.test(sql)) return null;
  // If it has UNION ALL anywhere, skip (already using the fast form)
  if (/\bUNION\s+ALL\b/i.test(sql)) return null;
  return makeFinding({
    rule_id: 'R12',
    severity: 'medium',
    suggestion: 'If the two result sets are guaranteed to have no overlapping rows, replace UNION with UNION ALL to skip the O(n log n) deduplication pass. Keep UNION if deduplication is intentional.',
    rationale: 'Plain UNION performs a deduplication pass over the combined result set. If the sides are already disjoint, this is unnecessary O(n log n) work.',
  });
}

function makeFinding(overrides) {
  return {
    track: 'sql_pattern',
    table: null,
    simulation: 'not_applicable',
    index_ddl: null,
    sci_delta: null,
    ...overrides,
  };
}

/**
 * Run all 12 rules against the raw SQL string.
 *
 * @param {string} sql - Original SQL query text
 * @returns {Array} Array of finding objects
 */
function analyzeSqlPatterns(sql) {
  const rules = [
    matchR1, matchR2, matchR3, matchR4, matchR5, matchR6,
    matchR7, matchR8, matchR9, matchR10, matchR11, matchR12,
  ];

  const findings = [];
  for (const rule of rules) {
    try {
      const finding = rule(sql);
      if (finding) findings.push(finding);
    } catch (err) {
      console.warn(`[SQLPatternMatcher] Rule ${rule.name} threw:`, err.message);
    }
  }

  return findings;
}

module.exports = { analyzeSqlPatterns };
