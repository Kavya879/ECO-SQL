/**
 * Track 1 — EXPLAIN JSON Pattern Analysis
 * Walks the PostgreSQL EXPLAIN JSON plan tree and identifies optimization opportunities.
 * Patterns P1–P10 as defined in phase3-plan.md.
 */

function extractRootPlan(explainJson) {
  if (!explainJson) return null;
  let data = explainJson;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  // EXPLAIN (FORMAT JSON) returns: [{ "Plan": {...}, "Planning Time": ... }]
  if (Array.isArray(data)) data = data[0];
  if (data && data.Plan) return data.Plan;
  return data;
}

function traversePlan(node, cb, path) {
  if (!node || typeof node !== 'object') return;
  const nodeType = node['Node Type'] || '';
  const currentPath = path ? `${path}->${nodeType}` : nodeType;
  cb(node, currentPath);
  if (Array.isArray(node.Plans)) {
    node.Plans.forEach(child => traversePlan(child, cb, currentPath));
  }
}

function collectSubtreeNodes(node) {
  const nodes = [];
  traversePlan(node, (n) => nodes.push(n));
  return nodes;
}

function extractColumnsFromExpr(expr) {
  if (!expr) return [];
  const cols = [];
  const regex = /\b([a-zA-Z_]\w*)\s*(?:=|<|>|<=|>=|<>|!=|~~\*?|!~~\*?)/g;
  const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'null', 'true', 'false', 'any', 'all', 'like', 'ilike']);
  let m;
  while ((m = regex.exec(expr)) !== null) {
    const name = m[1].toLowerCase();
    if (!KEYWORDS.has(name)) cols.push(m[1]);
  }
  return [...new Set(cols)];
}

function detectFunctionInFilter(filterExpr) {
  if (!filterExpr) return null;
  const fnMatch = filterExpr.match(/\b(lower|upper|date|to_char|extract|coalesce|cast)\s*\(/i);
  if (!fnMatch) {
    // Only flag :: cast when it is applied to a column name (word characters before ::).
    // Filters like  payment_date >= '2007-01-01'::timestamp  have the cast on the constant,
    // not the column, so they should fall through to the plain P1 SEQ_SCAN handler instead.
    const colCastMatch = filterExpr.match(/\b([a-zA-Z_]\w*)\s*::/);
    if (!colCastMatch) return null;
    const col = colCastMatch[1];
    return { fn: 'cast', column: col, expression: col, hasCast: true };
  }
  const innerMatch = filterExpr.match(/\b(?:lower|upper|date|to_char|extract|coalesce|cast)\s*\(\s*([a-zA-Z_]\w*)/i);
  return {
    fn: fnMatch[1].toLowerCase(),
    column: innerMatch ? innerMatch[1] : null,
    expression: `${fnMatch[1].toLowerCase()}(${innerMatch ? innerMatch[1] : 'column'})`,
    hasCast: false,
  };
}

/**
 * Walk a plan node (and its children) to find the first real Relation Name or Alias.
 * Needed because Hash Join wraps its inner side in a Hash node (no Relation Name),
 * and outer sides of multi-table joins may also be intermediate join nodes.
 */
function firstRelationName(node) {
  if (!node) return null;
  if (node['Relation Name']) return node['Relation Name'];
  if (node['Alias']) return node['Alias'];
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) {
      const name = firstRelationName(child);
      if (name) return name;
    }
  }
  return null;
}

