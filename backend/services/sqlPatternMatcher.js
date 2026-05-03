/**
 * Track 3 — Rule-Based SQL Pattern Matching
 * Operates on raw SQL string only — no database connection needed.
 * Rules R1–R12 as defined in phase3-plan.md.
 */

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

// R1 — NOT IN with subquery
function detectR1(sql) {
  if (/NOT\s+IN\s*\(\s*SELECT/i.test(sql)) {
    return {
      pattern_id: 'NOT_IN_SUBQUERY',
      severity: 'high',
      table: null,
      column: null,
      node_path: null,
      suggestion: 'Rewrite as LEFT JOIN ... WHERE right_table.id IS NULL (anti-join pattern)',
      rationale: 'NOT IN with a subquery returns false for the entire set if any subquery row is NULL, causing silent correctness bugs and full scans',
      rewrite_template: 'SELECT a.* FROM a LEFT JOIN b ON a.id = b.a_id WHERE b.a_id IS NULL',
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

// R2 — Correlated NOT EXISTS subquery
function detectR2(sql) {
  if (/NOT\s+EXISTS\s*\(\s*SELECT/i.test(sql)) {
    return {
      pattern_id: 'CORRELATED_NOT_EXISTS',
      severity: 'medium',
      table: null,
      column: null,
      node_path: null,
      suggestion: 'Rewrite as LEFT JOIN ... WHERE right_table.id IS NULL anti-join. NOT EXISTS is safer than NOT IN for NULLs but the join form is faster at scale',
      rationale: 'Correlated subqueries re-execute for every outer row — O(n×m) complexity',
      rewrite_template: 'SELECT a.* FROM a LEFT JOIN b ON a.id = b.a_id WHERE b.id IS NULL',
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

// R3 — SELECT * in subquery or CTE (but not as outermost select)
function detectR3(sql) {
  const isOutermostSelectStar = /^\s*SELECT\s+\*/i.test(sql);
  const hasInnerSelectStar = /\(\s*SELECT\s+\*/i.test(sql) ||
    /WITH\s+\w[\w\s]*AS\s*\(\s*SELECT\s+\*/i.test(sql);
  if (hasInnerSelectStar && !isOutermostSelectStar) {
    return {
      pattern_id: 'SELECT_STAR_SUBQUERY',
      severity: 'medium',
      table: null,
      column: null,
      node_path: null,
      suggestion: 'Replace SELECT * in the subquery with only the columns referenced by the outer query',
      rationale: 'Forces the engine to fetch all columns even when only one or two are needed',
      rewrite_template: null,
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

// R4 — Repeated OR equality on same column
function detectR4(sql) {
  // Matches: col = X OR col = Y (same column name)
  if (/\b(\w+)\s*=\s*(?:'[^']*'|\S+)\s+OR\s+\1\s*=/i.test(sql)) {
    return {
      pattern_id: 'REPEATED_OR_EQUALITY',
      severity: 'low',
      table: null,
      column: null,
      node_path: null,
      suggestion: 'Rewrite col = X OR col = Y as col IN (X, Y, Z) — cleaner and avoids repetition mistakes',
      rationale: 'Repeated OR equality checks are verbose and error-prone when the list grows',
      rewrite_template: null,
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

// R5 — DISTINCT masking a bad join
function detectR5(sql) {
  if (/SELECT\s+DISTINCT/i.test(sql) && /\bJOIN\b/i.test(sql)) {
    return {
      pattern_id: 'DISTINCT_WITH_JOIN',
      severity: 'medium',
      table: null,
      column: null,
      node_path: null,
      suggestion: 'Audit the join condition first. If duplicates are expected, use GROUP BY instead of DISTINCT to make intent explicit. If unexpected, the join condition is likely wrong',
      rationale: 'DISTINCT with JOIN often masks a fan-out join that produces unintended duplicates',
      rewrite_template: null,
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

// R6 — Large OFFSET pagination
function detectR6(sql) {
  const m = sql.match(/\bOFFSET\s+(\d+)/i);
  if (m) {
    const offsetVal = parseInt(m[1], 10);
    if (offsetVal > 1000) {
      return {
        pattern_id: 'LARGE_OFFSET',
        severity: offsetVal > 10000 ? 'high' : 'medium',
        table: null,
        column: null,
        node_path: null,
        suggestion: `Use keyset pagination: replace OFFSET ${offsetVal} LIMIT n with WHERE sort_col > last_seen_value ORDER BY sort_col LIMIT n`,
        rationale: `OFFSET ${offsetVal} forces the engine to scan and discard ${offsetVal} rows — O(m) cost per page load`,
        rewrite_template: 'SELECT ... FROM table WHERE sort_col > :last_value ORDER BY sort_col LIMIT 20',
        forward_to_track2: false,
        forward_to_track2b: false,
        hint: null,
        index_ddl: null,
        track: 'sql_pattern',
      };
    }
  }
  return null;
}

// R7 — Implicit type coercion in WHERE
function detectR7(sql) {
  const m = sql.match(/\b(\w+(?:_id|_at|_date|_count|_num|_amount))\s*=\s*'[^']*'/i);
  if (m) {
    return {
      pattern_id: 'IMPLICIT_TYPE_COERCION',
      severity: 'medium',
      table: null,
      column: m[1],
      node_path: null,
      suggestion: `Ensure the literal matches the column type for "${m[1]}". Use explicit casts on the literal (::int, ::date, ::timestamptz) rather than relying on implicit coercion`,
      rationale: 'Implicit type coercion can prevent index use and cause silent correctness issues when the literal does not match the column type',
      rewrite_template: null,
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

// R8 — Leading wildcard LIKE
function detectR8(sql) {
  if (/\bI?LIKE\s+'%[^']/i.test(sql)) {
    return {
      pattern_id: 'LEADING_WILDCARD_LIKE',
      severity: 'high',
      table: null,
      column: null,
      node_path: null,
      suggestion: "If prefix search is sufficient, use LIKE 'prefix%' (trailing wildcard only). For substring search, consider a trigram index via pg_trgm extension with gin_trgm_ops",
      rationale: 'Leading wildcard prevents B-tree index use entirely — forces a sequential scan regardless of table size',
      rewrite_template: "column LIKE 'prefix%'  -- or: CREATE INDEX ON t USING gin(column gin_trgm_ops)",
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

// R9 — HAVING without GROUP BY
function detectR9(sql) {
  if (/\bHAVING\b/i.test(sql) && !/\bGROUP\s+BY\b/i.test(sql)) {
    return {
      pattern_id: 'HAVING_NO_GROUP_BY',
      severity: 'medium',
      table: null,
      column: null,
      node_path: null,
      suggestion: 'Replace HAVING with WHERE. Use HAVING only when filtering on aggregate results (e.g. HAVING COUNT(*) > 5)',
      rationale: 'HAVING without GROUP BY applies to the entire result set as a single group — almost always a mistake',
      rewrite_template: null,
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

// R10 — Correlated subquery in SELECT list
function detectR10(sql) {
  const selectIdx = sql.search(/\bSELECT\b/i);
  if (selectIdx < 0) return null;
  const afterSelect = sql.slice(selectIdx + 6);
  let depth = 0;
  let fromPos = -1;
  for (let i = 0; i < afterSelect.length; i++) {
    const ch = afterSelect[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (
      depth === 0 &&
      i + 4 <= afterSelect.length &&
      afterSelect.slice(i, i + 4).toUpperCase() === 'FROM'
    ) {
      const before = i === 0 ? ' ' : afterSelect[i - 1];
      const after = i + 4 >= afterSelect.length ? ' ' : afterSelect[i + 4];
      if (/\W/.test(before) && /\W/.test(after)) {
        fromPos = i;
        break;
      }
    }
  }
  if (fromPos < 0) return null;
  const selectClause = afterSelect.slice(0, fromPos);
  if (/\(\s*SELECT/i.test(selectClause)) {
    return {
      pattern_id: 'CORRELATED_SUBQUERY_IN_SELECT',
      severity: 'high',
      table: null,
      column: null,
      node_path: null,
      suggestion: 'Rewrite using a LEFT JOIN or window function to bring the subquery result in as a joined column',
      rationale: 'Subquery in SELECT list re-executes for every outer row — O(n) subquery executions',
      rewrite_template: 'SELECT a.col, sub.val FROM a LEFT JOIN (SELECT ...) sub ON a.id = sub.a_id',
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

// R11 — COUNT(column) instead of COUNT(*)
function detectR11(sql) {
  // COUNT( followed by a column name (not * or 1)
  if (/\bCOUNT\s*\(\s*(?!\*\s*\)|1\s*\))[a-zA-Z_]/i.test(sql)) {
    return {
      pattern_id: 'COUNT_COLUMN_NOT_STAR',
      severity: 'low',
      table: null,
      column: null,
      node_path: null,
      suggestion: 'If NULL exclusion is not intentional, replace COUNT(column) with COUNT(*) — faster because it does not inspect column values. If intentional, add a comment',
      rationale: 'COUNT(column) skips NULLs adding per-row null-check overhead. COUNT(*) counts all rows without column inspection',
      rewrite_template: null,
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

// R12 — UNION instead of UNION ALL
function detectR12(sql) {
  // UNION not followed by ALL
  if (/\bUNION\b(?!\s+ALL\b)/i.test(sql)) {
    return {
      pattern_id: 'UNION_NOT_ALL',
      severity: 'medium',
      table: null,
      column: null,
      node_path: null,
      suggestion: 'If the two result sets are guaranteed disjoint, replace UNION with UNION ALL to skip the deduplication pass',
      rationale: 'UNION performs O(n log n) deduplication. UNION ALL is O(n) — use UNION only when deduplication is required',
      rewrite_template: null,
      forward_to_track2: false,
      forward_to_track2b: false,
      hint: null,
      index_ddl: null,
      track: 'sql_pattern',
    };
  }
  return null;
}

const DETECTORS = [
  detectR1, detectR2, detectR3, detectR4, detectR5, detectR6,
  detectR7, detectR8, detectR9, detectR10, detectR11, detectR12,
];

function analyzeSqlPatterns(sql) {
  if (!sql) return [];
  const normalized = normalizeSql(sql);
  const findings = [];
  for (const detect of DETECTORS) {
    const result = detect(normalized);
    if (result) findings.push(result);
  }
  return findings;
}

module.exports = { analyzeSqlPatterns };