function analyzeExplainJson(explainJson) {
  const root = extractRootPlan(explainJson);
  if (!root) return [];

  const dedupMap = new Map();
  const SEV_ORDER = { high: 3, medium: 2, low: 1 };

  function addFinding(f) {
    const key = `${f.table || 'GLOBAL'}_${f.pattern_id}`;
    const existing = dedupMap.get(key);
    if (!existing || (SEV_ORDER[f.severity] || 0) > (SEV_ORDER[existing.severity] || 0)) {
      dedupMap.set(key, f);
    }
  }

  traversePlan(root, (node, path) => {
    const nodeType = String(node['Node Type'] || '');
    const table = String(node['Relation Name'] || '');
    const actualRows = Number(node['Actual Rows'] ?? node['Plan Rows'] ?? 0);
    const planRows = Number(node['Plan Rows'] ?? 0);
    const filterExpr = String(node['Filter'] || '');
    const rowsRemoved = Number(node['Rows Removed by Filter'] ?? 0);

    // ── P1 / P2 — Sequential scan (with optional function on filter) ──────
    if (nodeType === 'Seq Scan' && filterExpr) {
      const fnInfo = detectFunctionInFilter(filterExpr);
      if (fnInfo) {
        // P2 takes precedence — function/cast on filter column
        const col = fnInfo.column;
        const expr = fnInfo.expression || 'expression';
        addFinding({
          pattern_id: 'FUNC_ON_FILTER',
          severity: 'high',
          table,
          column: col,
          node_path: path,
          suggestion: `Create a functional index: CREATE INDEX ON ${table} (${expr})`,
          rationale: `Seq Scan on ${table}; function/cast in filter (${expr}) prevents B-tree index use`,
          forward_to_track2: true,
          forward_to_track2b: true,
          hint: table ? `IndexScan(${table})` : null,
          index_ddl: table ? `CREATE INDEX ON ${table} (${expr})` : null,
          track: 'explain_analysis',
        });
      } else {
        // P1 — plain sequential scan with filter
        const cols = extractColumnsFromExpr(filterExpr);
        const col = cols[0] || null;
        const sev = actualRows > 10000 ? 'high' : 'medium';
        addFinding({
          pattern_id: 'SEQ_SCAN_FILTER',
          severity: sev,
          table,
          column: col,
          node_path: path,
          suggestion: col
            ? `Add a B-tree index on ${table}(${col})`
            : `Add an index on the column(s) referenced in the filter on ${table}`,
          rationale: `Seq Scan on ${table}: examined ${actualRows.toLocaleString()} rows; filter removed ${rowsRemoved.toLocaleString()} rows`,
          forward_to_track2: true,
          forward_to_track2b: true,
          hint: table ? `IndexScan(${table})` : null,
          index_ddl: table && col ? `CREATE INDEX ON ${table}(${col})` : null,
          track: 'explain_analysis',
        });
      }
    }

    // ── P3 — Sort without supporting index ────────────────────────────────
    if (nodeType === 'Sort' && actualRows > 5000) {
      const sortKeys = Array.isArray(node['Sort Key']) ? node['Sort Key'] : (node['Sort Key'] ? [node['Sort Key']] : []);
      // Collect Index Scan tables in this subtree
      const subtreeNodes = Array.isArray(node.Plans)
        ? node.Plans.flatMap(p => collectSubtreeNodes(p))
        : [];
      const indexedTables = new Set(
        subtreeNodes.filter(n => n['Node Type'] === 'Index Scan').map(n => n['Relation Name'] || '')
      );
      const sortTable = table || (subtreeNodes[0] && subtreeNodes[0]['Relation Name']) || '';
      const cleanCols = sortKeys
        .map(s => s.replace(/\s+(DESC|ASC|NULLS\s+(FIRST|LAST))/gi, '').trim())
        .filter(Boolean);
      const sortCol = cleanCols[0] || null;

      if (sortTable && !indexedTables.has(sortTable)) {
        addFinding({
          pattern_id: 'SORT_NO_INDEX',
          severity: 'medium',
          table: sortTable,
          column: sortCol,
          node_path: path,
          suggestion: sortCol
            ? `Add an index on ${sortTable}(${sortCol}). If query also filters, make it composite: filter column first, sort column second`
            : `Add an index matching the sort key on ${sortTable}`,
          rationale: `Sort on ${actualRows.toLocaleString()} rows without a supporting index — O(n log n) sort work`,
          forward_to_track2: true,
          forward_to_track2b: true,
          hint: sortTable ? `IndexScan(${sortTable})` : null,
          index_ddl: sortTable && sortCol ? `CREATE INDEX ON ${sortTable}(${sortCol})` : null,
          track: 'explain_analysis',
        });
      }
    }

    // ── P4 — Nested loop on large outer set ───────────────────────────────
    if (nodeType === 'Nested Loop' && Array.isArray(node.Plans) && node.Plans.length >= 2) {
      const outerRows = Number(node.Plans[0]['Actual Rows'] ?? node.Plans[0]['Plan Rows'] ?? 0);
      if (outerRows > 1000) {
        const t1 = firstRelationName(node.Plans[0]) || 'table1';
        const t2 = firstRelationName(node.Plans[1]) || 'table2';
        const sev = outerRows >= 10000 ? 'high' : 'medium';
        addFinding({
          pattern_id: 'NESTED_LOOP_LARGE',
          severity: sev,
          table: t1,
          column: null,
          node_path: path,
          suggestion: `Ensure join columns on both ${t1} and ${t2} are indexed. Consider /*+ HashJoin(${t1} ${t2}) */ hint`,
          rationale: `Nested Loop with ${outerRows.toLocaleString()} outer rows (${t1} ⋈ ${t2}) — scales O(n×m)`,
          forward_to_track2: true,
          forward_to_track2b: true,
          hint: `HashJoin(${t1} ${t2})`,
          index_ddl: null,
          track: 'explain_analysis',
        });
      }
    }

    // ── P5 — Bad cardinality estimate ─────────────────────────────────────
    if (planRows > 0 && actualRows > 0) {
      const ratio = Math.max(actualRows / planRows, planRows / actualRows);
      if (ratio > 10) {
        const sev = ratio >= 100 ? 'high' : 'medium';
        const direction = actualRows > planRows
          ? `actual ${actualRows.toLocaleString()} >> planned ${planRows.toLocaleString()}`
          : `actual ${actualRows.toLocaleString()} << planned ${planRows.toLocaleString()}`;
        addFinding({
          pattern_id: 'BAD_CARDINALITY',
          severity: sev,
          table,
          column: null,
          node_path: path,
          suggestion: table
            ? `Run ANALYZE ${table}. If problem persists: ALTER TABLE ${table} ALTER COLUMN <col> SET STATISTICS 500`
            : 'Run ANALYZE on affected tables to refresh planner statistics',
          rationale: `Cardinality estimate off by ${ratio.toFixed(0)}×: ${direction}`,
          forward_to_track2: false,
          forward_to_track2b: false,
          hint: null,
          index_ddl: null,
          track: 'explain_analysis',
        });
      }
    }

    // ── P6 — CTE materialisation fence ───────────────────────────────────
    if (nodeType === 'CTE Scan') {
      const cteName = String(node['CTE Name'] || '');
      addFinding({
        pattern_id: 'CTE_FENCE',
        severity: 'medium',
        table: cteName,
        column: null,
        node_path: path,
        suggestion: `CTE "${cteName}" is materialised. If referenced once, inline as a subquery. Otherwise use: WITH ${cteName} AS NOT MATERIALIZED (...)`,
        rationale: 'CTE Scan forces materialisation — result is buffered before the outer query runs (PostgreSQL 12+ default)',
        forward_to_track2: false,
        forward_to_track2b: true,
        hint: 'Set(enable_material off)',
        index_ddl: null,
        track: 'explain_analysis',
      });
    }

    // ── P7 — Index scan with high filter removal ratio ────────────────────
    if (nodeType === 'Index Scan' && actualRows >= 0 && rowsRemoved > actualRows * 5) {
      const indexName = String(node['Index Name'] || '');
      const col1 = extractColumnsFromExpr(filterExpr)[0] || null;
      addFinding({
        pattern_id: 'INDEX_POOR_SELECTIVITY',
        severity: 'medium',
        table,
        column: col1,
        node_path: path,
        suggestion: `Index "${indexName}" is not selective enough. Create a composite index including the secondary filter column, or a partial index with a WHERE clause`,
        rationale: `Index Scan on ${table}: removed ${rowsRemoved.toLocaleString()} rows by filter vs ${actualRows.toLocaleString()} returned — index is over-wide`,
        forward_to_track2: true,
        forward_to_track2b: false,
        hint: null,
        index_ddl: table ? `CREATE INDEX ON ${table}(col1, col2)` : null,
        track: 'explain_analysis',
      });
    }

    // ── P8 — Hash join on tiny tables ─────────────────────────────────────
    if (nodeType === 'Hash Join' && Array.isArray(node.Plans) && node.Plans.length >= 2) {
      const r1 = Number(node.Plans[0]['Actual Rows'] ?? 0);
      const r2 = Number(node.Plans[1]['Actual Rows'] ?? 0);
      if (r1 < 100 && r2 < 100) {
        const t1 = firstRelationName(node.Plans[0]) || 'table1';
        const t2 = firstRelationName(node.Plans[1]) || 'table2';
        addFinding({
          pattern_id: 'HASH_JOIN_TINY',
          severity: 'low',
          table: t1,
          column: null,
          node_path: path,
          suggestion: `Hash Join overhead is unnecessary for tiny sets. Ensure join columns are indexed; planner should prefer Nested Loop`,
          rationale: `Hash Join on ${r1} × ${r2} rows — hash table build cost exceeds benefit for sets this small`,
          forward_to_track2: true,
          forward_to_track2b: true,
          hint: `NestLoop(${t1} ${t2})`,
          index_ddl: null,
          track: 'explain_analysis',
        });
      }
    }

    // ── P9 — Bitmap heap scan with many pages ─────────────────────────────
    if (nodeType === 'Bitmap Heap Scan' && actualRows > 50000) {
      const recheckCond = String(node['Recheck Cond'] || '');
      const col = extractColumnsFromExpr(recheckCond)[0] || null;
      addFinding({
        pattern_id: 'BITMAP_SCAN_LARGE',
        severity: 'medium',
        table,
        column: col,
        node_path: path,
        suggestion: `For low-cardinality columns consider a partial index per value. For high selectivity, a regular B-tree index may outperform the bitmap scan`,
        rationale: `Bitmap Heap Scan on ${table}: ${actualRows.toLocaleString()} rows — bitmap may require lossy storage with many heap fetches`,
        forward_to_track2: true,
        forward_to_track2b: false,
        hint: null,
        index_ddl: table && col && recheckCond
          ? `CREATE INDEX ON ${table}(${col}) WHERE ${recheckCond}`
          : (table && col ? `CREATE INDEX ON ${table}(${col})` : null),
        track: 'explain_analysis',
      });
    }

    // ── P10 — Descending sort with no Index Scan Backward ─────────────────
    if (nodeType === 'Sort') {
      const sortKeys = Array.isArray(node['Sort Key']) ? node['Sort Key'] : (node['Sort Key'] ? [node['Sort Key']] : []);
      const hasDesc = sortKeys.some(s => /\bDESC\b/i.test(s));
      if (hasDesc) {
        const subtreeNodes = Array.isArray(node.Plans)
          ? node.Plans.flatMap(p => collectSubtreeNodes(p))
          : [];
        const hasBackward = subtreeNodes.some(n => n['Node Type'] === 'Index Scan Backward');
        if (!hasBackward) {
          const descKey = sortKeys.find(s => /\bDESC\b/i.test(s)) || '';
          const cleanCol = descKey.replace(/\s+(DESC|ASC|NULLS\s+(FIRST|LAST))/gi, '').trim() || null;
          const sortTable = table || (subtreeNodes[0] && subtreeNodes[0]['Relation Name']) || '';
          if (sortTable) {
            addFinding({
              pattern_id: 'DESC_SORT_NO_INDEX',
              severity: 'low',
              table: sortTable,
              column: cleanCol,
              node_path: path,
              suggestion: cleanCol
                ? `An index on ${sortTable}(${cleanCol}) enables Index Scan Backward, eliminating this Sort node`
                : `Add an index on the descending sort column to enable Index Scan Backward`,
              rationale: 'Descending sort without Index Scan Backward — Sort node adds O(n log n) overhead',
              forward_to_track2: true,
              forward_to_track2b: true,
              hint: sortTable ? `IndexScan(${sortTable})` : null,
              index_ddl: sortTable && cleanCol ? `CREATE INDEX ON ${sortTable}(${cleanCol})` : null,
              track: 'explain_analysis',
            });
          }
        }
      }
    }
  });

  return Array.from(dedupMap.values());
}

module.exports = { analyzeExplainJson, extractRootPlan };
