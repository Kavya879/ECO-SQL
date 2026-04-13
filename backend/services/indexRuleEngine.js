/**
 * Index Rule Engine for QueryCarbon
 * Analyzes PostgreSQL EXPLAIN JSON plans to detect index-related anti-patterns
 * 
 * Each rule returns null if not triggered, or a violation object with findings
 */

/**
 * RC-001: Sequential Scan on Large Table
 * trigger: Node Type == "Seq Scan" AND Plan Rows > 10000
 * carbon reason: Full table scans read every page from disk, 10-100x the I/O of an index scan
 */
function checkRC001_SeqScanLargeTable(node, context = {}) {
  if (node.NodeType !== 'Seq Scan' || !node['Plans'] || node['Plans'].length > 0) {
    // Only check leaf nodes (no child plans)
    if (node['Plans'] && node['Plans'].length > 0) return null;
  }

  if (node.NodeType === 'Seq Scan' && node['Plan Rows'] && node['Plan Rows'] > 10000) {
    const runtime_reduction_pct = node['Plan Rows'] > 10000 ? 70 : 40;
    
    return {
      rule_id: 'RC-001',
      rule_name: 'Sequential Scan on Large Table',
      triggered: true,
      severity: 'HIGH',
      confidence: 'HIGH',
      carbon_reason: 'Full table scans read every page from disk, 10-100x the I/O of an index scan',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: node['Plan Rows'],
        actual_rows: node['Actual Rows'] || null,
      },
      recommendation: `Add a B-tree index on the filter/join column(s) for table '${node['Relation Name'] || 'unknown'}'. Plan is scanning ${node['Plan Rows']} rows.`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_${(node['Relation Name'] || 'table').toLowerCase()}_col ON ${node['Relation Name'] || 'table'}(col);`,
      runtime_reduction_pct,
      estimated_savings: {
        runtime_reduction_pct,
        cost_reduction_pct: Math.round(runtime_reduction_pct * 0.85 * 100) / 100,
        carbon_reduction_pct: Math.round(runtime_reduction_pct * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-002: Index Scan High Filter Discard
 * trigger: Node Type IN (Index Scan, Index Only Scan, Bitmap Index Scan) AND 
 *          (Rows Removed by Filter / Plan Rows) > 0.5
 * carbon reason: Fetching rows only to discard >50% wastes I/O proportional to discard ratio
 */
function checkRC002_IndexHighFilterDiscard(node, context = {}) {
  const indexTypes = ['Index Scan', 'Index Only Scan', 'Bitmap Index Scan'];
  
  if (!indexTypes.includes(node.NodeType)) return null;

  const rowsRemovedByFilter = node['Rows Removed by Filter'] || 0;
  const planRows = node['Plan Rows'] || 0;

  if (planRows > 0 && (rowsRemovedByFilter / planRows) > 0.5) {
    const discardRatio = (rowsRemovedByFilter / planRows);
    
    return {
      rule_id: 'RC-002',
      rule_name: 'Index Scan High Filter Discard',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Fetching rows only to discard >50% wastes I/O proportional to discard ratio',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        rows_removed: rowsRemovedByFilter,
        discard_ratio: Math.round(discardRatio * 100) / 100,
      },
      recommendation: `Add a partial or composite index. ${rowsRemovedByFilter} rows discarded post-fetch on '${node['Relation Name'] || 'unknown'}'.`,
      fix_suggestion: `CREATE INDEX idx_partial ON ${node['Relation Name'] || 'table'}(col) WHERE condition;`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-003: Bitmap Heap Scan Recheck on Large Set
 * trigger: Node Type == "Bitmap Heap Scan" AND Recheck Cond present AND Plan Rows > 50000
 * carbon reason: Recheck passes read pages twice, doubling I/O energy
 */
function checkRC003_BitmapHeapScanRecheck(node, context = {}) {
  if (node.NodeType !== 'Bitmap Heap Scan') return null;

  const hasRecheckCond = node['Recheck Cond'] || node['Recheckable Conds'] || node['Lossy Heap Blocks'];
  const planRows = node['Plan Rows'] || 0;

  if (hasRecheckCond && planRows > 50000) {
    return {
      rule_id: 'RC-003',
      rule_name: 'Bitmap Heap Scan Recheck on Large Set',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Recheck passes read pages twice, doubling I/O energy',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        has_recheck: true,
        lossy_pages: node['Lossy Heap Blocks'] || null,
      },
      recommendation: `Increase work_mem or use a covering index to reduce lossy bitmap pages for '${node['Relation Name'] || 'unknown'}'.`,
      fix_suggestion: `SET work_mem = '256MB'; or CREATE INDEX covering ON ${node['Relation Name'] || 'table'}(a,b,c);`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-004: Likely Unindexed Foreign Key
 * trigger: Node Type == "Seq Scan" AND Filter contains "_id" (case-insensitive) AND Plan Rows > 1000
 * carbon reason: Unindexed FK causes full scan on every JOIN iteration, multiplying I/O by outer_row_count
 */
function checkRC004_UnindexedForeignKey(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '').toLowerCase();
  const planRows = node['Plan Rows'] || 0;

  // Check if filter contains "_id" pattern (typical foreign key)
  const hasFKPattern = /_id\s*=|_id\s*>|_id\s*<|\s_id\s/.test(filter) && filter.length > 0;

  if (hasFKPattern && planRows > 1000) {
    return {
      rule_id: 'RC-004',
      rule_name: 'Likely Unindexed Foreign Key',
      triggered: true,
      severity: 'HIGH',
      confidence: 'LOW',
      carbon_reason: 'Unindexed FK causes full scan on every JOIN iteration, multiplying I/O by outer_row_count',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        filter: node.Filter || 'unknown',
      },
      recommendation: `Create an index on the FK column in filter of '${node['Relation Name'] || 'unknown'}'.`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_fk ON ${node['Relation Name'] || 'table'}(fk_col);`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-005: Poorly Selective Index
 * trigger: Node Type == "Index Scan" AND Total Cost > (planner_cost * 0.4) AND Plan Rows > 100000
 * carbon reason: Low-selectivity index reads large B-tree portions, nearly matching seq scan I/O
 */
function checkRC005_PoorlySelectiveIndex(node, context = {}) {
  if (node.NodeType !== 'Index Scan') return null;

  const totalCost = node['Total Cost'] || 0;
  const planRows = node['Plan Rows'] || 0;
  const plannerCost = context.planner_cost || 5000;

  if (totalCost > (plannerCost * 0.4) && planRows > 100000) {
    const selectivityRatio = planRows > 0 ? totalCost / planRows : 0;

    return {
      rule_id: 'RC-005',
      rule_name: 'Poorly Selective Index',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'LOW',
      carbon_reason: 'Low-selectivity index reads large B-tree portions, nearly matching seq scan I/O',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        total_cost: totalCost,
        selectivity_ratio: Math.round(selectivityRatio * 100) / 100,
      },
      recommendation: `Evaluate a more selective composite index for '${node['Relation Name'] || 'unknown'}'.`,
      fix_suggestion: `Query pg_stats for column selectivity before adding index. Consider: CREATE INDEX idx_composite ON ${node['Relation Name'] || 'table'}(col1, col2);`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-006: Nested Loop Join Without Index
 * trigger: Node Type == "Nested Loop" AND inner child is Seq Scan AND outer_rows * inner_rows > 1M
 * carbon reason: Nested loops scan inner table for every outer row; unindexed inner scan multiplies I/O N*M
 */
function checkRC006_NestedLoopWithoutIndex(node, context = {}) {
  if (node.NodeType !== 'Nested Loop') return null;
  if (!node.Plans || node.Plans.length < 2) return null;

  const outerRows = node.Plans[0]['Plan Rows'] || 1;
  const innerChild = node.Plans[1];
  const innerIsSeqScan = innerChild.NodeType === 'Seq Scan';
  const innerRows = innerChild['Plan Rows'] || 1;
  const totalCartesian = outerRows * innerRows;

  if (innerIsSeqScan && totalCartesian > 1000000) {
    return {
      rule_id: 'RC-006',
      rule_name: 'Nested Loop Join Without Index',
      triggered: true,
      severity: 'HIGH',
      confidence: 'HIGH',
      carbon_reason: 'Nested loops scan inner table for every outer row; unindexed inner scan multiplies I/O by N*M',
      affected_node: {
        type: node.NodeType,
        inner_table: innerChild['Relation Name'] || 'unknown',
        outer_rows: outerRows,
        inner_rows: innerRows,
        cartesian_product: totalCartesian,
      },
      recommendation: `Create an index on the join key in '${innerChild['Relation Name'] || 'unknown'}' to enable index-based nested loop.`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_join_key ON ${innerChild['Relation Name'] || 'table'}(join_key);`,
      runtime_reduction_pct: 65,
      estimated_savings: {
        runtime_reduction_pct: 65,
        cost_reduction_pct: 55.25,
        carbon_reduction_pct: Math.round(65 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-007: Hash Aggregate on Very Large Set
 * trigger: Node Type == "HashAggregate" AND Plan Rows > 100000 AND work_mem context not high
 * carbon reason: Hash tables for large groups spill to disk repeatedly; disk I/O 100-1000x slower than RAM
 */
function checkRC007_HashAggregateOnLargeSet(node, context = {}) {
  if (node.NodeType !== 'HashAggregate') return null;

  const planRows = node['Plan Rows'] || 0;
  const spandBytes = node['Rows' ] || 0;

  if (planRows > 100000) {
    return {
      rule_id: 'RC-007',
      rule_name: 'Hash Aggregate on Very Large Set',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'Hash tables for large groups spill to disk; disk I/O is 100-1000x slower than RAM',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        group_count: node['Plans']?.[0]?.['Actual Rows'] || planRows,
      },
      recommendation: `Increase work_mem (SET work_mem = '512MB') or partition aggregation to reduce hash table spillover.`,
      fix_suggestion: `SET work_mem = '512MB'; EXPLAIN ANALYZE <query>; -- Monitor Disk spills`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-008: Merge Join on Unsorted Input
 * trigger: Node Type == "Merge Join" AND child node is Sort (not index-ordered)
 * carbon reason: Materialized sort result stays in memory/disk; merge then scans sequentially on unsorted data
 */
function checkRC008_MergeJoinUnsortedInput(node, context = {}) {
  if (node.NodeType !== 'Merge Join') return null;
  if (!node.Plans || node.Plans.length < 2) return null;

  const hasSort = node.Plans.some(p => p.NodeType === 'Sort');
  const totalCost = node['Total Cost'] || 0;

  if (hasSort && totalCost > 1000) {
    return {
      rule_id: 'RC-008',
      rule_name: 'Merge Join on Unsorted Input',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      carbon_reason: 'Materialized sort result stays in memory; merge then scans on unsorted data duplicates I/O',
      affected_node: {
        type: node.NodeType,
        total_cost: totalCost,
        sort_inside: true,
      },
      recommendation: `Add indexes on join keys to provide natural sort order without explicit Sort nodes.`,
      fix_suggestion: `CREATE INDEX idx_${(node.Plans[0]['Relation Name'] || 'table').toLowerCase()}_join_key ON ${node.Plans[0]['Relation Name'] || 'table'}(join_key);`,
      runtime_reduction_pct: 35,
      estimated_savings: {
        runtime_reduction_pct: 35,
        cost_reduction_pct: 29.75,
        carbon_reduction_pct: Math.round(35 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-009: Cartesian Product Risk (Join Without Condition)
 * trigger: Node Type == "Nested Loop" or "Hash Join" and no join condition detected, Plan Rows > 1M
 * carbon reason: Cartesian product reads all rows from both tables; I/O and CPU scale as rows^2
 */
function checkRC009_CartesianProductRisk(node, context = {}) {
  const joinTypes = ['Nested Loop', 'Hash Join', 'Merge Join'];
  if (!joinTypes.includes(node.NodeType)) return null;

  const planRows = node['Plan Rows'] || 0;
  const joinCond = node['Join Filter'] || node['Merge Cond'] || node['Hash Cond'] || '';

  if (planRows > 1000000 && !joinCond) {
    return {
      rule_id: 'RC-009',
      rule_name: 'Cartesian Product Risk',
      triggered: true,
      severity: 'CRITICAL',
      confidence: 'MEDIUM',
      carbon_reason: 'Cartesian product reads all table rows; I/O and CPU scale as rows^2',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        join_condition: joinCond || 'MISSING',
      },
      recommendation: `Add missing join condition. Query is likely missing WHERE or ON clause connecting tables.`,
      fix_suggestion: `-- Check query: SELECT * FROM table1 JOIN table2 ON table1.id = table2.id (fix join condition)`,
      runtime_reduction_pct: 90,
      estimated_savings: {
        runtime_reduction_pct: 90,
        cost_reduction_pct: 76.5,
        carbon_reduction_pct: Math.round(90 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-010: Hash Join on Skewed Distribution
 * trigger: Node Type == "Hash Join" AND Plan Rows significantly > actual_rows (>10x)
 * carbon reason: Hash table built for large estimated groups; actual data skew causes bucket collisions, slow lookups
 */
function checkRC010_HashJoinSkewedDistribution(node, context = {}) {
  if (node.NodeType !== 'Hash Join') return null;

  const planRows = node['Plan Rows'] || 1;
  const actualRows = node['Actual Rows'] || planRows;
  const estimationError = actualRows > 0 ? planRows / actualRows : 0;

  if (estimationError > 10 || (actualRows === 0 && planRows > 100000)) {
    return {
      rule_id: 'RC-010',
      rule_name: 'Hash Join on Skewed Distribution',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Hash table built for estimated groups; data skew causes bucket collisions, slow lookups',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        actual_rows: actualRows,
        estimation_error: Math.round(estimationError * 100) / 100,
      },
      recommendation: `Update table statistics: ANALYZE table_name; Then reconsider hash vs merge join.`,
      fix_suggestion: `ANALYZE ${(node.Plans?.[0]?.['Relation Name'] || 'table').toLowerCase()}; -- Replan query`,
      runtime_reduction_pct: 25,
      estimated_savings: {
        runtime_reduction_pct: 25,
        cost_reduction_pct: 21.25,
        carbon_reduction_pct: Math.round(25 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-011: Index Join on Low Cardinality
 * trigger: Node Type == "Nested Loop" + inner Index Scan AND total Plan Rows < 100
 * carbon reason: Index overhead (B-tree traversal) dominates cost when result set is tiny; seq scan faster
 */
function checkRC011_IndexJoinOnLowCardinality(node, context = {}) {
  if (node.NodeType !== 'Nested Loop') return null;
  if (!node.Plans || node.Plans.length < 2) return null;

  const planRows = node['Plan Rows'] || 0;
  const innerChild = node.Plans[1];
  const innerIsIndex = innerChild.NodeType && innerChild.NodeType.includes('Index');

  if (innerIsIndex && planRows < 100 && planRows > 0) {
    return {
      rule_id: 'RC-011',
      rule_name: 'Index Join on Low Cardinality',
      triggered: true,
      severity: 'LOW',
      confidence: 'MEDIUM',
      carbon_reason: 'Index overhead (B-tree traversal) dominates cost when result set is tiny',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        inner_index_type: innerChild.NodeType,
      },
      recommendation: `Consider sequential scan for small result sets; index overhead may not be worth B-tree traversal.`,
      fix_suggestion: `SET random_page_cost = 0.1; -- Try hash/nested loop without index for comparison`,
      runtime_reduction_pct: 10,
      estimated_savings: {
        runtime_reduction_pct: 10,
        cost_reduction_pct: 8.5,
        carbon_reduction_pct: Math.round(10 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-012: Cross Join with Filter
 * trigger: Node Type contains "Join" AND Join Filter exists AND Plan Rows > 100000
 * carbon reason: Cross join (all combinations) then filter applies condition post-multiplication; redundant I/O
 */
function checkRC012_CrossJoinWithFilter(node, context = {}) {
  if (!node.NodeType || !node.NodeType.includes('Join')) return null;

  const planRows = node['Plan Rows'] || 0;
  const joinFilter = node['Join Filter'] || '';
  const hashCond = node['Hash Cond'] || '';
  const mergeCond = node['Merge Cond'] || '';

  // Detect cross join (no hash/merge condition) with post-join filter
  if (planRows > 100000 && joinFilter && !hashCond && !mergeCond) {
    return {
      rule_id: 'RC-012',
      rule_name: 'Cross Join with Filter',
      triggered: true,
      severity: 'HIGH',
      confidence: 'HIGH',
      carbon_reason: 'Cross join (all combinations) then filter applies condition post-multiplication',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        join_filter: joinFilter.substring(0, 50),
      },
      recommendation: `Move JOIN filter into ON clause: FROM table1 JOIN table2 ON condition instead of WHERE after join.`,
      fix_suggestion: `-- Refactor: FROM t1 JOIN t2 ON t1.col = t2.col instead of FROM t1, t2 WHERE t1.col = t2.col`,
      runtime_reduction_pct: 70,
      estimated_savings: {
        runtime_reduction_pct: 70,
        cost_reduction_pct: 59.5,
        carbon_reduction_pct: Math.round(70 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-013: Stale Table Statistics
 * trigger: Plan Rows differs from Actual Rows by >5x consistently OR last_vacuum is very old
 * carbon reason: Stale stats cause planner to choose slow plans; cascading into worse join orders, bad indexes
 */
function checkRC013_StaleTableStatistics(node, context = {}) {
  const planRows = node['Plan Rows'] || 1;
  const actualRows = node['Actual Rows'] || planRows;
  
  if (actualRows === 0) return null;
  
  const estimationError = planRows / actualRows;
  
  if (estimationError > 5 || estimationError < 0.2) {
    return {
      rule_id: 'RC-013',
      rule_name: 'Stale Table Statistics',
      triggered: true,
      severity: 'HIGH',
      confidence: 'HIGH',
      carbon_reason: 'Stale stats cause planner to choose slow plans; cascading into worse join orders, indexes',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        actual_rows: actualRows,
        error_factor: Math.round(estimationError * 100) / 100,
      },
      recommendation: `Run ANALYZE on '${node['Relation Name'] || 'unknown'}' to refresh statistics.`,
      fix_suggestion: `ANALYZE ${node['Relation Name'] || 'table'}; -- Then replan with updated stats`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-014: Missing Column Statistics
 * trigger: Node Filter references column with unknown selectivity OR histogram missing
 * carbon reason: Planner estimates 1/N cardinality (worst case); chooses seq scan over selective index
 */
function checkRC014_MissingColumnStatistics(node, context = {}) {
  if (!node.Filter) return null;

  const filter = node.Filter || '';
  const planRows = node['Plan Rows'] || 0;
  const nodeType = node.NodeType;

  // Heuristic: Seq Scan with large plan rows + complex filter suggests missing stats
  if (nodeType === 'Seq Scan' && planRows > 50000 && filter.length > 30) {
    return {
      rule_id: 'RC-014',
      rule_name: 'Missing Column Statistics',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Planner estimates 1/N cardinality; chooses seq scan over selective index',
      affected_node: {
        type: nodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        filter: filter.substring(0, 40),
      },
      recommendation: `Update statistics on specific column: ALTER TABLE table_name ALTER COLUMN col SET STATISTICS 100;`,
      fix_suggestion: `ALTER TABLE ${node['Relation Name'] || 'table'} ALTER COLUMN col SET STATISTICS 100; ANALYZE;`,
      runtime_reduction_pct: 35,
      estimated_savings: {
        runtime_reduction_pct: 35,
        cost_reduction_pct: 29.75,
        carbon_reduction_pct: Math.round(35 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-015: Table Bloat from Excessive Updates
 * trigger: Seq Scan on table with Plan Rows > actual_rows * 10 (dead tuples)
 * carbon reason: VACUUM removes dead tuples; without it, seq scans read tombstones, wasting I/O
 */
function checkRC015_TableBloat(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const planRows = node['Plan Rows'] || 1;
  const actualRows = node['Actual Rows'] || planRows;

  if (actualRows > 0 && (planRows / actualRows) > 10) {
    return {
      rule_id: 'RC-015',
      rule_name: 'Table Bloat from Excessive Updates',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Dead tuples waste I/O; VACUUM removes them but without AUTOVACUUM they accumulate',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        actual_rows: actualRows,
        bloat_ratio: Math.round((planRows / actualRows - 1) * 100) / 100,
      },
      recommendation: `Run VACUUM ANALYZE to reclaim space and update statistics.`,
      fix_suggestion: `VACUUM ANALYZE ${node['Relation Name'] || 'table'}; -- May require maintenance window`,
      runtime_reduction_pct: 45,
      estimated_savings: {
        runtime_reduction_pct: 45,
        cost_reduction_pct: 38.25,
        carbon_reduction_pct: Math.round(45 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-016: Index Bloat / Inefficiency
 * trigger: Index Scan with unusually high Total Cost vs expected I/O, suggestive of bloat
 * carbon reason: Bloated indexes have wasted leaf pages; scales linearly with table size
 */
function checkRC016_IndexBloat(node, context = {}) {
  const indexTypes = ['Index Scan', 'Index Only Scan', 'Bitmap Index Scan'];
  if (!indexTypes.includes(node.NodeType)) return null;

  const totalCost = node['Total Cost'] || 0;
  const planRows = node['Plan Rows'] || 1;
  const costPerRow = planRows > 0 ? totalCost / planRows : 0;

  if (costPerRow > 10 && planRows > 1000) {
    return {
      rule_id: 'RC-016',
      rule_name: 'Index Bloat / Inefficiency',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Bloated indexes have wasted leaf pages; poor cache locality wastes CPU cycles',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        total_cost: totalCost,
        plan_rows: planRows,
        cost_per_row: Math.round(costPerRow * 100) / 100,
      },
      recommendation: `Reindex to compact B-tree structure: REINDEX INDEX CONCURRENTLY idx_name;`,
      fix_suggestion: `REINDEX INDEX CONCURRENTLY idx_${(node['Relation Name'] || 'table').toLowerCase()};`,
      runtime_reduction_pct: 20,
      estimated_savings: {
        runtime_reduction_pct: 20,
        cost_reduction_pct: 17,
        carbon_reduction_pct: Math.round(20 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-017: Partial Vacuum Not Running
 * trigger: Seq Scan + Filter on column with many values that are rarely updated (no HOT updates)
 * carbon reason: Selective VACUUM on partial index leaves would reduce bloat without full table VACUUM cost
 */
function checkRC017_PartialVacuumOpportunity(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const hasFilter = (node.Filter || '').length > 0;
  const planRows = node['Plan Rows'] || 0;

  if (hasFilter && planRows > 10000) {
    return {
      rule_id: 'RC-017',
      rule_name: 'Partial Vacuum Opportunity',
      triggered: true,
      severity: 'LOW',
      confidence: 'LOW',
      carbon_reason: 'Selective VACUUM on condition leaves would reduce bloat without full table cost',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
      },
      recommendation: `Consider VACUUM (ANALYZE, VERBOSE) on partitions to reduce full-table maintenance.`,
      fix_suggestion: `-- Schedule: VACUUM ANALYZE partition_table; -- Lower overhead than full table`,
      runtime_reduction_pct: 15,
      estimated_savings: {
        runtime_reduction_pct: 15,
        cost_reduction_pct: 12.75,
        carbon_reduction_pct: Math.round(15 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-018: N+1 Query Pattern
 * trigger: Multiple sequential scans on same table or child nodes (Plans) depth > 3
 * carbon reason: Repeated table scans add redundant I/O; vectorized or cached results would multiply performance
 */
function checkRC018_N_Plus_One_Pattern(node, context = {}) {
  // Detect sign of deep nesting (proxy for correlated subqueries)
  let depth = 0;
  let current = node;
  while (current && current.Plans && current.Plans.length > 0) {
    depth++;
    current = current.Plans[0];
  }

  if (depth > 3) {
    return {
      rule_id: 'RC-018',
      rule_name: 'N+1 Query Pattern (Correlated Subquery Risk)',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'Deep nesting suggests correlated subqueries; repeated table scans multiply I/O',
      affected_node: {
        type: node.NodeType,
        nesting_depth: depth,
        plan_rows: node['Plan Rows'] || 0,
      },
      recommendation: `Refactor correlated subquery into JOIN or window function to avoid repeated scans.`,
      fix_suggestion: `-- Bad: SELECT (SELECT col FROM ref WHERE ref.id = t.id) FROM t; -- Good: SELECT ref.col FROM t LEFT JOIN ref ON ...`,
      runtime_reduction_pct: 60,
      estimated_savings: {
        runtime_reduction_pct: 60,
        cost_reduction_pct: 51,
        carbon_reduction_pct: Math.round(60 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-019: Histogram Skew Detection
 * trigger: Index Scan returns much fewer rows than expected OR planner miscalculated selectivity
 * carbon reason: When histogram is wrong, planner wastes I/O on wrong index choice
 */
function checkRC019_HistogramSkew(node, context = {}) {
  const indexTypes = ['Index Scan', 'Index Only Scan'];
  if (!indexTypes.includes(node.NodeType)) return null;

  const planRows = node['Plan Rows'] || 1;
  const actualRows = node['Actual Rows'] || planRows;
  const rowsRemovedFilter = node['Rows Removed by Filter'] || 0;

  if (actualRows > 0 && (planRows / actualRows) > 3 && rowsRemovedFilter > actualRows) {
    return {
      rule_id: 'RC-019',
      rule_name: 'Histogram Skew Detection',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'When histogram underestimates, planner makes wrong index choice; wastes I/O',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        actual_rows: actualRows,
        rows_discarded: rowsRemovedFilter,
      },
      recommendation: `Increase histogram sample depth: ALTER TABLE table_name SET (autovacuum_analyze_scale_factor = 0.01);`,
      fix_suggestion: `ALTER TABLE ${node['Relation Name'] || 'table'} SET (autovacuum_analyze_scale_factor = 0.01); ANALYZE;`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-020: Statistics on Volatile Function Results
 * trigger: Node Filter contains function calls (UPPER, LOWER, SUBSTRING, etc) + Seq Scan
 * carbon reason: Function results can't be cached in statistics; planner defaults to seq scan
 */
function checkRC020_VolatileFunctionInFilter(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '').toUpperCase();
  const hasFunctionCall = /UPPER\(|LOWER\(|SUBSTRING\(|COALESCE\(|CAST\(|DATE_TRUNC\(|EXTRACT\(/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasFunctionCall && planRows > 50000) {
    return {
      rule_id: 'RC-020',
      rule_name: 'Volatile Function in Filter',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Function results can\'t be cached in statistics; planner defaults to seq scan',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        filter: filter.substring(0, 40),
        plan_rows: planRows,
      },
      recommendation: `Create computed column or partial index: CREATE INDEX idx ON table((UPPER(col))) WHERE ...`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_upper ON ${node['Relation Name'] || 'table'}(UPPER(col));`,
      runtime_reduction_pct: 45,
      estimated_savings: {
        runtime_reduction_pct: 45,
        cost_reduction_pct: 38.25,
        carbon_reduction_pct: Math.round(45 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-021: Scalar Subquery in SELECT
 * trigger: SubPlan node type present AND correlated (references outer query columns)
 * carbon reason: Scalar subqueries execute once per output row; repeated table scans scale O(n)
 */
function checkRC021_ScalarSubqueryInSelect(node, context = {}) {
  if (node.NodeType !== 'SubPlan') return null;

  const planRows = node['Plan Rows'] || 0;
  const parentPlanRows = context.parent_rows || 1;

  if (planRows > 0 && parentPlanRows > 100) {
    return {
      rule_id: 'RC-021',
      rule_name: 'Scalar Subquery in SELECT',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'Scalar subqueries execute once per output row; repeated scans scale as O(n)',
      affected_node: {
        type: node.NodeType,
        parent_rows: parentPlanRows,
        subquery_cost_multiplier: Math.round((planRows * parentPlanRows) / (planRows + parentPlanRows)),
      },
      recommendation: `Convert to LEFT JOIN with GROUP BY or use window function instead.`,
      fix_suggestion: `-- Bad: SELECT (SELECT max(val) FROM ref WHERE ref.id = t.id), -- Good: SELECT window_func() OVER (PARTITION BY id)`,
      runtime_reduction_pct: 75,
      estimated_savings: {
        runtime_reduction_pct: 75,
        cost_reduction_pct: 63.75,
        carbon_reduction_pct: Math.round(75 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-022: Correlated Subquery in WHERE
 * trigger: SubPlan node + Filter references outer column name
 * carbon reason: Each outer row triggers subquery; nested loop on filter, scales as O(n^2)
 */
function checkRC022_CorrelatedSubqueryInWhere(node, context = {}) {
  const hasSubplan = node.Plans && node.Plans.some(p => p.NodeType === 'SubPlan');
  const filter = (node.Filter || '').toUpperCase();
  const isCorrelated = /IN \(SELECT|EXISTS \(SELECT/.test(filter);

  if (hasSubplan && isCorrelated) {
    return {
      rule_id: 'RC-022',
      rule_name: 'Correlated Subquery in WHERE',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'Each outer row triggers subquery; nested loop execution scales as O(n^2)',
      affected_node: {
        type: node.NodeType,
        filter: filter.substring(0, 50),
        has_subplan: true,
      },
      recommendation: `Convert IN/EXISTS subquery to JOIN or use window function for correlation.`,
      fix_suggestion: `-- Bad: WHERE id IN (SELECT id FROM ref WHERE ...) -- Good: WHERE EXISTS (SELECT 1 FROM ref WHERE ref.id = t.id AND ...)`,
      runtime_reduction_pct: 80,
      estimated_savings: {
        runtime_reduction_pct: 80,
        cost_reduction_pct: 68,
        carbon_reduction_pct: Math.round(80 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-023: IN Subquery vs EXISTS
 * trigger: Node Filter contains "IN (SELECT" with large subquery result
 * carbon reason: IN requires materializing full subquery result; EXISTS short-circuits on first match
 */
function checkRC023_INSubqueryVsEXISTS(node, context = {}) {
  const filter = (node.Filter || '');
  const hasINSubquery = /IN\s*\(\s*SELECT/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasINSubquery && planRows > 10000) {
    return {
      rule_id: 'RC-023',
      rule_name: 'IN Subquery vs EXISTS',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'IN requires materializing subquery result; EXISTS short-circuits on first match',
      affected_node: {
        type: node.NodeType,
        filter: filter.substring(0, 50),
        plan_rows: planRows,
      },
      recommendation: `Convert IN subquery to EXISTS for better performance on large result sets.`,
      fix_suggestion: `-- Bad: WHERE id IN (SELECT id FROM ref WHERE cond) -- Good: WHERE EXISTS (SELECT 1 FROM ref WHERE ref.id = t.id AND cond)`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-024: LATERAL Subquery Overhead
 * trigger: Node type contains "Lateral" AND Plan Rows > 100000
 * carbon reason: LATERAL joins run subquery for each outer row; less optimized than regular subquery
 */
function checkRC024_LateralSubqueryOverhead(node, context = {}) {
  if (!node.NodeType || !node.NodeType.includes('Lateral')) return null;

  const planRows = node['Plan Rows'] || 0;

  if (planRows > 100000) {
    return {
      rule_id: 'RC-024',
      rule_name: 'LATERAL Subquery Overhead',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'LATERAL joins run subquery for each outer row; less optimized than regular subquery',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
      },
      recommendation: `Consider converting LATERAL join to regular JOIN or window function if possible.`,
      fix_suggestion: `-- Review query: LATERAL subqueries are complex; consider window fn: ROW_NUMBER() OVER (PARTITION BY ...)`,
      runtime_reduction_pct: 25,
      estimated_savings: {
        runtime_reduction_pct: 25,
        cost_reduction_pct: 21.25,
        carbon_reduction_pct: Math.round(25 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-025: Subquery Materialization Opportunity
 * trigger: Multiple references to same subquery in query (detected by repeated SubPlan nodes)
 * carbon reason: Without materialization, same subquery re-executes multiple times
 */
function checkRC025_SubqueryMaterializationOpportunity(node, context = {}) {
  // This would require analyzing full query tree; simplified heuristic here
  const hasMultiplePlans = node.Plans && node.Plans.length > 2;
  const subplanCount = node.Plans ? node.Plans.filter(p => p.NodeType === 'SubPlan').length : 0;

  if (subplanCount > 1) {
    return {
      rule_id: 'RC-025',
      rule_name: 'Subquery Materialization Opportunity',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'LOW',
      carbon_reason: 'Repeated subquery references cause multiple executions; materialize with CTE',
      affected_node: {
        type: node.NodeType,
        plan_count: node.Plans ? node.Plans.length : 0,
        subplan_count: subplanCount,
      },
      recommendation: `Use WITH (CTE) to materialize subquery once, then reference multiple times.`,
      fix_suggestion: `-- Good: WITH cte AS (SELECT ...) SELECT * FROM cte JOIN ... WHERE cte.col = ...`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-026: Aggregate Subquery Inefficiency
 * trigger: SubPlan node + aggregation (COUNT, SUM, etc) with GROUP BY on large set
 * carbon reason: Aggregate subqueries on large sets spill to work_mem; disk I/O 100-1000x slower
 */
function checkRC026_AggregateSubqueryInefficiency(node, context = {}) {
  if (node.NodeType !== 'SubPlan') return null;

  const planRows = node['Plan Rows'] || 0;
  const hasAggregate = node.Plans && node.Plans.some(p => p.NodeType && p.NodeType.includes('Aggregate'));

  if (hasAggregate && planRows > 100000) {
    return {
      rule_id: 'RC-026',
      rule_name: 'Aggregate Subquery Inefficiency',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Aggregate subqueries on large sets spill work_mem; disk I/O 100-1000x slower than RAM',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        has_aggregate: true,
      },
      recommendation: `Increase work_mem or refactor aggregate subquery into index-backed GROUP BY.`,
      fix_suggestion: `SET work_mem = '512MB'; EXPLAIN ANALYZE <query>; -- Check Disk spills`,
      runtime_reduction_pct: 45,
      estimated_savings: {
        runtime_reduction_pct: 45,
        cost_reduction_pct: 38.25,
        carbon_reduction_pct: Math.round(45 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-027: Expensive Subquery in HAVING
 * trigger: Node type is "GroupAggregate" or "HashAggregate" with HAVING clause complexity
 * carbon reason: HAVING filters post-aggregation; if it's expensive, it filters expensive groups
 */
function checkRC027_ExpensiveSubqueryInHaving(node, context = {}) {
  const aggTypes = ['GroupAggregate', 'HashAggregate'];
  if (!aggTypes.includes(node.NodeType)) return null;

  const planRows = node['Plan Rows'] || 0;
  const hasSubplan = node.Plans && node.Plans.some(p => p.NodeType === 'SubPlan');

  if (hasSubplan && planRows > 10000) {
    return {
      rule_id: 'RC-027',
      rule_name: 'Expensive Subquery in HAVING',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'HAVING filters post-aggregation; expensive conditions filter but cost already paid',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        has_subplan: true,
      },
      recommendation: `Move HAVING condition to WHERE (pre-aggregation) if possible to reduce group count.`,
      fix_suggestion: `-- Bad: GROUP BY col HAVING (SELECT count(*) FROM ref WHERE ref.id = t.id) > 10 -- Good: WHERE condition pre-group`,
      runtime_reduction_pct: 35,
      estimated_savings: {
        runtime_reduction_pct: 35,
        cost_reduction_pct: 29.75,
        carbon_reduction_pct: Math.round(35 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-028: Implicit Type Cast in Filter
 * trigger: Node Filter contains type mismatch patterns (col::numeric vs numeric index)
 * carbon reason: Implicit casts prevent index use; forces seq scan or index on cast(col)
 */
function checkRC028_ImplicitTypeCastInFilter(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '');
  const hasCast = /::|\bCAST\b|\bCONCATENATE\b/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasCast && planRows > 10000) {
    return {
      rule_id: 'RC-028',
      rule_name: 'Implicit Type Cast in Filter',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Implicit casts prevent index use; forces seq scan or expensive function-based index',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        filter: filter.substring(0, 50),
        plan_rows: planRows,
      },
      recommendation: `Store column in correct type or create functional index: CREATE INDEX idx ON table(col::type);`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_cast ON ${node['Relation Name'] || 'table'}(col::integer);`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-029: Function Call on Indexed Column
 * trigger: Node type is Seq Scan + Filter contains function on indexed column
 * carbon reason: Functions on indexed columns disable optimization; forces seq scan or expensive bitmap
 */
function checkRC029_FunctionOnIndexedColumn(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '').toUpperCase();
  const functionPattern = /UPPER\(|LOWER\(|EXTRACT\(|DATE_TRUNC\(|LENGTH\(|SUBSTRING\(|ABS\(/;
  const hasFunction = functionPattern.test(filter);
  const hasPotentialIndex = /WHERE/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasFunction && hasPotentialIndex && planRows > 10000) {
    return {
      rule_id: 'RC-029',
      rule_name: 'Function Call on Indexed Column',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Functions on indexed columns disable optimization; forces seq scan',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        filter: filter.substring(0, 40),
        plan_rows: planRows,
      },
      recommendation: `Create functional index or store pre-computed value: CREATE INDEX idx_upper ON table(UPPER(col));`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_func ON ${node['Relation Name'] || 'table'}(UPPER(col));`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-030: OR Condition Avoiding Index
 * trigger: Node Filter contains OR with multiple conditions, some involving indexed columns
 * carbon reason: OR can't use single index efficiently; requires bitmap union or seq scan
 */
function checkRC030_ORConditionAvoidingIndex(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '');
  const hasOR = /\sOR\s/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasOR && planRows > 50000) {
    return {
      rule_id: 'RC-030',
      rule_name: 'OR Condition Avoiding Index',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'OR can\'t use single index efficiently; requires bitmap union or seq scan',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        filter: filter.substring(0, 50),
        plan_rows: planRows,
      },
      recommendation: `Use UNION of indexed queries or composite index: CREATE INDEX idx ON table(col1, col2);`,
      fix_suggestion: `-- Bad: WHERE col1 = 1 OR col2 = 2 -- Good: (SELECT * FROM t WHERE col1 = 1) UNION ALL (SELECT * FROM t WHERE col2 = 2)`,
      runtime_reduction_pct: 35,
      estimated_savings: {
        runtime_reduction_pct: 35,
        cost_reduction_pct: 29.75,
        carbon_reduction_pct: Math.round(35 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-031: LIKE with Leading Wildcard
 * trigger: Node Filter contains LIKE '%...' (leading wildcard disables index)
 * carbon reason: Leading wildcard forces seq scan; B-tree can't optimize initial pattern
 */
function checkRC031_LikeWithLeadingWildcard(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '');
  const hasLeadingWildcard = /LIKE\s+'%|ILIKE\s+'%/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasLeadingWildcard && planRows > 10000) {
    return {
      rule_id: 'RC-031',
      rule_name: 'LIKE with Leading Wildcard',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Leading wildcard forces seq scan; B-tree can\'t optimize initial pattern',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        filter: filter.substring(0, 40),
        plan_rows: planRows,
      },
      recommendation: `Use trigram index with GIN for LIKE efficiency: CREATE INDEX idx_gin ON table USING GIN(col gin_trgm_ops);`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_trgm ON ${node['Relation Name'] || 'table'} USING GIN(col gin_trgm_ops);`,
      runtime_reduction_pct: 60,
      estimated_savings: {
        runtime_reduction_pct: 60,
        cost_reduction_pct: 51,
        carbon_reduction_pct: Math.round(60 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-032: Expensive GROUP BY on Large Cardinality
 * trigger: GroupAggregate/HashAggregate AND Plan Rows > 1M
 * carbon reason: GROUP BY with high cardinality creates large hash table; spills to disk
 */
function checkRC032_ExpensiveGroupByLargeCardinality(node, context = {}) {
  const aggTypes = ['GroupAggregate', 'HashAggregate'];
  if (!aggTypes.includes(node.NodeType)) return null;

  const planRows = node['Plan Rows'] || 0;
  const groupKey = node['Group Key'] || [];

  if (planRows > 1000000) {
    return {
      rule_id: 'RC-032',
      rule_name: 'Expensive GROUP BY on Large Cardinality',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'GROUP BY with high cardinality creates large hash table; spills to disk',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        group_key_count: Array.isArray(groupKey) ? groupKey.length : 0,
      },
      recommendation: `Reduce GROUP BY cardinality: filter pre-aggregation, or partition the aggregation.`,
      fix_suggestion: `-- Index on group columns or reduce dataset before GROUP BY: SELECT ... WHERE date > now() - interval '7 days' GROUP BY ...`,
      runtime_reduction_pct: 55,
      estimated_savings: {
        runtime_reduction_pct: 55,
        cost_reduction_pct: 46.75,
        carbon_reduction_pct: Math.round(55 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-033: Window Function on Unsorted Input
 * trigger: Node type contains "WindowAgg" AND child is Sort (not index-ordered)
 * carbon reason: Window functions on complex partitions require Sort node; materializes large intermediate
 */
function checkRC033_WindowFunctionUnsorted(node, context = {}) {
  if (node.NodeType !== 'WindowAgg') return null;
  if (!node.Plans || node.Plans.length === 0) return null;

  const childIsSort = node.Plans[0].NodeType === 'Sort';
  const childRows = node.Plans[0]['Plan Rows'] || 0;

  if (childIsSort && childRows > 100000) {
    return {
      rule_id: 'RC-033',
      rule_name: 'Window Function on Unsorted Input',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Window functions on unsorted input require Sort node; materializes large intermediate',
      affected_node: {
        type: node.NodeType,
        child_rows: childRows,
        has_sort: true,
      },
      recommendation: `Index partition/order columns to provide natural sort order without explicit Sort.`,
      fix_suggestion: `CREATE INDEX idx_part_ord ON table(partition_col, order_col);;`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-034: Duplicate Aggregation in Query
 * trigger: Multiple aggregate functions (COUNT, SUM, AVG) over same GROUP BY (detector heuristic)
 * carbon reason: Aggregating same groups multiple times; should combine into single aggregation
 */
function checkRC034_DuplicateAggregation(node, context = {}) {
  const aggTypes = ['GroupAggregate', 'HashAggregate'];
  if (!aggTypes.includes(node.NodeType)) return null;

  const aggregates = node['Aggregate Functions'] || [];
  const planRows = node['Plan Rows'] || 0;

  if (aggregates.length > 2 && planRows > 100000) {
    return {
      rule_id: 'RC-034',
      rule_name: 'Duplicate Aggregation Opportunity',
      triggered: true,
      severity: 'LOW',
      confidence: 'LOW',
      carbon_reason: 'Multiple aggregates over same groups; should combine into single scan',
      affected_node: {
        type: node.NodeType,
        aggregate_count: aggregates.length,
        plan_rows: planRows,
      },
      recommendation: `Combine multiple aggregates: SELECT COUNT(*), SUM(col1), AVG(col2) in single GROUP BY instead of separate queries.`,
      fix_suggestion: `-- Combine: SELECT COUNT(*) cnt, SUM(col1) s, AVG(col2) a FROM table GROUP BY gk;`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-035: DISTINCT Ordering Inefficiency
 * trigger: Node Filter contains DISTINCT AND Sort node is child
 * carbon reason: DISTINCT requires sort; if output is not needed sorted, add LIMIT to stop early
 */
function checkRC035_DISTINCTOrderingInefficiency(node, context = {}) {
  let current = node;
  let hasDistinctAndSort = false;
  let sortRows = 0;

  if (node.NodeType === 'Unique' && node.Plans && node.Plans[0]) {
    const child = node.Plans[0];
    if (child.NodeType === 'Sort') {
      hasDistinctAndSort = true;
      sortRows = child['Plan Rows'] || 0;
    }
  }

  if (hasDistinctAndSort && sortRows > 100000) {
    return {
      rule_id: 'RC-035',
      rule_name: 'DISTINCT Ordering Inefficiency',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'DISTINCT requires sort; if not sorted output needed, LIMIT can stop early',
      affected_node: {
        type: 'Unique/Sort',
        sort_rows: sortRows,
      },
      recommendation: `If full DISTINCT not needed, use LIMIT to reduce sort workload: SELECT DISTINCT col FROM t LIMIT 1000;`,
      fix_suggestion: `SELECT DISTINCT col FROM table LIMIT 1000; -- Stop sort early if possible`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-036: Expensive UNION Without ALL
 * trigger: Node type contains "Union" with plan_rows 2x larger than input (deduplication overhead)
 * carbon reason: UNION (no ALL) requires sorting for deduplication; ALL skips expensive sort
 */
function checkRC036_ExpensiveUNIONWithoutAll(node, context = {}) {
  if (!node.NodeType || !node.NodeType.includes('Union')) return null;

  const planRows = node['Plan Rows'] || 0;
  const parentPlans = node.Plans || [];
  const maxChildRows = Math.max(...parentPlans.map(p => p['Plan Rows'] || 0));

  if (planRows > maxChildRows * 1.5 && planRows > 100000) {
    return {
      rule_id: 'RC-036',
      rule_name: 'Expensive UNION Without ALL',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'UNION (no ALL) requires sorting for deduplication; UNION ALL skips expensive sort',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        max_child_rows: maxChildRows,
      },
      recommendation: `Use UNION ALL if duplicates are acceptable to avoid expensive sort/deduplication.`,
      fix_suggestion: `-- Change: UNION to UNION ALL if duplicate rows are OK`,
      runtime_reduction_pct: 60,
      estimated_savings: {
        runtime_reduction_pct: 60,
        cost_reduction_pct: 51,
        carbon_reduction_pct: Math.round(60 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-037: Work Memory Pressure
 * trigger: Node type Seq Scan/Index Scan with actual_rows >> plan_rows (work_mem overflow symptom)
 * carbon reason: work_mem spills trigger cache misses; disk I/O 100-1000x slower than L1 cache
 */
function checkRC037_WorkMemoryPressure(node, context = {}) {
  const planRows = node['Plan Rows'] || 1;
  const actualRows = node['Actual Rows'] || planRows;
  const workMemContext = context.work_mem || 100;

  // Heuristic: If actual vastly exceeds plan, likely work_mem overflow
  if (actualRows > planRows * 5 && actualRows > 500000) {
    return {
      rule_id: 'RC-037',
      rule_name: 'Work Memory Pressure',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'work_mem overflow causes disk spill; I/O 100-1000x slower than L1 cache',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        actual_rows: actualRows,
        overflow_signal: Math.round((actualRows / planRows) * 100) / 100,
      },
      recommendation: `Increase work_mem to prevent spill to disk: SET work_mem = '512MB' or higher.`,
      fix_suggestion: `SET work_mem = '1GB'; EXPLAIN ANALYZE <query>; -- Monitor "Disk:" line`,
      runtime_reduction_pct: 70,
      estimated_savings: {
        runtime_reduction_pct: 70,
        cost_reduction_pct: 59.5,
        carbon_reduction_pct: Math.round(70 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-038: Sequential Scan with High I/O Cost
 * trigger: Seq Scan + (Total Cost - Startup Cost) > 50000
 * carbon reason: High I/O cost indicates large scan; CPU energy for disk seek is dominant factor
 */
function checkRC038_SequentialScanHighIO(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const totalCost = node['Total Cost'] || 0;
  const startupCost = node['Startup Cost'] || 0;
  const ioCost = totalCost - startupCost;

  if (ioCost > 50000) {
    return {
      rule_id: 'RC-038',
      rule_name: 'Sequential Scan with High I/O Cost',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'High I/O cost indicates full scan; disk seek energy is dominant',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        io_cost: Math.round(ioCost * 100) / 100,
      },
      recommendation: `Add index on filter/join columns to reduce I/O cost.`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_col ON ${node['Relation Name'] || 'table'}(col);`,
      runtime_reduction_pct: 65,
      estimated_savings: {
        runtime_reduction_pct: 65,
        cost_reduction_pct: 55.25,
        carbon_reduction_pct: Math.round(65 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-039: Parallel Worker Overhead
 * trigger: Node contains "parallel_workers" > 2 AND total_cost / num_workers < 1000 (not enough work per worker)
 * carbon reason: Parallel workers add context switching, synchronization overhead; diminishing returns
 */
function checkRC039_ParallelWorkerOverhead(node, context = {}) {
  const parallelWorkers = node['parallel_workers'] || 0;
  const totalCost = node['Total Cost'] || 1;

  if (parallelWorkers > 2 && (totalCost / parallelWorkers) < 1000) {
    return {
      rule_id: 'RC-039',
      rule_name: 'Parallel Worker Overhead',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Too many workers for work size; context switching + sync overhead wastes CPU',
      affected_node: {
        type: node.NodeType,
        parallel_workers: parallelWorkers,
        cost_per_worker: Math.round((totalCost / parallelWorkers) * 100) / 100,
      },
      recommendation: `Reduce parallel worker count: SET max_parallel_workers_per_gather = 2;`,
      fix_suggestion: `SET max_parallel_workers_per_gather = 2; -- Reduce overhead`,
      runtime_reduction_pct: 15,
      estimated_savings: {
        runtime_reduction_pct: 15,
        cost_reduction_pct: 12.75,
        carbon_reduction_pct: Math.round(15 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-040: Shared Buffer Cache Misses
 * trigger: Multiple sequential scans on same table in plan (cache miss pattern)
 * carbon reason: Scanning same table multiple times forces re-reading from disk; buffer cache ineffective
 */
function checkRC040_SharedBufferCacheMisses(node, context = {}) {
  // Heuristic: Multiple Seq Scans on same relation indicates re-scanning
  let seqScans = 0;
  let relationName = '';
  
  const countSeqScans = (n) => {
    if (n.NodeType === 'Seq Scan') {
      seqScans++;
      if (!relationName) relationName = n['Relation Name'] || '';
    }
    if (n.Plans) {
      n.Plans.forEach(countSeqScans);
    }
  };
  
  countSeqScans(node);

  if (seqScans > 2 && relationName) {
    return {
      rule_id: 'RC-040',
      rule_name: 'Shared Buffer Cache Misses',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Scanning same table multiple times forces disk re-reads; buffer cache ineffective',
      affected_node: {
        type: 'Multiple Seq Scan',
        relation_name: relationName,
        seq_scan_count: seqScans,
      },
      recommendation: `Materialize first scan or use CTE: WITH cte AS (SELECT * FROM table WHERE ...) SELECT ... FROM cte ...`,
      fix_suggestion: `WITH cached_data AS (SELECT * FROM ${relationName || 'table'} WHERE cond) SELECT * FROM cached_data ...`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-041: Lock Contention Risk
 * trigger: Node shows high recheck cost OR multiple iterations (detected by large Recheck Cond)
 * carbon reason: Lock waits force idle CPU; multiple lock/unlock cycles waste energy
 */
function checkRC041_LockContentionRisk(node, context = {}) {
  const hasRecheckCond = node['Recheck Cond'] || node['Lossy Heap Blocks'];
  const planRows = node['Plan Rows'] || 0;
  const actualRows = node['Actual Rows'] || 0;

  // Recheck presence + large actual rows suggests lock overhead
  if (hasRecheckCond && actualRows > 100000) {
    return {
      rule_id: 'RC-041',
      rule_name: 'Lock Contention Risk',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'LOW',
      carbon_reason: 'Lock waits force idle CPU; multiple lock/unlock cycles waste energy',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        actual_rows: actualRows,
        has_recheck: true,
      },
      recommendation: `Reduce lock contention: Use row-level locking or serialization level appropriate to query.`,
      fix_suggestion: `-- Review: SET DEFAULT_TRANSACTION_ISOLATION = READ COMMITTED; -- Reduce lock duration`,
      runtime_reduction_pct: 20,
      estimated_savings: {
        runtime_reduction_pct: 20,
        cost_reduction_pct: 17,
        carbon_reduction_pct: Math.round(20 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-042: Inefficient Page Size Utilization
 * trigger: Index Scan with very few rows per page (detected by plan_rows / heap_blocks if available)
 * carbon reason: Low page utilization wastes I/O; each page read pays full disk seek cost
 */
function checkRC042_InefficientPageUtilization(node, context = {}) {
  const indexTypes = ['Index Scan', 'Index Only Scan'];
  if (!indexTypes.includes(node.NodeType)) return null;

  const planRows = node['Plan Rows'] || 0;
  const heapBlocks = node['Heap Blocks'] || node['Lossy Heap Blocks'] || 1;

  if (planRows > 0 && (planRows / (heapBlocks || 1)) < 10 && planRows > 100) {
    return {
      rule_id: 'RC-042',
      rule_name: 'Inefficient Page Utilization',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'LOW',
      carbon_reason: 'Low page density wastes I/O; each page read pays full disk seek energy',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        heap_blocks: heapBlocks,
        rows_per_block: Math.round((planRows / (heapBlocks || 1)) * 100) / 100,
      },
      recommendation: `Increase index fill factor or create composite index for better page packing.`,
      fix_suggestion: `CREATE INDEX idx_composite ON table(col1, col2) WITH (fillfactor = 90);`,
      runtime_reduction_pct: 15,
      estimated_savings: {
        runtime_reduction_pct: 15,
        cost_reduction_pct: 12.75,
        carbon_reduction_pct: Math.round(15 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-043: JIT Compilation Overhead on Repeated Execution
 * trigger: Node shows large rows processed + JIT/complex expression (detected via complex filter)
 * carbon reason: JIT compilation cost amortized over repetitions; single execution wastes energy on setup
 */
function checkRC043_JITCompilationOverhead(node, context = {}) {
  const filter = (node.Filter || '');
  const planRows = node['Plan Rows'] || 0;
  
  // Complex filter (many ANDs/ORs) suggests JIT might be triggered
  const complexFilterCount = (filter.match(/\sAND\s|\sOR\s/g) || []).length;

  if (complexFilterCount > 5 && planRows > 1000000) {
    return {
      rule_id: 'RC-043',
      rule_name: 'JIT Compilation Overhead on Repeated Execution',
      triggered: true,
      severity: 'LOW',
      confidence: 'LOW',
      carbon_reason: 'JIT setup cost wasted if query runs once; amortized over many repetitions',
      affected_node: {
        type: node.NodeType,
        filter_complexity: complexFilterCount,
        plan_rows: planRows,
      },
      recommendation: `For one-time queries, disable JIT: SET jit = off; For frequent queries, JIT is beneficial.`,
      fix_suggestion: `-- One-time: SET jit = off; -- Frequency >= 5x: SET jit_above_cost = 100000;`,
      runtime_reduction_pct: 5,
      estimated_savings: {
        runtime_reduction_pct: 5,
        cost_reduction_pct: 4.25,
        carbon_reduction_pct: Math.round(5 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-044: Denormalization Opportunity
 * trigger: Multiple joins on FK (e.g., 3+ joins on same table suggests missing denorm column)
 * carbon reason: Extra joins multiply I/O; denormalization adds small storage cost but eliminates scan
 */
function checkRC044_DenormalizationOpportunity(node, context = {}) {
  // Count joins to detect multi-join pattern
  let joinCount = 0;
  const countJoins = (n) => {
    if (n.NodeType && n.NodeType.includes('Join')) joinCount++;
    if (n.Plans) {
      n.Plans.forEach(countJoins);
    }
  };
  
  countJoins(node);

  if (joinCount >= 3 && node['Plan Rows'] && node['Plan Rows'] > 10000) {
    return {
      rule_id: 'RC-044',
      rule_name: 'Denormalization Opportunity',
      triggered: true,
      severity: 'LOW',
      confidence: 'MEDIUM',
      carbon_reason: 'Multiple joins multiply I/O; denormalized column adds storage but eliminates join',
      affected_node: {
        type: node.NodeType,
        join_count: joinCount,
        plan_rows: node['Plan Rows'],
      },
      recommendation: `Consider storing joined column in base table to eliminate join: ALTER TABLE t ADD COLUMN cached_value INT;`,
      fix_suggestion: `-- Denormalize: ALTER TABLE table ADD COLUMN cached_fk_value INT; -- Then populate and index`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-045: Partition Key Inefficiency
 * trigger: Partition pruning could apply but doesn't (detected via table scan on range query)
 * carbon reason: Scanning all partitions wastes I/O; pruning skips irrelevant partitions
 */
function checkRC045_PartitionKeyInefficiency(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const relationName = (node['Relation Name'] || '').toUpperCase();
  const filter = (node.Filter || '');
  const isOnPartitionLike = /DATE|TIME|YEAR|MONTH|CREATED|UPDATED/.test(filter) && relationName.includes('PARTITION');
  const planRows = node['Plan Rows'] || 0;

  if (isOnPartitionLike && planRows > 100000) {
    return {
      rule_id: 'RC-045',
      rule_name: 'Partition Key Inefficiency',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Scanning all partitions wastes I/O; pruning skips irrelevant partitions',
      affected_node: {
        type: node.NodeType,
        relation_name: relationName,
        plan_rows: planRows,
      },
      recommendation: `Ensure filter matches partition key to enable partition pruning: WHERE date >= ... AND ...`,
      fix_suggestion: `-- Verify: EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM ${relationName || 'table'} WHERE date >= '2024-01-01';`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-046: Inherited Table Penalty
 * trigger: Table inherits from parent (inheritance search slow) + large row count
 * carbon reason: Inheritance forces CHECK constraints; planner can't push filters to child tables
 */
function checkRC046_InheritedTablePenalty(node, context = {}) {
  // Heuristic: Detect via unusual check condition patterns or table name patterns
  const relationName = node['Relation Name'] || '';
  const planRows = node['Plan Rows'] || 0;
  const filter = (node.Filter || '').toUpperCase();

  // If table name suggests inheritance pattern (e.g., "table_child", "subtable")
  const isInheritedLike = /CHILD|SUB|DERIVED|_[0-9]+$/.test(relationName);

  if (isInheritedLike && planRows > 100000) {
    return {
      rule_id: 'RC-046',
      rule_name: 'Inherited Table Penalty',
      triggered: true,
      severity: 'LOW',
      confidence: 'MEDIUM',
      carbon_reason: 'Inheritance forces constraint checks; planner can\'t selectively prune',
      affected_node: {
        type: node.NodeType,
        relation_name: relationName,
        plan_rows: planRows,
      },
      recommendation: `If possible, migrate away from inheritance to partitioning: CREATE TABLE ... PARTITION BY ...`,
      fix_suggestion: `-- Partition instead: CREATE TABLE t (...) PARTITION BY RANGE (date_col);`,
      runtime_reduction_pct: 25,
      estimated_savings: {
        runtime_reduction_pct: 25,
        cost_reduction_pct: 21.25,
        carbon_reduction_pct: Math.round(25 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-047: Partial Index Applicability
 * trigger: Filter matches partial index predicate but index not used (large seq scan instead)
 * carbon reason: Partial indexes are smaller (less I/O) but planner sometimes ignores them
 */
function checkRC047_PartialIndexApplicability(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '');
  const statusPattern = /STATUS|ACTIVE|ENABLED|DELETED|ARCHIVED|SOFT_DELETE/i;
  const isStatusFilter = statusPattern.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (isStatusFilter && planRows > 50000) {
    return {
      rule_id: 'RC-047',
      rule_name: 'Partial Index Applicability',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Partial indexes are smaller; planner sometimes ignores them on status-like filters',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        filter: filter.substring(0, 40),
        plan_rows: planRows,
      },
      recommendation: `Create partial index on status column: CREATE INDEX idx ON table(col) WHERE status = 'active';`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_active ON ${node['Relation Name'] || 'table'}(col) WHERE status = 'active';`,
      runtime_reduction_pct: 45,
      estimated_savings: {
        runtime_reduction_pct: 45,
        cost_reduction_pct: 38.25,
        carbon_reduction_pct: Math.round(45 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-048: Covering Index Opportunity
 * trigger: Index Scan followed by Table Fetch (extra I/O for missing columns)
 * carbon reason: Covering index eliminates table lookup; with columns included, avoids heap access
 */
function checkRC048_CoveringIndexOpportunity(node, context = {}) {
  const indexTypes = ['Index Scan', 'Index Only Scan'];
  if (!indexTypes.includes(node.NodeType)) return null;

  const isIndexOnlyScan = node.NodeType === 'Index Only Scan';
  const planRows = node['Plan Rows'] || 0;
  const hasTableFetch = node['Filter'] && node['Relation Name'];

  // If it's not Index Only Scan but plan expects table fetch + filter, covering index could help
  if (!isIndexOnlyScan && planRows > 10000 && hasTableFetch) {
    return {
      rule_id: 'RC-048',
      rule_name: 'Covering Index Opportunity',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Covering index eliminates table fetch; reduces heap access I/O',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
      },
      recommendation: `Create covering index including needed columns: CREATE INDEX idx ON table(key_col) INCLUDE (col1, col2);`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_covering ON ${node['Relation Name'] || 'table'}(key_col) INCLUDE (col1, col2);`,
      runtime_reduction_pct: 35,
      estimated_savings: {
        runtime_reduction_pct: 35,
        cost_reduction_pct: 29.75,
        carbon_reduction_pct: Math.round(35 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-049: DISTINCT vs GROUP BY
 * trigger: Node type is Unique (DISTINCT) on large set where GROUP BY could replace it
 * carbon reason: DISTINCT requires dedup via sort; GROUP BY with empty agg list can be index-backed
 */
function checkRC049_DISTINCTvsGroupBy(node, context = {}) {
  if (node.NodeType !== 'Unique') return null;

  const planRows = node['Plan Rows'] || 0;
  const childIsSort = node.Plans && node.Plans[0] && node.Plans[0].NodeType === 'Sort';

  if (childIsSort && planRows > 100000) {
    return {
      rule_id: 'RC-049',
      rule_name: 'DISTINCT vs GROUP BY Efficiency',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'DISTINCT requires dedup sort; GROUP BY with index-backed aggregation faster',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        uses_sort: true,
      },
      recommendation: `Replace DISTINCT with GROUP BY for index utilization: SELECT DISTINCT col -> SELECT col FROM t GROUP BY col`,
      fix_suggestion: `-- Change: SELECT DISTINCT col FROM t -- To: SELECT col FROM t GROUP BY col`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-050: CTE Materialization Policy
 * trigger: CTE node with large result set that gets scanned multiple times
 * carbon reason: Non-materialized CTE scans inlined; materialized once then re-scanned is sometimes faster
 */
function checkRC050_CTEMaterializationPolicy(node, context = {}) {
  const nodeType = node.NodeType || '';
  const isCTE = nodeType.includes('CTE') || nodeType.includes('Recursion');

  if (isCTE && node['Plan Rows'] && node['Plan Rows'] > 100000) {
    return {
      rule_id: 'RC-050',
      rule_name: 'CTE Materialization Policy',
      triggered: true,
      severity: 'LOW',
      confidence: 'MEDIUM',
      carbon_reason: 'Non-materialized CTEs scanned multiple times; materialization trades I/O for memory',
      affected_node: {
        type: nodeType,
        plan_rows: node['Plan Rows'],
      },
      recommendation: `Force CTE materialization: SELECT /* cte_name */ * FROM (WITH cte AS (...) SELECT * FROM cte);`,
      fix_suggestion: `-- PostgreSQL 12+: WITH cte AS MATERIALIZED (SELECT ...) -- Or: CREATE TEMPORARY TABLE cte AS ...`,
      runtime_reduction_pct: 20,
      estimated_savings: {
        runtime_reduction_pct: 20,
        cost_reduction_pct: 17,
        carbon_reduction_pct: Math.round(20 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-051: LIMIT Placement Optimization
 * trigger: Sort node before LIMIT (should apply LIMIT before sort)
 * carbon reason: Sorting full result set then LIMITing wastes energy; apply LIMIT before sort
 */
function checkRC051_LimitPlacementOptimization(node, context = {}) {
  if (node.NodeType !== 'Limit') return null;
  if (!node.Plans || node.Plans.length === 0) return null;

  const childIsSort = node.Plans[0].NodeType === 'Sort';
  const sortRows = node.Plans[0]['Plan Rows'] || 0;
  const limitCount = node['Limit'] || 0;

  if (childIsSort && limitCount > 0 && sortRows > limitCount * 10) {
    return {
      rule_id: 'RC-051',
      rule_name: 'LIMIT Placement Optimization',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      carbon_reason: 'Sorting full result then LIMITing wastes energy; apply LIMIT before sort',
      affected_node: {
        type: node.NodeType,
        limit_count: limitCount,
        sort_rows: sortRows,
        wasted_sort: Math.round((sortRows - limitCount) / sortRows * 100),
      },
      recommendation: `Use ORDER BY with LIMIT directly; planner should apply LIMIT before full sort (top-N heapsort).`,
      fix_suggestion: `-- Already optimized: ORDER BY col DESC LIMIT 10; -- Ensure index supports column sort order`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-052: OR Condition Optimization via UNION
 * trigger: Filter contains "OR" with low combined selectivity (many rows match)
 * carbon reason: UNION of indexed queries faster than bitmap OR on low-selectivity predicates
 */
function checkRC052_ORConditionOptimizationUnion(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '');
  const hasOR = /\sOR\s/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasOR && planRows > 100000) {
    return {
      rule_id: 'RC-052',
      rule_name: 'OR Condition Optimization via UNION',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'UNION of indexed queries faster than bitmap OR on low-selectivity predicates',
      affected_node: {
        type: node.NodeType,
        filter: filter.substring(0, 50),
        plan_rows: planRows,
      },
      recommendation: `Convert OR to UNION of indexed queries: (SELECT from col1_index) UNION ALL (SELECT from col2_index)`,
      fix_suggestion: `(SELECT * FROM t WHERE col1 = 1) UNION ALL (SELECT * FROM t WHERE col2 = 2); -- Faster than OR on many rows`,
      runtime_reduction_pct: 45,
      estimated_savings: {
        runtime_reduction_pct: 45,
        cost_reduction_pct: 38.25,
        carbon_reduction_pct: Math.round(45 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-053: Expensive Outer Join
 * trigger: Node type is "Merge Left Join" or "Hash Left Join" with large result set
 * carbon reason: Outer joins retain all left rows even if no match; wastes I/O if match is rare
 */
function checkRC053_ExpensiveOuterJoin(node, context = {}) {
  if (!node.NodeType || (!node.NodeType.includes('Left Join') && !node.NodeType.includes('Right Join'))) return null;

  const planRows = node['Plan Rows'] || 0;
  const childRows = node.Plans ? Math.max(...node.Plans.map(p => p['Plan Rows'] || 0)) : 0;

  if (planRows > childRows * 1.5 && planRows > 100000) {
    return {
      rule_id: 'RC-053',
      rule_name: 'Expensive Outer Join',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Outer joins retain all left rows; wastes I/O if most won\'t match',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        max_child_rows: childRows,
      },
      recommendation: `Consider INNER JOIN if NULLs not needed; filter to matched rows reduces materialization.`,
      fix_suggestion: `-- Verify: COUNT(*) vs COUNT(right_col) to check match rate. If high, INNER JOIN is faster`,
      runtime_reduction_pct: 20,
      estimated_savings: {
        runtime_reduction_pct: 20,
        cost_reduction_pct: 17,
        carbon_reduction_pct: Math.round(20 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-054: Full Outer Join Overhead
 * trigger: Node type is "Merge Full Outer Join" (always expensive; requires materializing both sides)
 * carbon reason: Full outer joins can't short-circuit; materializes both tables before joining
 */
function checkRC054_FullOuterJoinOverhead(node, context = {}) {
  if (node.NodeType !== 'Merge Full Outer Join' && node.NodeType !== 'Hash Full Outer Join') return null;

  const planRows = node['Plan Rows'] || 0;

  if (planRows > 10000) {
    return {
      rule_id: 'RC-054',
      rule_name: 'Full Outer Join Overhead',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      carbon_reason: 'Full outer joins materialize both tables; can\'t short-circuit or prune',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
      },
      recommendation: `Avoid FULL OUTER JOIN if possible; use UNION of LEFT and RIGHT joins if needed for all rows.`,
      fix_suggestion: `-- Instead: SELECT ... FROM t1 LEFT JOIN t2 ON ... UNION SELECT ... FROM t1 RIGHT JOIN t2 ON ...`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-055: Complex Expression Evaluation Overhead
 * trigger: Filter contains many AND/OR/CASE operations + large result set
 * carbon reason: Complex filter evaluation on every row; simplify or move to WHERE to reduce per-row cost
 */
function checkRC055_ComplexExpressionEvaluation(node, context = {}) {
  const filter = (node.Filter || '');
  const caseCount = (filter.match(/CASE\s/gi) || []).length;
  const operatorCount = (filter.match(/\sAND\s|\sOR\s|\sNOT\s/gi) || []).length;
  const planRows = node['Plan Rows'] || 0;

  if ((caseCount > 2 || operatorCount > 5) && planRows > 1000000) {
    return {
      rule_id: 'RC-055',
      rule_name: 'Complex Expression Evaluation Overhead',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Complex filter evaluation on every row; CPU cost scales with result set size',
      affected_node: {
        type: node.NodeType,
        case_expressions: caseCount,
        logical_operators: operatorCount,
        plan_rows: planRows,
      },
      recommendation: `Simplify filter: use indexed columns, move logic to application, or pre-compute in separate column.`,
      fix_suggestion: `-- Simplify: Move CASE logic to application or materialized view for repeated use`,
      runtime_reduction_pct: 25,
      estimated_savings: {
        runtime_reduction_pct: 25,
        cost_reduction_pct: 21.25,
        carbon_reduction_pct: Math.round(25 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-056: Correlated Aggregate Subquery in SELECT (CRITICAL)
 * trigger: SubPlan in SELECT clause with aggregate + outer column reference (O(N×M) execution)
 * carbon reason: Executes aggregation per row; multiplies computation cost by outer row count
 */
function checkRC056_CorrelatedAggregateSubquery(node, context = {}) {
  if (node.NodeType !== 'SubPlan') return null;

  const hasAggregate = node.Plans && node.Plans.some(p => p.NodeType && p.NodeType.includes('Aggregate'));
  const parentRows = context.parent_rows || 1;
  const planRows = node['Plan Rows'] || 0;

  if (hasAggregate && parentRows > 100 && planRows > 1) {
    return {
      rule_id: 'RC-056',
      rule_name: 'Correlated Aggregate Subquery in SELECT',
      triggered: true,
      severity: 'CRITICAL',
      confidence: 'MEDIUM',
      carbon_reason: 'Executes aggregation per row (O(N×M)); multiplies computation cost by outer row count',
      affected_node: {
        type: node.NodeType,
        parent_rows: parentRows,
        has_aggregate: true,
        execution_multiplier: parentRows,
      },
      recommendation: `Replace correlated aggregate with JOIN + GROUP BY: SELECT ... FROM t1 LEFT JOIN (SELECT aggcol, id FROM t2 GROUP BY id) ...`,
      fix_suggestion: `-- Bad: SELECT (SELECT COUNT(*) FROM t2 WHERE t2.id = t1.id), t1.col FROM t1 -- Good: SELECT COUNT(*) OVER (PARTITION BY t2.id), ...`,
      runtime_reduction_pct: 80,
      estimated_savings: {
        runtime_reduction_pct: 80,
        cost_reduction_pct: 68,
        carbon_reduction_pct: Math.round(80 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-057: Repeated Table Scan via Correlated Subquery
 * trigger: Same relation_name scanned multiple times in subquery plan depth
 * carbon reason: Repeated scans of large table within same query; cache ineffective
 */
function checkRC057_RepeatedTableScanCorrelated(node, context = {}) {
  let relationScans = {};
  const countScansByTable = (n) => {
    if (n.NodeType === 'Seq Scan' && n['Relation Name']) {
      const tableName = n['Relation Name'];
      relationScans[tableName] = (relationScans[tableName] || 0) + 1;
    }
    if (n.Plans) {
      n.Plans.forEach(countScansByTable);
    }
  };
  
  countScansByTable(node);
  
  const tablesScannedMultipleTimes = Object.entries(relationScans).filter(([_, count]) => count > 2);

  if (tablesScannedMultipleTimes.length > 0) {
    const [tableName, scanCount] = tablesScannedMultipleTimes[0];
    return {
      rule_id: 'RC-057',
      rule_name: 'Repeated Table Scan via Correlated Subquery',
      triggered: true,
      severity: 'HIGH',
      confidence: 'HIGH',
      carbon_reason: 'Same table scanned multiple times within query; cache ineffective across scans',
      affected_node: {
        type: 'Multiple Seq Scan',
        table_name: tableName,
        scan_count: scanCount,
      },
      recommendation: `Pre-aggregate or use derived table instead of correlated subquery.`,
      fix_suggestion: `-- Good: WITH agg AS (SELECT ... FROM ${tableName} GROUP BY ...) SELECT ... FROM agg ...`,
      runtime_reduction_pct: 70,
      estimated_savings: {
        runtime_reduction_pct: 70,
        cost_reduction_pct: 59.5,
        carbon_reduction_pct: Math.round(70 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-058: Missing Pre-Aggregation Before Join
 * trigger: GroupAggregate/HashAggregate after Join (should aggregate first)
 * carbon reason: Aggregating post-join scales by cartesian product; pre-aggregation reduces rows before join
 */
function checkRC058_MissingPreAggregationBeforeJoin(node, context = {}) {
  const aggTypes = ['GroupAggregate', 'HashAggregate'];
  if (!aggTypes.includes(node.NodeType)) return null;

  const childIsJoin = node.Plans && node.Plans[0] && node.Plans[0].NodeType && node.Plans[0].NodeType.includes('Join');
  const planRows = node['Plan Rows'] || 0;

  if (childIsJoin && planRows > 100000) {
    return {
      rule_id: 'RC-058',
      rule_name: 'Missing Pre-Aggregation Before Join',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'Aggregating post-join scales by cartesian; pre-aggregation reduces rows first',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        operation_order: 'join_then_aggregate',
      },
      recommendation: `Aggregate first, then join: SELECT * FROM (SELECT gk, COUNT(*) cnt FROM t1 GROUP BY gk) a JOIN ...`,
      fix_suggestion: `-- Reorder: GROUP BY before JOIN to reduce intermediate result size`,
      runtime_reduction_pct: 60,
      estimated_savings: {
        runtime_reduction_pct: 60,
        cost_reduction_pct: 51,
        carbon_reduction_pct: Math.round(60 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-059: Aggregate Subquery Instead of JOIN
 * trigger: SubPlan with SUM/COUNT/AVG without LIMIT found in correlated position
 * carbon reason: Subquery aggregates repeated execution; JOIN with GROUP BY batches work
 */
function checkRC059_AggregateSubqueryInsteadOfJoin(node, context = {}) {
  if (node.NodeType !== 'SubPlan') return null;

  const hasAggregate = node.Plans && node.Plans.some(p => p.NodeType && p.NodeType.includes('Aggregate'));
  const planRows = node['Plan Rows'] || 0;
  const parentRows = context.parent_rows || 1;

  if (hasAggregate && parentRows > 100 && planRows > 0) {
    return {
      rule_id: 'RC-059',
      rule_name: 'Aggregate Subquery Instead of JOIN',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'Subquery aggregates repeated execution; JOIN + GROUP BY batches work',
      affected_node: {
        type: node.NodeType,
        parent_rows: parentRows,
        has_aggregate: true,
      },
      recommendation: `Replace with JOIN + GROUP BY: SELECT t1.*, SUM(t2.val) FROM t1 LEFT JOIN t2 ON t1.id = t2.id GROUP BY t1.id ...`,
      fix_suggestion: `-- Bad: (SELECT SUM(col) FROM t2 WHERE t2.id = t1.id) -- Good: LEFT JOIN t2 + GROUP BY`,
      runtime_reduction_pct: 75,
      estimated_savings: {
        runtime_reduction_pct: 75,
        cost_reduction_pct: 63.75,
        carbon_reduction_pct: Math.round(75 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-060: Scalar Subquery Multi-Row Risk
 * trigger: SubPlan without LIMIT 1 or aggregation (risk of returning >1 row)
 * carbon reason: Runtime error risk AND correctness; prevents query optimization
 */
function checkRC060_ScalarSubqueryMultiRowRisk(node, context = {}) {
  if (node.NodeType !== 'SubPlan') return null;

  const hasLimit = node['Limit'] || (context.sql_text && /LIMIT\s+1/.test(context.sql_text));
  const hasAggregate = node.Plans && node.Plans.some(p => p.NodeType && p.NodeType.includes('Aggregate'));
  const planRows = node['Plan Rows'] || 0;

  if (!hasLimit && !hasAggregate && planRows > 1) {
    return {
      rule_id: 'RC-060',
      rule_name: 'Scalar Subquery Multi-Row Risk',
      triggered: true,
      severity: 'CRITICAL',
      confidence: 'HIGH',
      carbon_reason: 'Runtime failure risk if subquery returns >1 row; prevents safe optimization',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        has_limit: false,
        has_aggregate: false,
      },
      recommendation: `Add LIMIT 1 or aggregation (MAX, MIN, etc.) to scalar subquery.`,
      fix_suggestion: `-- Safe: SELECT (SELECT MAX(id) FROM t2 WHERE t2.ref_id = t1.id LIMIT 1) FROM t1`,
      runtime_reduction_pct: 100, // Correctness/safety issue
      estimated_savings: {
        runtime_reduction_pct: 100,
        cost_reduction_pct: 85,
        carbon_reduction_pct: Math.round(100 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-061: Nested Loop Join on Large Tables
 * trigger: Node Type == "Nested Loop" AND outer_rows * inner_rows > 1M without index on inner
 * carbon reason: Nested loops scan inner table for every outer row; I/O scales exponentially
 */
function checkRC061_NestedLoopLargeTablesNoIndex(node, context = {}) {
  if (node.NodeType !== 'Nested Loop') return null;
  if (!node.Plans || node.Plans.length < 2) return null;

  const outerRows = node.Plans[0]['Plan Rows'] || 1;
  const innerChild = node.Plans[1];
  const innerRows = innerChild['Plan Rows'] || 1;
  const totalWork = outerRows * innerRows;
  const innerIsIndex = innerChild.NodeType && (innerChild.NodeType.includes('Index') || innerChild.NodeType.includes('Seq'));

  if (totalWork > 1000000 && innerChild.NodeType === 'Seq Scan') {
    return {
      rule_id: 'RC-061',
      rule_name: 'Nested Loop Join on Large Tables',
      triggered: true,
      severity: 'HIGH',
      confidence: 'HIGH',
      carbon_reason: 'Nested loops scan inner table for every outer row; I/O scales exponentially',
      affected_node: {
        type: node.NodeType,
        outer_rows: outerRows,
        inner_rows: innerRows,
        total_work: totalWork,
      },
      recommendation: `Use Hash Join or Merge Join for large nested loops: SET enable_nested_loop = off; or add index.`,
      fix_suggestion: `SET enable_nested_loop = off; SET enable_hash_join = on; -- Force hash join`,
      runtime_reduction_pct: 70,
      estimated_savings: {
        runtime_reduction_pct: 70,
        cost_reduction_pct: 59.5,
        carbon_reduction_pct: Math.round(70 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-062: Join Without Predicate (Implicit Cartesian)
 * trigger: Join node with no Hash Cond, Merge Cond, or Join Filter + Plan Rows > expected
 * carbon reason: Cartesian product multiplies I/O and CPU exponentially
 */
function checkRC062_JoinWithoutPredicate(node, context = {}) {
  const joinTypes = ['Hash Join', 'Nested Loop', 'Merge Join'];
  if (!joinTypes.includes(node.NodeType)) return null;

  const hashCond = node['Hash Cond'] || '';
  const mergeCond = node['Merge Cond'] || '';
  const joinFilter = node['Join Filter'] || '';
  const planRows = node['Plan Rows'] || 0;

  if (!hashCond && !mergeCond && !joinFilter && planRows > 1000000) {
    return {
      rule_id: 'RC-062',
      rule_name: 'Join Without Predicate (Implicit Cartesian)',
      triggered: true,
      severity: 'CRITICAL',
      confidence: 'HIGH',
      carbon_reason: 'Cartesian product multiplies I/O and CPU exponentially',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        join_condition: 'MISSING',
      },
      recommendation: `CRITICAL: Add missing join condition. Query likely has missing ON or WHERE clause.`,
      fix_suggestion: `-- Fix: SELECT * FROM t1 JOIN t2 ON t1.id = t2.id; -- Add join condition`,
      runtime_reduction_pct: 95,
      estimated_savings: {
        runtime_reduction_pct: 95,
        cost_reduction_pct: 80.75,
        carbon_reduction_pct: Math.round(95 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-063: Join Key Type Mismatch
 * trigger: Join key columns have different types (detected via implicit cast in join condition)
 * carbon reason: Type mismatch prevents index use on one side; forces seq scan or full hash
 */
function checkRC063_JoinKeyTypeMismatch(node, context = {}) {
  const joinTypes = ['Hash Join', 'Nested Loop', 'Merge Join'];
  if (!joinTypes.includes(node.NodeType)) return null;

  const hashCond = (node['Hash Cond'] || '') + (node['Merge Cond'] || '') + (node['Join Filter'] || '');
  const hasCast = /::|\bCAST\b/.test(hashCond);
  const planRows = node['Plan Rows'] || 0;

  if (hasCast && planRows > 10000) {
    return {
      rule_id: 'RC-063',
      rule_name: 'Join Key Type Mismatch',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Type mismatch prevents index use; forces seq scan or full hash table',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        join_condition: hashCond.substring(0, 40),
      },
      recommendation: `Align join key datatypes: Explicit CAST on smaller side or change column type.`,
      fix_suggestion: `-- Ensure: t1.id::int = t2.id (or fix source column type)`,
      runtime_reduction_pct: 45,
      estimated_savings: {
        runtime_reduction_pct: 45,
        cost_reduction_pct: 38.25,
        carbon_reduction_pct: Math.round(45 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-064: Redundant Join Elimination Opportunity
 * trigger: Join table columns not referenced in outer query output or filters
 * carbon reason: Unnecessary join adds I/O; removing unused join saves entire join cost
 */
function checkRC064_RedundantJoinElimination(node, context = {}) {
  const joinTypes = ['Hash Join', 'Nested Loop', 'Merge Join'];
  if (!joinTypes.includes(node.NodeType)) return null;

  // Heuristic: If join result has same rows as outer, inner table likely unused
  const planRows = node['Plan Rows'] || 0;
  const outerRows = node.Plans ? (node.Plans[0]['Plan Rows'] || 1) : 1;

  if (Math.abs(planRows - outerRows) < planRows * 0.05 && outerRows > 1000) {
    return {
      rule_id: 'RC-064',
      rule_name: 'Redundant Join Elimination Opportunity',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'LOW',
      carbon_reason: 'Unnecessary join adds I/O; removing unused join saves cost',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        outer_rows: outerRows,
      },
      recommendation: `Remove unused join: Check if joined table columns are truly needed in SELECT, WHERE, or GROUP BY.`,
      fix_suggestion: `-- Verify inner table is used; if not, remove: SELECT col1, col2 FROM t1 (remove unused t2 join)`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-065: Join on Non-Indexed Columns
 * trigger: Join Hash Cond references columns without index
 * carbon reason: Join without supporting indexes forces full hash table build
 */
function checkRC065_JoinOnNonIndexedColumns(node, context = {}) {
  const joinTypes = ['Hash Join', 'Nested Loop', 'Merge Join'];
  if (!joinTypes.includes(node.NodeType)) return null;

  const hashCond = node['Hash Cond'] || node['Merge Cond'] || node['Join Filter'] || '';
  const planRows = node['Plan Rows'] || 0;

  if (hashCond && planRows > 10000) {
    return {
      rule_id: 'RC-065',
      rule_name: 'Join on Non-Indexed Columns',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'LOW',
      carbon_reason: 'Join without supporting indexes forces full hash table build',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        join_keys: hashCond.substring(0, 50),
      },
      recommendation: `Add indexes on join key columns to enable better join strategies.`,
      fix_suggestion: `CREATE INDEX idx_t2_join_key ON t2(join_col); CREATE INDEX idx_t1_join_key ON t1(join_col);`,
      runtime_reduction_pct: 60,
      estimated_savings: {
        runtime_reduction_pct: 60,
        cost_reduction_pct: 51,
        carbon_reduction_pct: Math.round(60 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-066: Multi-Column Join Without Composite Index
 * trigger: Join on multiple columns without composite index support
 * carbon reason: Composite index scans more efficiently than separate indexes
 */
function checkRC066_MultiColumnJoinNoComposite(node, context = {}) {
  const joinTypes = ['Hash Join', 'Merge Join'];
  if (!joinTypes.includes(node.NodeType)) return null;

  const joinCond = node['Hash Cond'] || node['Merge Cond'] || '';
  const multiColumnJoin = (joinCond.match(/AND/g) || []).length > 0;
  const planRows = node['Plan Rows'] || 0;

  if (multiColumnJoin && planRows > 50000) {
    return {
      rule_id: 'RC-066',
      rule_name: 'Multi-Column Join Without Composite Index',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Composite index scans more efficiently than separate indexes',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        join_columns: (joinCond.match(/AND/g) || []).length + 1,
      },
      recommendation: `Create composite index on join columns: CREATE INDEX idx_composite ON table(col1, col2, ...);`,
      fix_suggestion: `CREATE INDEX idx_composite_join ON t2(join_col1, join_col2) WHERE ...;`,
      runtime_reduction_pct: 55,
      estimated_savings: {
        runtime_reduction_pct: 55,
        cost_reduction_pct: 46.75,
        carbon_reduction_pct: Math.round(55 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-067: Skewed Join Distribution
 * trigger: Hash Join with large hash table + estimation error > 5x (data skew)
 * carbon reason: Data skew causes bucket collisions; hash performance degrades sublinearly
 */
function checkRC067_SkewedJoinDistribution(node, context = {}) {
  if (node.NodeType !== 'Hash Join') return null;

  const planRows = node['Plan Rows'] || 1;
  const actualRows = node['Actual Rows'] || planRows;
  const estimationError = actualRows > 0 ? planRows / actualRows : 0;

  if (estimationError > 5 && planRows > 100000) {
    return {
      rule_id: 'RC-067',
      rule_name: 'Skewed Join Distribution',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Data skew causes hash bucket collisions; performance degrades',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        actual_rows: actualRows,
        skew_ratio: Math.round(estimationError * 100) / 100,
      },
      recommendation: `Update statistics (ANALYZE) or repartition join inputs for better distribution.`,
      fix_suggestion: `ANALYZE table1; ANALYZE table2; -- Refresh stats to improve planner estimates`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-068: Index Not Used Due to Function Wrapping
 * trigger: Seq Scan with Function in filter, but indexed column available
 * carbon reason: Functions on indexed columns prevent index use; forces seq scan
 */
function checkRC068_IndexNotUsedFunctionWrapping(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '').toUpperCase();
  const hasFunctionCall = /UPPER\(|LOWER\(|ABS\(|EXTRACT\(|SUBSTRING\(|LENGTH\(|COALESCE\(/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasFunctionCall && planRows > 10000) {
    return {
      rule_id: 'RC-068',
      rule_name: 'Index Not Used Due to Function Wrapping',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Functions on indexed columns disable index usage; forces seq scan',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        filter_has_function: true,
      },
      recommendation: `Create functional index: CREATE INDEX idx_func ON table(UPPER(col));`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_upper ON ${node['Relation Name'] || 'table'}(UPPER(col));`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-069: Index Not Used Due to Type Cast
 * trigger: Seq Scan with Cast in filter on indexed column
 * carbon reason: Type casts prevent index usage; forces seq scan on cast result
 */
function checkRC069_IndexNotUsedTypeCast(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '');
  const hasCast = /::|\bCAST\b/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasCast && planRows > 10000) {
    return {
      rule_id: 'RC-069',
      rule_name: 'Index Not Used Due to Type Cast',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Type casts on indexed columns disable index; forces seq scan',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        filter_has_cast: true,
      },
      recommendation: `Store column in correct type or create cast-based index: CREATE INDEX idx_cast ON table(col::int);`,
      fix_suggestion: `CREATE INDEX idx_int_cast ON ${node['Relation Name'] || 'table'}(col::integer);`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-070: Missing Covering Index
 * trigger: Index Scan with Filter (table fetch required) + large result set
 * carbon reason: Table fetches add I/O; covering index with INCLUDE eliminates heap access
 */
function checkRC070_MissingCoveringIndex(node, context = {}) {
  const indexTypes = ['Index Scan', 'Index Only Scan'];
  if (!indexTypes.includes(node.NodeType)) return null;

  const isIndexOnlyScan = node.NodeType === 'Index Only Scan';
  const hasFilter = (node.Filter || '').length > 0;
  const planRows = node['Plan Rows'] || 0;

  if (!isIndexOnlyScan && hasFilter && planRows > 10000) {
    return {
      rule_id: 'RC-070',
      rule_name: 'Missing Covering Index',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Table fetches add I/O; covering index with INCLUDE eliminates heap access',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        requires_heap_fetch: true,
      },
      recommendation: `Add INCLUDE clause to index for columns needed post-filter: CREATE INDEX idx ON table(key) INCLUDE (col1, col2);`,
      fix_suggestion: `CREATE INDEX idx_covering ON ${node['Relation Name'] || 'table'}(key_col) INCLUDE (filter_col1, filter_col2);`,
      runtime_reduction_pct: 35,
      estimated_savings: {
        runtime_reduction_pct: 35,
        cost_reduction_pct: 29.75,
        carbon_reduction_pct: Math.round(35 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-071: Over-Indexing (Write Penalty)
 * trigger: Table with many indexes (heuristic: plan contains 5+ index scans on same table)
 * carbon reason: Extra indexes slow writes; unused indexes waste maintenance overhead
 */
function checkRC071_OverIndexing(node, context = {}) {
  let indexScans = 0;
  const countIndexScans = (n) => {
    const indexTypes = ['Index Scan', 'Index Only Scan', 'Bitmap Index Scan'];
    if (indexTypes.includes(n.NodeType)) indexScans++;
    if (n.Plans) {
      n.Plans.forEach(countIndexScans);
    }
  };
  
  countIndexScans(node);

  if (indexScans > 4 && context.write_heavy) {
    return {
      rule_id: 'RC-071',
      rule_name: 'Over-Indexing (Write Penalty)',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'LOW',
      carbon_reason: 'Extra indexes slow writes; unused indexes waste maintenance overhead',
      affected_node: {
        type: 'Multiple Indexes',
        index_scan_count: indexScans,
      },
      recommendation: `Identify unused indexes using pg_stat_user_indexes and DROP unused ones.`,
      fix_suggestion: `-- Find unused: SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0; -- DROP unused`,
      runtime_reduction_pct: 20,
      estimated_savings: {
        runtime_reduction_pct: 20,
        cost_reduction_pct: 17,
        carbon_reduction_pct: Math.round(20 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-072: Bitmap Heap Scan Opportunity Missed
 * trigger: Multiple Index Scans on same table (could combine via bitmap)
 * carbon reason: Bitmap index scan unions multiple indexes; more efficient than OR
 */
function checkRC072_BitmapHeapScanOpportunityMissed(node, context = {}) {
  let indexScansOnSameTable = {};
  const countIndexScans = (n) => {
    const indexTypes = ['Index Scan', 'Index Only Scan'];
    if (indexTypes.includes(n.NodeType) && n['Relation Name']) {
      const tableName = n['Relation Name'];
      indexScansOnSameTable[tableName] = (indexScansOnSameTable[tableName] || 0) + 1;
    }
    if (n.Plans) {
      n.Plans.forEach(countIndexScans);
    }
  };
  
  countIndexScans(node);
  
  const tablesWithManyIndexScans = Object.entries(indexScansOnSameTable).filter(([_, count]) => count > 2);

  if (tablesWithManyIndexScans.length > 0) {
    const [tableName, indexCount] = tablesWithManyIndexScans[0];
    return {
      rule_id: 'RC-072',
      rule_name: 'Bitmap Heap Scan Opportunity Missed',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Bitmap index scan can union multiple indexes; more efficient than OR',
      affected_node: {
        type: 'Multiple Index Scans',
        table_name: tableName,
        index_scan_count: indexCount,
      },
      recommendation: `Consider combining indexes via Bitmap Heap Scan or rewriting query with UNION.`,
      fix_suggestion: `-- Rewrite: (SELECT * FROM table WHERE col1 = x) UNION ALL (SELECT * FROM table WHERE col2 = y)`,
      runtime_reduction_pct: 25,
      estimated_savings: {
        runtime_reduction_pct: 25,
        cost_reduction_pct: 21.25,
        carbon_reduction_pct: Math.round(25 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-073: Sequential Scan on Selective Predicate
 * trigger: Seq Scan with highly selective filter (rows removed > 90%)
 * carbon reason: Scanning all pages for few result rows; index would be faster
 */
function checkRC073_SequentialScanSelectivePredicate(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const planRows = node['Plan Rows'] || 0;
  const rowsRemovedByFilter = node['Rows Removed by Filter'] || 0;
  const totalRowsProcessed = planRows + rowsRemovedByFilter;

  if (totalRowsProcessed > 0 && (rowsRemovedByFilter / totalRowsProcessed) > 0.9 && totalRowsProcessed > 10000) {
    return {
      rule_id: 'RC-073',
      rule_name: 'Sequential Scan on Selective Predicate',
      triggered: true,
      severity: 'HIGH',
      confidence: 'HIGH',
      carbon_reason: 'Scanning all pages for few results; index would be much faster',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        rows_removed: rowsRemovedByFilter,
        selectivity: Math.round((1 - rowsRemovedByFilter / totalRowsProcessed) * 100),
      },
      recommendation: `Add index on filter column to enable efficient index scan.`,
      fix_suggestion: `CREATE INDEX CONCURRENTLY idx_${(node['Relation Name'] || 'table').toLowerCase()}_col ON ${node['Relation Name'] || 'table'}(filtered_col);`,
      runtime_reduction_pct: 65,
      estimated_savings: {
        runtime_reduction_pct: 65,
        cost_reduction_pct: 55.25,
        carbon_reduction_pct: Math.round(65 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-074: Non-Sargable Predicate
 * trigger: Filter contains non-sargable condition (function call on indexed column, NOT operator, etc)
 * carbon reason: Non-sargable predicates disable index usage; forces seq scan
 */
function checkRC074_NonSargablePredicate(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '').toUpperCase();
  const nonSargablePatterns = /NOT\s+|!=|<>|function\(|LIKE\s+'%/i;
  const hasNonSargable = nonSargablePatterns.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasNonSargable && planRows > 10000) {
    return {
      rule_id: 'RC-074',
      rule_name: 'Non-Sargable Predicate',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Non-sargable predicates disable index usage; forces seq scan',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        filter: filter.substring(0, 40),
        plan_rows: planRows,
      },
      recommendation: `Rewrite predicate to be sargable: NOT IN → NOT EXISTS, != → other comparison, avoid functions.`,
      fix_suggestion: `-- Bad: WHERE NOT IN (SELECT...) or status != 'deleted' -- Good: WHERE NOT EXISTS(...) or status = 'active'`,
      runtime_reduction_pct: 60,
      estimated_savings: {
        runtime_reduction_pct: 60,
        cost_reduction_pct: 51,
        carbon_reduction_pct: Math.round(60 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-075: BETWEEN vs >= AND <= Inefficiency
 * trigger: Filter contains >= AND <= instead of BETWEEN (minor optimization)
 * carbon reason: BETWEEN can be optimized to single range scan; >= AND <= requires two checks
 */
function checkRC075_BetweenOptimization(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '');
  const hasAndCondition = />=.*AND.*<=|<=.*AND.*>=/.test(filter);
  const hasNoBeween = !/BETWEEN/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasAndCondition && hasNoBeween && planRows > 10000) {
    return {
      rule_id: 'RC-075',
      rule_name: 'BETWEEN vs >= AND <= Inefficiency',
      triggered: true,
      severity: 'LOW',
      confidence: 'MEDIUM',
      carbon_reason: 'BETWEEN optimized to single range; >= AND <= requires two checks',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
      },
      recommendation: `Normalize range conditions to BETWEEN: col >= x AND col <= y → col BETWEEN x AND y`,
      fix_suggestion: `-- Change: WHERE col >= 10 AND col <= 20 -- To: WHERE col BETWEEN 10 AND 20`,
      runtime_reduction_pct: 10,
      estimated_savings: {
        runtime_reduction_pct: 10,
        cost_reduction_pct: 8.5,
        carbon_reduction_pct: Math.round(10 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-076: OR Condition Preventing Index Usage
 * trigger: Seq Scan with OR condition that could use indexes separately
 * carbon reason: OR prevents single index usage; UNION of indexed queries faster
 */
function checkRC076_ORPreventingIndexUsage(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '');
  const hasOR = /\sOR\s/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasOR && planRows > 50000) {
    return {
      rule_id: 'RC-076',
      rule_name: 'OR Condition Preventing Index Usage',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'OR prevents single index usage; UNION of indexed queries faster',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        has_or_condition: true,
      },
      recommendation: `Rewrite OR as UNION of indexed queries: (SELECT from idx1) UNION (SELECT from idx2)`,
      fix_suggestion: `(SELECT * FROM t WHERE col1 = 1) UNION ALL (SELECT * FROM t WHERE col2 = 2)`,
      runtime_reduction_pct: 45,
      estimated_savings: {
        runtime_reduction_pct: 45,
        cost_reduction_pct: 38.25,
        carbon_reduction_pct: Math.round(45 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-077: NOT IN with NULL Risk
 * trigger: Filter contains "NOT IN (SELECT...)" which fails if subquery contains NULL
 * carbon reason: Correctness + optimization risk; NULL handling forces seq scan
 */
function checkRC077_NotInWithNullRisk(node, context = {}) {
  const filter = (node.Filter || '');
  const hasNotIn = /NOT\s+IN\s*\(\s*SELECT/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasNotIn) {
    return {
      rule_id: 'RC-077',
      rule_name: 'NOT IN with NULL Risk',
      triggered: true,
      severity: 'CRITICAL',
      confidence: 'MEDIUM',
      carbon_reason: 'NOT IN fails if subquery contains NULL; forces seq scan, correctness risk',
      affected_node: {
        type: node.NodeType,
        filter: filter.substring(0, 40),
        correctness_risk: 'NULL handling',
      },
      recommendation: `Replace NOT IN with NOT EXISTS to handle NULLs correctly.`,
      fix_suggestion: `-- Bad: WHERE id NOT IN (SELECT id FROM ref) -- Good: WHERE NOT EXISTS (SELECT 1 FROM ref WHERE ref.id = t.id)`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-078: Inefficient LIKE Pattern
 * trigger: Filter contains LIKE '%abc' (leading wildcard) or LIKE '%abc%' (both sides)
 * carbon reason: Both prevent B-tree index usage; trigram index needed
 */
function checkRC078_InefficientLikePattern(node, context = {}) {
  if (node.NodeType !== 'Seq Scan') return null;

  const filter = (node.Filter || '');
  const hasLeadingWild = /LIKE\s+'%|ILIKE\s+'%/.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasLeadingWild && planRows > 10000) {
    return {
      rule_id: 'RC-078',
      rule_name: 'Inefficient LIKE Pattern',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      carbon_reason: 'Leading wildcard prevents B-tree; trigram index can handle it efficiently',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        plan_rows: planRows,
        pattern_type: 'leading_wildcard',
      },
      recommendation: `Use trigram (pg_trgm) index for LIKE pattern matching: CREATE INDEX idx USING GIN(col gin_trgm_ops);`,
      fix_suggestion: `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX idx_trgm ON ${node['Relation Name'] || 'table'} USING GIN(col gin_trgm_ops);`,
      runtime_reduction_pct: 60,
      estimated_savings: {
        runtime_reduction_pct: 60,
        cost_reduction_pct: 51,
        carbon_reduction_pct: Math.round(60 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-079: GROUP BY High Cardinality Columns
 * trigger: GroupAggregate/HashAggregate on column with very high cardinality (plan_rows > 1M)
 * carbon reason: High cardinality grouping creates giant hash table; spills to disk
 */
function checkRC079_GroupByHighCardinality(node, context = {}) {
  const aggTypes = ['GroupAggregate', 'HashAggregate'];
  if (!aggTypes.includes(node.NodeType)) return null;

  const planRows = node['Plan Rows'] || 0;
  const groupKey = node['Group Key'] || [];

  if (planRows > 1000000) {
    return {
      rule_id: 'RC-079',
      rule_name: 'GROUP BY High Cardinality Columns',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'High cardinality grouping creates giant hash table; spills to disk',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        group_key_count: Array.isArray(groupKey) ? groupKey.length : 0,
      },
      recommendation: `Reduce GROUP BY cardinality: pre-filter rows, normalize grouping columns, or use FILTER clause.`,
      fix_suggestion: `-- Reduce: GROUP BY lower_cardinality_col or apply WHERE before GROUP BY`,
      runtime_reduction_pct: 55,
      estimated_savings: {
        runtime_reduction_pct: 55,
        cost_reduction_pct: 46.75,
        carbon_reduction_pct: Math.round(55 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-080: HAVING Used Instead of WHERE
 * trigger: GroupAggregate with Filter node (HAVING) that could be applied pre-aggregation
 * carbon reason: WHERE pre-aggregation reduces rows; HAVING post-aggregation still costs
 */
function checkRC080_HavingInsteadOfWhere(node, context = {}) {
  const aggTypes = ['GroupAggregate', 'HashAggregate'];
  if (!aggTypes.includes(node.NodeType)) return null;

  const hasHavingLikeFilter = node.Plans && node.Plans.some(p => p.Filter && p.NodeType !== 'Aggregate');

  if (hasHavingLikeFilter && node['Plan Rows'] && node['Plan Rows'] > 10000) {
    return {
      rule_id: 'RC-080',
      rule_name: 'HAVING Used Instead of WHERE',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'WHERE pre-aggregation reduces rows; HAVING post-aggregation costs same',
      affected_node: {
        type: node.NodeType,
        plan_rows: node['Plan Rows'],
      },
      recommendation: `Move HAVING conditions to WHERE clause if they don't reference aggregates.`,
      fix_suggestion: `-- Bad: GROUP BY col HAVING col > 10 -- Good: WHERE col > 10 GROUP BY col`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-081: COUNT(*) vs COUNT(column)
 * trigger: Filter references COUNT(column) instead of COUNT(*)
 * carbon reason: COUNT(*) optimized to scan index; COUNT(col) requires checking NULL
 */
function checkRC081_CountVsCountColumn(node, context = {}) {
  // This would require SQL text analysis; simplified heuristic
  if (context.uses_count_column_not_star) {
    return {
      rule_id: 'RC-081',
      rule_name: 'COUNT(*) vs COUNT(column)',
      triggered: true,
      severity: 'LOW',
      confidence: 'LOW',
      carbon_reason: 'COUNT(*) optimized to quick index scan; COUNT(col) must check NULLs',
      affected_node: {
        type: 'Aggregate',
      },
      recommendation: `Use COUNT(*) instead of COUNT(column) for total count.`,
      fix_suggestion: `-- Change: COUNT(col) to COUNT(*) if you want all rows including NULLs`,
      runtime_reduction_pct: 10,
      estimated_savings: {
        runtime_reduction_pct: 10,
        cost_reduction_pct: 8.5,
        carbon_reduction_pct: Math.round(10 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-082: Redundant DISTINCT with GROUP BY
 * trigger: Query contains both DISTINCT and GROUP BY on same columns
 * carbon reason: GROUP BY already deduplicates; DISTINCT is redundant
 */
function checkRC082_RedundantDistinctWithGroupBy(node, context = {}) {
  const aggTypes = ['GroupAggregate', 'HashAggregate'];
  if (!aggTypes.includes(node.NodeType)) return null;

  const hasDistinctBefore = node.Plans && node.Plans.some(p => p.NodeType === 'Unique');
  const planRows = node['Plan Rows'] || 0;

  if (hasDistinctBefore && planRows > 10000) {
    return {
      rule_id: 'RC-082',
      rule_name: 'Redundant DISTINCT with GROUP BY',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      carbon_reason: 'GROUP BY already deduplicates; DISTINCT is redundant',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
      },
      recommendation: `Remove DISTINCT when used with GROUP BY; they're redundant.`,
      fix_suggestion: `-- Remove: SELECT DISTINCT col FROM t GROUP BY col -- Keep: SELECT col FROM t GROUP BY col`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-083: Duplicate Aggregation Computation
 * trigger: SubPlan node with aggregate run multiple times for same data
 * carbon reason: Computing same aggregate multiple times; cache or reuse subquery
 */
function checkRC083_DuplicateAggregationComputation(node, context = {}) {
  if (node.NodeType !== 'SubPlan') return null;

  const hasAggregate = node.Plans && node.Plans.some(p => p.NodeType && p.NodeType.includes('Aggregate'));
  const planRows = node['Plan Rows'] || 0;
  const executionCount = context.parent_rows || 1;

  if (hasAggregate && executionCount > 1 && planRows > 1) {
    return {
      rule_id: 'RC-083',
      rule_name: 'Duplicate Aggregation Computation',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Computing same aggregate multiple times; reuse via CTE or cached result',
      affected_node: {
        type: node.NodeType,
        execution_count: executionCount,
        has_aggregate: true,
      },
      recommendation: `Cache aggregate result in CTE or memoization layer: WITH agg AS (SELECT ...) SELECT ... FROM agg ...`,
      fix_suggestion: `WITH agg_result AS (SELECT COUNT(*), SUM(col) FROM table) SELECT * FROM agg_result ...`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-084: Window Function Without Partition Index
 * trigger: WindowAgg node with Sort child (partitioning requires sort)
 * carbon reason: Window function partitioning requires sort; index could provide natural order
 */
function checkRC084_WindowFunctionNoPartitionIndex(node, context = {}) {
  if (node.NodeType !== 'WindowAgg') return null;
  if (!node.Plans || node.Plans.length === 0) return null;

  const childIsSort = node.Plans[0].NodeType === 'Sort';
  const childRows = node.Plans[0]['Plan Rows'] || 0;

  if (childIsSort && childRows > 10000) {
    return {
      rule_id: 'RC-084',
      rule_name: 'Window Function Without Partition Index',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Window partitioning requires sort; index could provide natural order',
      affected_node: {
        type: node.NodeType,
        child_rows: childRows,
        requires_sort: true,
      },
      recommendation: `Create index on PARTITION/ORDER BY columns to avoid explicit sort.`,
      fix_suggestion: `CREATE INDEX idx_window ON table(partition_col, order_col);`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-085: Window Function on Large Dataset Without Filter
 * trigger: WindowAgg on large unfiltered dataset (should apply pre-filter)
 * carbon reason: Window functions on full table expensive; pre-filtering reduces workload
 */
function checkRC085_WindowFunctionLargeDataset(node, context = {}) {
  if (node.NodeType !== 'WindowAgg') return null;

  const planRows = node['Plan Rows'] || 0;
  const hasFilter = node.Plans && node.Plans.some(p => p.Filter && p.Filter.length > 0);

  if (planRows > 1000000 && !hasFilter) {
    return {
      rule_id: 'RC-085',
      rule_name: 'Window Function on Large Dataset Without Filter',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Window functions on full table expensive; pre-filtering reduces workload',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
      },
      recommendation: `Apply WHERE filter before window function: SELECT ROW_NUMBER() OVER (...) FROM t WHERE date > ...`,
      fix_suggestion: `-- Pre-filter: ... FROM (SELECT * FROM table WHERE condition) sub WINDOW ...`,
      runtime_reduction_pct: 35,
      estimated_savings: {
        runtime_reduction_pct: 35,
        cost_reduction_pct: 29.75,
        carbon_reduction_pct: Math.round(35 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-086: Multiple Window Functions Same Partition
 * trigger: Multiple WindowAgg nodes with identical PARTITION BY (should reuse)
 * carbon reason: Multiple window partitions on same column; can reuse window definition
 */
function checkRC086_MultipleWindowSamePartition(node, context = {}) {
  if (node.NodeType !== 'WindowAgg') return null;

  // Heuristic: If multiple window functions, they might share partitioning
  const planRows = node['Plan Rows'] || 0;
  const canReuseWindow = context.window_partitions && context.window_partitions.length > 1;

  if (canReuseWindow && planRows > 100000) {
    return {
      rule_id: 'RC-086',
      rule_name: 'Multiple Window Functions Same Partition',
      triggered: true,
      severity: 'LOW',
      confidence: 'LOW',
      carbon_reason: 'Multiple window functions on same partition; can reuse window definition',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
      },
      recommendation: `Combine multiple window functions in one statement to reuse partitioning.`,
      fix_suggestion: `SELECT ROW_NUMBER() OVER w, RANK() OVER w FROM t WINDOW w AS (PARTITION BY col ORDER BY col2)`,
      runtime_reduction_pct: 25,
      estimated_savings: {
        runtime_reduction_pct: 25,
        cost_reduction_pct: 21.25,
        carbon_reduction_pct: Math.round(25 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-087: Unnecessary CTE Materialization
 * trigger: CTE used only once (inlining would be more efficient)
 * carbon reason: CTE materialization costs memory; inlining avoids materialization if used once
 */
function checkRC087_UnnecessaryCTEMaterialization(node, context = {}) {
  const nodeType = node.NodeType || '';
  const isCTE = nodeType.includes('CTE');

  if (isCTE && context.cte_usage_count === 1) {
    return {
      rule_id: 'RC-087',
      rule_name: 'Unnecessary CTE Materialization',
      triggered: true,
      severity: 'LOW',
      confidence: 'MEDIUM',
      carbon_reason: 'CTE materialization costs memory; inlining avoids if used only once',
      affected_node: {
        type: nodeType,
        usage_count: 1,
      },
      recommendation: `Inline CTE if used only once: Replace WITH cte AS (...) SELECT ... FROM cte with direct subquery.`,
      fix_suggestion: `-- Instead: SELECT * FROM (SELECT ...) sub -- Instead of: WITH cte AS (SELECT ...) SELECT ... FROM cte`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-088: Reused CTE Without Materialization
 * trigger: CTE referenced multiple times but marked non-materialized (inlined multiple times)
 * carbon reason: CTE inlined multiple times executes same logic repeatedly; materialization better
 */
function checkRC088_ReusedCTENoMaterialization(node, context = {}) {
  const nodeType = node.NodeType || '';
  const isCTE = nodeType.includes('CTE');

  if (isCTE && context.cte_usage_count > 1 && node['Plan Rows'] && node['Plan Rows'] > 10000) {
    return {
      rule_id: 'RC-088',
      rule_name: 'Reused CTE Without Materialization',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'CTE inlined multiple times; materialization trades memory for avoiding re-execution',
      affected_node: {
        type: nodeType,
        usage_count: context.cte_usage_count,
        plan_rows: node['Plan Rows'],
      },
      recommendation: `Force CTE materialization: WITH cte AS MATERIALIZED (SELECT ...) or use temporary table.`,
      fix_suggestion: `-- PostgreSQL 12+: WITH cte AS MATERIALIZED (SELECT ...) SELECT ... FROM cte ...`,
      runtime_reduction_pct: 35,
      estimated_savings: {
        runtime_reduction_pct: 35,
        cost_reduction_pct: 29.75,
        carbon_reduction_pct: Math.round(35 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-089: Missing Extended Statistics
 * trigger: Multi-column WHERE/JOIN conditions without extended stats
 * carbon reason: Planner underestimates multi-column selectivity; creates bad plans
 */
function checkRC089_MissingExtendedStatistics(node, context = {}) {
  const filter = (node.Filter || '');
  const multiColumnConditions = (filter.match(/\sAND\s/g) || []).length > 1;
  const planRows = node['Plan Rows'] || 0;
  const actualRows = node['Actual Rows'] || planRows;

  if (multiColumnConditions && actualRows > 0 && (planRows / actualRows) > 3 && planRows > 10000) {
    return {
      rule_id: 'RC-089',
      rule_name: 'Missing Extended Statistics',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Planner underestimates multi-column selectivity; creates suboptimal plans',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        actual_rows: actualRows,
        estimation_error: Math.round((planRows / actualRows) * 100) / 100,
      },
      recommendation: `Create extended statistics on multi-column conditions: CREATE STATISTICS stat ON col1, col2 FROM table;`,
      fix_suggestion: `CREATE STATISTICS multi_col_stat (dependencies) ON col1, col2, col3 FROM ${node['Relation Name'] || 'table'};`,
      runtime_reduction_pct: 35,
      estimated_savings: {
        runtime_reduction_pct: 35,
        cost_reduction_pct: 29.75,
        carbon_reduction_pct: Math.round(35 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-090: Correlated Columns Without Stats
 * trigger: Filter with multiple column references where correlation expected
 * carbon reason: Correlated columns without stats misestimated; planner chooses wrong strategy
 */
function checkRC090_CorrelatedColumnsNoStats(node, context = {}) {
  const filter = (node.Filter || '');
  const hasMultipleColumns = (filter.match(/[a-z_]+\.[a-z_]+/gi) || []).length > 2;
  const planRows = node['Plan Rows'] || 0;

  if (hasMultipleColumns && planRows > 50000) {
    return {
      rule_id: 'RC-090',
      rule_name: 'Correlated Columns Without Stats',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'LOW',
      carbon_reason: 'Correlated columns without stats misestimated; planner chooses wrong join strategy',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        column_references: Math.min((filter.match(/[a-z_]+\.[a-z_]+/gi) || []).length, 10),
      },
      recommendation: `Create extended statistics for correlated columns: CREATE STATISTICS ...`,
      fix_suggestion: `CREATE STATISTICS corr_stat ON col1, col2 FROM table; ANALYZE table;`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-091: Outdated ANALYZE Frequency
 * trigger: Stale statistics detected + table is highly updated
 * carbon reason: Outdated stats cause plan misestimation; ANALYZE frequency needs tuning
 */
function checkRC091_OutdatedAnalyzeFrequency(node, context = {}) {
  const planRows = node['Plan Rows'] || 1;
  const actualRows = node['Actual Rows'] || planRows;
  
  if (actualRows === 0) return null;
  
  const estimationError = planRows / actualRows;

  if ((estimationError > 5 || estimationError < 0.2) && node['Relation Name']) {
    return {
      rule_id: 'RC-091',
      rule_name: 'Outdated ANALYZE Frequency',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Outdated stats cause plan misestimation; ANALYZE frequency needs tuning',
      affected_node: {
        type: node.NodeType,
        relation_name: node['Relation Name'] || 'unknown',
        error_factor: Math.round(estimationError * 100) / 100,
      },
      recommendation: `Increase autovacuum ANALYZE frequency: ALTER TABLE ... SET (autovacuum_analyze_scale_factor = 0.01);`,
      fix_suggestion: `ALTER TABLE ${node['Relation Name'] || 'table'} SET (autovacuum_analyze_scale_factor = 0.01); ANALYZE;`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-092: Sort Spill to Disk
 * trigger: Sort node with large plan rows in work_mem constrained environment
 * carbon reason: Disk spill increases I/O 100-1000x vs memory sort
 */
function checkRC092_SortSpillToDisk(node, context = {}) {
  if (node.NodeType !== 'Sort') return null;

  const planRows = node['Plan Rows'] || 0;
  const workMem = context.work_mem || 100; // MB
  const estimatedBytes = planRows * 100; // rough bytes per row

  if (estimatedBytes > workMem * 1024 * 1024 && planRows > 100000) {
    return {
      rule_id: 'RC-092',
      rule_name: 'Sort Spill to Disk',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'Disk spill increases I/O 100-1000x vs in-memory sort',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        work_mem_mb: workMem,
        estimated_bytes: Math.round(estimatedBytes / 1024 / 1024),
      },
      recommendation: `Increase work_mem to prevent sort spill: SET work_mem = '512MB' or higher.`,
      fix_suggestion: `SET work_mem = '1GB'; EXPLAIN ANALYZE <query>; -- Check "Sort Method" line for spill indicators`,
      runtime_reduction_pct: 70,
      estimated_savings: {
        runtime_reduction_pct: 70,
        cost_reduction_pct: 59.5,
        carbon_reduction_pct: Math.round(70 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-093: Hash Spill to Disk
 * trigger: HashAggregate or Hash Join with large plan rows in work_mem constrained environment
 * carbon reason: Hash spill to disk increases I/O exponentially
 */
function checkRC093_HashSpillToDisk(node, context = {}) {
  const hashTypes = ['HashAggregate', 'Hash Join'];
  if (!hashTypes.includes(node.NodeType)) return null;

  const planRows = node['Plan Rows'] || 0;
  const workMem = context.work_mem || 100;
  const estimatedBytes = planRows * 150; // rough bytes for hash table

  if (estimatedBytes > workMem * 1024 * 1024 && planRows > 100000) {
    return {
      rule_id: 'RC-093',
      rule_name: 'Hash Spill to Disk',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'Hash spill to disk increases I/O; memory-resident hash 100-1000x faster',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        work_mem_mb: workMem,
        estimated_bytes: Math.round(estimatedBytes / 1024 / 1024),
      },
      recommendation: `Increase work_mem or reduce hash input size: SET work_mem = '512MB' or pre-filter.`,
      fix_suggestion: `SET work_mem = '1GB'; -- Or: Pre-filter data: WHERE date > ... before hash operation`,
      runtime_reduction_pct: 65,
      estimated_savings: {
        runtime_reduction_pct: 65,
        cost_reduction_pct: 55.25,
        carbon_reduction_pct: Math.round(65 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-094: Excessive Temporary Files
 * trigger: Sort/Hash nodes with plan rows >> work_mem (multiple spill batches)
 * carbon reason: Many temporary file writes indicate serious work_mem pressure
 */
function checkRC094_ExcessiveTemporaryFiles(node, context = {}) {
  const spillTypes = ['Sort', 'HashAggregate', 'Hash Join'];
  if (!spillTypes.includes(node.NodeType)) return null;

  const planRows = node['Plan Rows'] || 0;
  const workMem = context.work_mem || 100;
  const spillEstimate = Math.ceil((planRows * 100) / (workMem * 1024 * 1024));

  if (spillEstimate > 3 && planRows > 500000) {
    return {
      rule_id: 'RC-094',
      rule_name: 'Excessive Temporary Files',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'Many temporary file batches indicate serious I/O pressure',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        estimated_spill_batches: spillEstimate,
        work_mem_mb: workMem,
      },
      recommendation: `Optimize query plan: increase work_mem, pre-filter dataset, or redesign query.`,
      fix_suggestion: `-- Aggressive: SET work_mem = '2GB'; SET shared_buffers = ...  -- Or: Simplify query logic`,
      runtime_reduction_pct: 75,
      estimated_savings: {
        runtime_reduction_pct: 75,
        cost_reduction_pct: 63.75,
        carbon_reduction_pct: Math.round(75 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-095: SELECT * Usage
 * trigger: Node with SELECT * or unnamed column references (transmitting extra columns)
 * carbon reason: Selecting unnecessary columns increases network/memory usage
 */
function checkRC095_SelectAllUsage(node, context = {}) {
  // This would require SQL text analysis; simplified heuristic
  if (context.uses_select_star && context.actual_columns_needed < context.table_width * 0.8) {
    return {
      rule_id: 'RC-095',
      rule_name: 'SELECT * Usage',
      triggered: true,
      severity: 'LOW',
      confidence: 'MEDIUM',
      carbon_reason: 'SELECT * transmits extra columns; increases network/memory usage',
      affected_node: {
        type: 'SELECT',
      },
      recommendation: `Select only required columns: SELECT col1, col2, ... instead of SELECT *`,
      fix_suggestion: `-- Specify columns: SELECT id, name, email FROM user_table (not SELECT *)`,
      runtime_reduction_pct: 25,
      estimated_savings: {
        runtime_reduction_pct: 25,
        cost_reduction_pct: 21.25,
        carbon_reduction_pct: Math.round(25 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-096: Deeply Nested Subqueries
 * trigger: Query plan depth > 4 levels (multiple nested subqueries)
 * carbon reason: Nested subqueries harder to optimize; flattening improves planner visibility
 */
function checkRC096_DeeplyNestedSubqueries(node, context = {}) {
  let depth = 0;
  const countDepth = (n) => {
    depth = Math.max(depth, 1);
    if (n.Plans && n.Plans.length > 0) {
      n.Plans.forEach(p => countDepth(p));
      depth++;
    }
  };
  
  countDepth(node);

  if (depth > 4) {
    return {
      rule_id: 'RC-096',
      rule_name: 'Deeply Nested Subqueries',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Nested subqueries harder to optimize; flattening improves planner visibility',
      affected_node: {
        type: node.NodeType,
        nesting_depth: depth,
      },
      recommendation: `Flatten nested subqueries using CTEs or JOINs: Replace nested SELECT with WITH clause.`,
      fix_suggestion: `-- Flatten: Use WITH cte1 AS (...), cte2 AS (...) SELECT ... FROM cte1 JOIN cte2`,
      runtime_reduction_pct: 40,
      estimated_savings: {
        runtime_reduction_pct: 40,
        cost_reduction_pct: 34,
        carbon_reduction_pct: Math.round(40 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-097: UNION Instead of UNION ALL
 * trigger: Union node with deduplication overhead (plan_rows < sum of children)
 * carbon reason: UNION requires expensive sort deduplication; UNION ALL skips sort
 */
function checkRC097_UnionInsteadOfUnionAll(node, context = {}) {
  if (!node.NodeType || !node.NodeType.includes('Union')) return null;

  const planRows = node['Plan Rows'] || 0;
  const childRows = node.Plans ? node.Plans.reduce((sum, p) => sum + (p['Plan Rows'] || 0), 0) : 0;

  // If result is much smaller than sum of inputs, likely deduplication
  if (planRows < childRows * 0.95 && planRows > 10000) {
    return {
      rule_id: 'RC-097',
      rule_name: 'UNION Instead of UNION ALL',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'UNION requires sort deduplication; UNION ALL skips expensive sort',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        child_rows_sum: childRows,
      },
      recommendation: `Use UNION ALL if duplicates acceptable; DISTINCT can be applied post-union if needed.`,
      fix_suggestion: `-- Change: ... UNION ... to ... UNION ALL ... (if duplicates OK)`,
      runtime_reduction_pct: 60,
      estimated_savings: {
        runtime_reduction_pct: 60,
        cost_reduction_pct: 51,
        carbon_reduction_pct: Math.round(60 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-098: ORDER BY Without LIMIT
 * trigger: Sort node without Limit parent (sorts entire result set unnecessarily)
 * carbon reason: Full sort without LIMIT wastes energy; only top-N needed
 */
function checkRC098_OrderByWithoutLimit(node, context = {}) {
  if (node.NodeType !== 'Sort') return null;

  const hasLimitParent = context.parent_node_type === 'Limit';
  const planRows = node['Plan Rows'] || 0;

  if (!hasLimitParent && planRows > 100000) {
    return {
      rule_id: 'RC-098',
      rule_name: 'ORDER BY Without LIMIT',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Full sort without LIMIT wastes energy; only top-N rows typically needed',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        has_limit: hasLimitParent,
      },
      recommendation: `Add LIMIT if only top-N rows needed: SELECT ... ORDER BY col LIMIT 1000;`,
      fix_suggestion: `-- Add LIMIT: SELECT ... FROM t ORDER BY col LIMIT 1000; (avoid full sort cost)`,
      runtime_reduction_pct: 35,
      estimated_savings: {
        runtime_reduction_pct: 35,
        cost_reduction_pct: 29.75,
        carbon_reduction_pct: Math.round(35 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-099: LIMIT After JOIN Instead of Before
 * trigger: Limit node after Join (should limit before join if possible)
 * carbon reason: Limiting before join reduces join input size exponentially
 */
function checkRC099_LimitAfterJoinInsteadOfBefore(node, context = {}) {
  if (node.NodeType !== 'Limit') return null;
  if (!node.Plans || node.Plans.length === 0) return null;

  const childIsJoin = node.Plans[0].NodeType && node.Plans[0].NodeType.includes('Join');
  const limitCount = node['Limit'] || 0;
  const cartesianProduct = node['Plan Rows'] || 0;

  if (childIsJoin && limitCount > 0 && cartesianProduct > limitCount * 10) {
    return {
      rule_id: 'RC-099',
      rule_name: 'LIMIT After JOIN Instead of Before',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Limiting before join reduces join input; limits after join waste I/O on large join',
      affected_node: {
        type: node.NodeType,
        limit_count: limitCount,
        cartesian_before_limit: cartesianProduct,
      },
      recommendation: `Move LIMIT before heavy operations: SELECT ... LIMIT N in derived table, then JOIN.`,
      fix_suggestion: `-- Reorder: SELECT * FROM (SELECT ... LIMIT N) sub JOIN table2 ... (not SELECT ... FROM t1 JOIN t2 LIMIT N)`,
      runtime_reduction_pct: 50,
      estimated_savings: {
        runtime_reduction_pct: 50,
        cost_reduction_pct: 42.5,
        carbon_reduction_pct: Math.round(50 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-100: Missing Parallel Query Opportunity
 * trigger: Long-running sequential query on large table (should enable parallel)
 * carbon reason: Parallel query distributes CPU load; speeds up compute-bound operations
 */
function checkRC100_MissingParallelQuery(node, context = {}) {
  const totalCost = node['Total Cost'] || 0;
  const planRows = node['Plan Rows'] || 0;
  const parallelWorkers = node['parallel_workers'] || 0;

  if (totalCost > 50000 && planRows > 100000 && parallelWorkers === 0) {
    return {
      rule_id: 'RC-100',
      rule_name: 'Missing Parallel Query Opportunity',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Parallel query distributes CPU load; speeds up compute-bound operations',
      affected_node: {
        type: node.NodeType,
        total_cost: totalCost,
        plan_rows: planRows,
      },
      recommendation: `Enable parallel query: SET max_parallel_workers_per_gather = 4; SET parallel_setup_cost = ...`,
      fix_suggestion: `SET max_parallel_workers_per_gather = 4; SET max_parallel_workers = 4; EXPLAIN ANALYZE <query>`,
      runtime_reduction_pct: 30,
      estimated_savings: {
        runtime_reduction_pct: 30,
        cost_reduction_pct: 25.5,
        carbon_reduction_pct: Math.round(30 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-101: Overuse of Parallel Workers
 * trigger: Parallel workers > 4 AND cost per worker < 1000 (too many for work)
 * carbon reason: Too many workers add context switching overhead; diminishing returns
 */
function checkRC101_OveruseParallelWorkers(node, context = {}) {
  const parallelWorkers = node['parallel_workers'] || 0;
  const totalCost = node['Total Cost'] || 1;

  if (parallelWorkers > 4 && (totalCost / parallelWorkers) < 1000) {
    return {
      rule_id: 'RC-101',
      rule_name: 'Overuse of Parallel Workers',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Too many workers add context switching; diminishing returns on CPU',
      affected_node: {
        type: node.NodeType,
        parallel_workers: parallelWorkers,
        cost_per_worker: Math.round((totalCost / parallelWorkers) * 100) / 100,
      },
      recommendation: `Reduce parallel workers: SET max_parallel_workers_per_gather = 2 or 3;`,
      fix_suggestion: `SET max_parallel_workers_per_gather = 2; -- Reduce overhead, improve efficiency`,
      runtime_reduction_pct: 15,
      estimated_savings: {
        runtime_reduction_pct: 15,
        cost_reduction_pct: 12.75,
        carbon_reduction_pct: Math.round(15 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-102: Inefficient JSON Processing
 * trigger: Filter contains ->> or -< operators on large unindexed JSON column
 * carbon reason: JSON operators without GIN index force seq scan + per-row JSON parsing
 */
function checkRC102_InefficientJsonProcessing(node, context = {}) {
  const filter = (node.Filter || '');
  const hasJsonOps = /->>|->|#>|@>/i.test(filter);
  const planRows = node['Plan Rows'] || 0;

  if (hasJsonOps && planRows > 10000 && node.NodeType === 'Seq Scan') {
    return {
      rule_id: 'RC-102',
      rule_name: 'Inefficient JSON Processing',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'JSON operators without index force seq scan + per-row JSON parsing',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        has_json_ops: true,
      },
      recommendation: `Create GIN index on JSON column: CREATE INDEX idx_json ON table USING GIN(json_col jsonb_ops);`,
      fix_suggestion: `CREATE INDEX idx_json_gin ON ${node['Relation Name'] || 'table'} USING GIN(json_col jsonb_gin_ops);`,
      runtime_reduction_pct: 45,
      estimated_savings: {
        runtime_reduction_pct: 45,
        cost_reduction_pct: 38.25,
        carbon_reduction_pct: Math.round(45 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-103: Repeated Expression Evaluation
 * trigger: Same complex expression appears in multiple SELECT/WHERE positions
 * carbon reason: Computing same expression multiple times in query; compute once re-use
 */
function checkRC103_RepeatedExpressionEvaluation(node, context = {}) {
  // Heuristic: Complex filter suggests repeated computation might be happening
  const filter = (node.Filter || '');
  const caseCount = (filter.match(/CASE\s/gi) || []).length;
  const castCount = (filter.match(/::/g) || []).length;
  const functionCount = (filter.match(/\w+\(/g) || []).length;
  const complexityScore = caseCount * 3 + castCount + functionCount;

  if (complexityScore > 5 && context.expression_references > 2) {
    return {
      rule_id: 'RC-103',
      rule_name: 'Repeated Expression Evaluation',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'LOW',
      carbon_reason: 'Computing same complex expression multiple times; compute once and reuse',
      affected_node: {
        type: node.NodeType,
        complexity_score: complexityScore,
      },
      recommendation: `Use CTE or computed column: WITH expr AS (SELECT complex_calc...) SELECT ... FROM expr`,
      fix_suggestion: `-- Compute once: WITH expr_cte AS (SELECT col, (complex_expr) AS result FROM t) SELECT ... FROM expr_cte`,
      runtime_reduction_pct: 25,
      estimated_savings: {
        runtime_reduction_pct: 25,
        cost_reduction_pct: 21.25,
        carbon_reduction_pct: Math.round(25 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-104: Inefficient CASE Expression
 * trigger: Filter with complex CASE expression (more complex ways to write logic)
 * carbon reason: CASE evaluated per-row; simplify logic for better optimization
 */
function checkRC104_InefficientCaseExpression(node, context = {}) {
  const filter = (node.Filter || '');
  const caseCount = (filter.match(/CASE\s/gi) || []).length;
  const whenClauses = (filter.match(/WHEN/gi) || []).length;
  const planRows = node['Plan Rows'] || 0;

  if (caseCount > 1 && whenClauses > 5 && planRows > 1000000) {
    return {
      rule_id: 'RC-104',
      rule_name: 'Inefficient CASE Expression',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'Complex CASE evaluated per-row; simplify logic for optimization',
      affected_node: {
        type: node.NodeType,
        case_count: caseCount,
        when_clauses: whenClauses,
        plan_rows: planRows,
      },
      recommendation: `Simplify CASE logic: use computed column, or application layer logic.`,
      fix_suggestion: `-- Move CASE to application or precompute: ALTER TABLE t ADD COLUMN category INT; UPDATE based on logic`,
      runtime_reduction_pct: 20,
      estimated_savings: {
        runtime_reduction_pct: 20,
        cost_reduction_pct: 17,
        carbon_reduction_pct: Math.round(20 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-105: Lack of Query Result Caching Opportunity
 * trigger: Query has high CPU cost + is executed frequently + result is mostly static
 * carbon reason: Repeatedly computing identical results wastes CPU; cache would eliminate computation
 */
function checkRC105_LackQueryResultCaching(node, context = {}) {
  const totalCost = node['Total Cost'] || 0;
  const executionFrequency = context.query_frequency || 0;
  const resultMutationRate = context.result_mutation_rate || 0;

  if (totalCost > 10000 && executionFrequency > 10 && resultMutationRate < 0.05) {
    return {
      rule_id: 'RC-105',
      rule_name: 'Lack of Query Result Caching Opportunity',
      triggered: true,
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      carbon_reason: 'High-cost query executed frequently with static results; caching eliminates computation',
      affected_node: {
        type: node.NodeType,
        total_cost: totalCost,
        execution_frequency: executionFrequency,
        mutation_rate: resultMutationRate,
      },
      recommendation: `Implement query result caching: Materialized View, Redis, or application-level cache.`,
      fix_suggestion: `CREATE MATERIALIZED VIEW cached_result_view AS SELECT ...; REFRESH MATERIALIZED VIEW hourly/daily;`,
      runtime_reduction_pct: 60,
      estimated_savings: {
        runtime_reduction_pct: 60,
        cost_reduction_pct: 51,
        carbon_reduction_pct: Math.round(60 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-106: Function + Cast on Join Predicate (CRITICAL)
 * trigger: Join Hash Cond/Merge Cond contains LOWER() or ::text cast on both sides
 * carbon reason: Function + cast combo renders index completely unusable; forces full scan
 */
function checkRC106_FunctionCastOnJoinPredicate(node, context = {}) {
  const joinTypes = ['Hash Join', 'Nested Loop', 'Merge Join'];
  if (!joinTypes.includes(node.NodeType)) return null;

  const hashCond = (node['Hash Cond'] || '') + (node['Merge Cond'] || '') + (node['Join Filter'] || '');
  const hasFunctionCall = /LOWER\(|UPPER\(|TRIM\(|SUBSTRING\(|EXTRACT\(/.test(hashCond);
  const hasCast = /::text|::int|::varchar|::numeric/.test(hashCond);
  const planRows = node['Plan Rows'] || 0;

  if (hasFunctionCall && hasCast && planRows > 10000) {
    return {
      rule_id: 'RC-106',
      rule_name: 'Function + Cast on Join Predicate',
      triggered: true,
      severity: 'CRITICAL',
      confidence: 'HIGH',
      carbon_reason: 'Function + cast combo on join predicate renders indexes completely unusable; forces full scan',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        join_condition: hashCond.substring(0, 50),
        has_function: true,
        has_cast: true,
      },
      recommendation: `Remove function and cast OR create functional index: CREATE INDEX idx ON table(LOWER(col::text));`,
      fix_suggestion: `-- Option 1: p.customer_id = c.customer_id (remove function+cast) -- Option 2: CREATE INDEX idx_func ON payment(LOWER(customer_id::text));`,
      runtime_reduction_pct: 87,
      estimated_savings: {
        runtime_reduction_pct: 87,
        cost_reduction_pct: 73.95,
        carbon_reduction_pct: Math.round(87 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-107: Correlated Subquery + Non-Sargable Predicate (CRITICAL)
 * trigger: SubPlan found that is correlated + has non-sargable filter (function/NOT/cast)
 * carbon reason: Correlated + non-sargable = per-row full scan; exponential cost
 */
function checkRC107_CorrelatedSubqueryNonSargable(node, context = {}) {
  if (node.NodeType !== 'SubPlan') return null;

  const filter = (node.Filter || '').toUpperCase();
  const nonSargablePatterns = /NOT\s+|!=|<>|LOWER\(|UPPER\(|FUNCTION\(|LIKE\s+'%/i;
  const hasNonSargable = nonSargablePatterns.test(filter);
  const isCorrelated = context.parent_rows && context.parent_rows > 1;
  const planRows = node['Plan Rows'] || 0;

  if (hasNonSargable && isCorrelated && planRows > 1) {
    return {
      rule_id: 'RC-107',
      rule_name: 'Correlated Subquery + Non-Sargable Predicate',
      triggered: true,
      severity: 'CRITICAL',
      confidence: 'HIGH',
      carbon_reason: 'Correlated + non-sargable predicate = per-row full scan with function evaluation',
      affected_node: {
        type: node.NodeType,
        is_correlated: true,
        filter: filter.substring(0, 40),
        has_non_sargable: true,
      },
      recommendation: `Remove function from WHERE clause OR rewrite as JOIN: SELECT t1.*, (SELECT COUNT(*) FROM t2 WHERE t2.id = t1.id) ...`,
      fix_suggestion: `-- Bad: (SELECT COUNT(*) FROM t2 WHERE LOWER(t2.name) = LOWER(t1.name)) -- Good: Use JOIN approach without function`,
      runtime_reduction_pct: 90,
      estimated_savings: {
        runtime_reduction_pct: 90,
        cost_reduction_pct: 76.5,
        carbon_reduction_pct: Math.round(90 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-108: Index Disabled by Expression in Join Condition
 * trigger: Join condition wraps indexed column in any expression (function, cast, arithmetic)
 * carbon reason: Index requires direct column reference; any wrapping disables index
 */
function checkRC108_IndexDisabledByExpressionJoin(node, context = {}) {
  const joinTypes = ['Hash Join', 'Nested Loop', 'Merge Join'];
  if (!joinTypes.includes(node.NodeType)) return null;

  const joinCond = (node['Hash Cond'] || '') + (node['Merge Cond'] || '') + (node['Join Filter'] || '');
  const hasExpression = /\(.*\)|::|\+|-|\*|\/|\||&/.test(joinCond);
  const planRows = node['Plan Rows'] || 0;

  if (hasExpression && planRows > 50000) {
    return {
      rule_id: 'RC-108',
      rule_name: 'Index Disabled by Expression in Join Condition',
      triggered: true,
      severity: 'HIGH',
      confidence: 'MEDIUM',
      carbon_reason: 'Index requires direct column reference; any expression wrapping disables index usage',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        join_expression: joinCond.substring(0, 40),
      },
      recommendation: `Rewrite join using direct column references OR create functional index.`,
      fix_suggestion: `-- Option 1: a.col = b.col (not (a.col + 1) = b.col) -- Option 2: CREATE INDEX ON table(func(col))`,
      runtime_reduction_pct: 70,
      estimated_savings: {
        runtime_reduction_pct: 70,
        cost_reduction_pct: 59.5,
        carbon_reduction_pct: Math.round(70 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-109: Multiple Anti-Patterns in Same Predicate (COMPOUND RULE)
 * trigger: Single filter combines 2+ anti-patterns (function + cast + correlation, etc)
 * carbon reason: Compounded anti-patterns multiply cost exponentially; escalate to CRITICAL
 */
function checkRC109_MultipleAntiPatternsCompound(node, context = {}) {
  const filter = (node.Filter || '').toUpperCase();
  const joinCond = ((node['Hash Cond'] || '') + (node['Merge Cond'] || '') + (node['Join Filter'] || '')).toUpperCase();
  const combinedText = (filter + joinCond).toUpperCase();

  // Count anti-patterns
  let antiPatternCount = 0;
  if (/LOWER\(|UPPER\(|TRIM\(|FUNCTION\(/.test(combinedText)) antiPatternCount++;
  if (/::TEXT|::INT|::VARCHAR|::NUMERIC/.test(combinedText)) antiPatternCount++;
  if (/NOT\s+|!=|<>|LIKE\s+'%/.test(combinedText)) antiPatternCount++;
  if (context.is_correlated) antiPatternCount++;
  if (node.NodeType === 'SubPlan') antiPatternCount++;

  const planRows = node['Plan Rows'] || 0;

  if (antiPatternCount >= 2 && planRows > 10000) {
    return {
      rule_id: 'RC-109',
      rule_name: 'Multiple Anti-Patterns in Same Predicate',
      triggered: true,
      severity: 'CRITICAL',
      confidence: 'MEDIUM',
      carbon_reason: 'Multiple anti-patterns compound: function + cast + correlation = exponential cost multiplier',
      affected_node: {
        type: node.NodeType,
        plan_rows: planRows,
        anti_pattern_count: antiPatternCount,
        patterns: [
          antiPatternCount > 0 ? 'function_wrapping' : '',
          antiPatternCount > 1 ? 'type_cast' : '',
          antiPatternCount > 2 ? 'non_sargable' : '',
          antiPatternCount > 3 ? 'correlation' : '',
        ].filter(p => p),
      },
      recommendation: `URGENT: Refactor predicate to eliminate ALL anti-patterns. Prioritize function removal.`,
      fix_suggestion: `-- Comprehensive refactor: Remove function, cast, and correlation. Use clean JOIN instead.`,
      runtime_reduction_pct: 92,
      estimated_savings: {
        runtime_reduction_pct: 92,
        cost_reduction_pct: 78.2,
        carbon_reduction_pct: Math.round(92 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * RC-110: False Positive Optimization Detection Guard
 * trigger: Query marked as "optimized" but contains correlated subquery OR function on indexed column
 * carbon reason: Guard against incorrect optimization claims; override to mark as NOT optimized
 */
function checkRC110_FalsePositiveOptimizationGuard(node, context = {}) {
  const isMarkedOptimized = context.marked_optimized || false;
  if (!isMarkedOptimized) return null;

  // Check for anti-patterns that should disqualify "optimized" claim
  const filter = (node.Filter || '');
  const hasSubPlan = node.Plans && node.Plans.some(p => p.NodeType === 'SubPlan');
  const hasCorrelation = hasSubPlan && (context.parent_rows || 0) > 1;
  const hasFunctionOnFilter = /LOWER\(|UPPER\(|TRIM\(|EXTRACT\(|SUBSTRING\(/.test(filter);

  if ((hasCorrelation || hasFunctionOnFilter) && (node['Plan Rows'] || 0) > 1000) {
    return {
      rule_id: 'RC-110',
      rule_name: 'False Positive Optimization Detection Guard',
      triggered: true,
      severity: 'CRITICAL',
      confidence: 'HIGH',
      carbon_reason: 'Query marked optimized but contains anti-patterns (correlation/functions); override claim',
      affected_node: {
        type: node.NodeType,
        marked_optimized: true,
        actual_optimization_status: 'DEGRADED',
        found_correlation: hasCorrelation,
        found_function_on_indexed: hasFunctionOnFilter,
      },
      recommendation: `Override: Mark query as NOT optimized. Found anti-patterns despite optimization claim.`,
      fix_suggestion: `-- WARNING: Query optimization claim INVALID. Found: ${hasCorrelation ? 'correlated subquery + ' : ''}${hasFunctionOnFilter ? 'function on indexed column' : ''}. Refactor required.`,
      runtime_reduction_pct: 85,
      estimated_savings: {
        runtime_reduction_pct: 85,
        cost_reduction_pct: 72.25,
        carbon_reduction_pct: Math.round(85 * (1 + (context.grid_intensity || 475 - 400) / 1000) * 100) / 100,
      },
    };
  }

  return null;
}

/**
 * Evaluate all index rules against a query plan node recursively
 * Returns array of rule violations found
 *
 * @param {object} node - Single node from PostgreSQL EXPLAIN JSON plan
 * @param {object} context - Context metrics { planner_cost, grid_intensity, etc }
 * @returns {Array<object>} Array of triggered rule violations (null values filtered out)
 */
function evaluateNodeRules(node, context = {}) {
  if (!node || typeof node !== 'object') return [];

  // Check all rules for this node
  const violations = [
    checkRC001_SeqScanLargeTable(node, context),
    checkRC002_IndexHighFilterDiscard(node, context),
    checkRC003_BitmapHeapScanRecheck(node, context),
    checkRC004_UnindexedForeignKey(node, context),
    checkRC005_PoorlySelectiveIndex(node, context),
    checkRC006_NestedLoopWithoutIndex(node, context),
    checkRC007_HashAggregateOnLargeSet(node, context),
    checkRC008_MergeJoinUnsortedInput(node, context),
    checkRC009_CartesianProductRisk(node, context),
    checkRC010_HashJoinSkewedDistribution(node, context),
    checkRC011_IndexJoinOnLowCardinality(node, context),
    checkRC012_CrossJoinWithFilter(node, context),
    checkRC013_StaleTableStatistics(node, context),
    checkRC014_MissingColumnStatistics(node, context),
    checkRC015_TableBloat(node, context),
    checkRC016_IndexBloat(node, context),
    checkRC017_PartialVacuumOpportunity(node, context),
    checkRC018_N_Plus_One_Pattern(node, context),
    checkRC019_HistogramSkew(node, context),
    checkRC020_VolatileFunctionInFilter(node, context),
    checkRC021_ScalarSubqueryInSelect(node, context),
    checkRC022_CorrelatedSubqueryInWhere(node, context),
    checkRC023_INSubqueryVsEXISTS(node, context),
    checkRC024_LateralSubqueryOverhead(node, context),
    checkRC025_SubqueryMaterializationOpportunity(node, context),
    checkRC026_AggregateSubqueryInefficiency(node, context),
    checkRC027_ExpensiveSubqueryInHaving(node, context),
    checkRC028_ImplicitTypeCastInFilter(node, context),
    checkRC029_FunctionOnIndexedColumn(node, context),
    checkRC030_ORConditionAvoidingIndex(node, context),
    checkRC031_LikeWithLeadingWildcard(node, context),
    checkRC032_ExpensiveGroupByLargeCardinality(node, context),
    checkRC033_WindowFunctionUnsorted(node, context),
    checkRC034_DuplicateAggregation(node, context),
    checkRC035_DISTINCTOrderingInefficiency(node, context),
    checkRC036_ExpensiveUNIONWithoutAll(node, context),
    checkRC037_WorkMemoryPressure(node, context),
    checkRC038_SequentialScanHighIO(node, context),
    checkRC039_ParallelWorkerOverhead(node, context),
    checkRC040_SharedBufferCacheMisses(node, context),
    checkRC041_LockContentionRisk(node, context),
    checkRC042_InefficientPageUtilization(node, context),
    checkRC043_JITCompilationOverhead(node, context),
    checkRC044_DenormalizationOpportunity(node, context),
    checkRC045_PartitionKeyInefficiency(node, context),
    checkRC046_InheritedTablePenalty(node, context),
    checkRC047_PartialIndexApplicability(node, context),
    checkRC048_CoveringIndexOpportunity(node, context),
    checkRC049_DISTINCTvsGroupBy(node, context),
    checkRC050_CTEMaterializationPolicy(node, context),
    checkRC051_LimitPlacementOptimization(node, context),
    checkRC052_ORConditionOptimizationUnion(node, context),
    checkRC053_ExpensiveOuterJoin(node, context),
    checkRC054_FullOuterJoinOverhead(node, context),
    checkRC055_ComplexExpressionEvaluation(node, context),
    checkRC056_CorrelatedAggregateSubquery(node, context),
    checkRC057_RepeatedTableScanCorrelated(node, context),
    checkRC058_MissingPreAggregationBeforeJoin(node, context),
    checkRC059_AggregateSubqueryInsteadOfJoin(node, context),
    checkRC060_ScalarSubqueryMultiRowRisk(node, context),
    checkRC061_NestedLoopLargeTablesNoIndex(node, context),
    checkRC062_JoinWithoutPredicate(node, context),
    checkRC063_JoinKeyTypeMismatch(node, context),
    checkRC064_RedundantJoinElimination(node, context),
    checkRC065_JoinOnNonIndexedColumns(node, context),
    checkRC066_MultiColumnJoinNoComposite(node, context),
    checkRC067_SkewedJoinDistribution(node, context),
    checkRC068_IndexNotUsedFunctionWrapping(node, context),
    checkRC069_IndexNotUsedTypeCast(node, context),
    checkRC070_MissingCoveringIndex(node, context),
    checkRC071_OverIndexing(node, context),
    checkRC072_BitmapHeapScanOpportunityMissed(node, context),
    checkRC073_SequentialScanSelectivePredicate(node, context),
    checkRC074_NonSargablePredicate(node, context),
    checkRC075_BetweenOptimization(node, context),
    checkRC076_ORPreventingIndexUsage(node, context),
    checkRC077_NotInWithNullRisk(node, context),
    checkRC078_InefficientLikePattern(node, context),
    checkRC079_GroupByHighCardinality(node, context),
    checkRC080_HavingInsteadOfWhere(node, context),
    checkRC081_CountVsCountColumn(node, context),
    checkRC082_RedundantDistinctWithGroupBy(node, context),
    checkRC083_DuplicateAggregationComputation(node, context),
    checkRC084_WindowFunctionNoPartitionIndex(node, context),
    checkRC085_WindowFunctionLargeDataset(node, context),
    checkRC086_MultipleWindowSamePartition(node, context),
    checkRC087_UnnecessaryCTEMaterialization(node, context),
    checkRC088_ReusedCTENoMaterialization(node, context),
    checkRC089_MissingExtendedStatistics(node, context),
    checkRC090_CorrelatedColumnsNoStats(node, context),
    checkRC091_OutdatedAnalyzeFrequency(node, context),
    checkRC092_SortSpillToDisk(node, context),
    checkRC093_HashSpillToDisk(node, context),
    checkRC094_ExcessiveTemporaryFiles(node, context),
    checkRC095_SelectAllUsage(node, context),
    checkRC096_DeeplyNestedSubqueries(node, context),
    checkRC097_UnionInsteadOfUnionAll(node, context),
    checkRC098_OrderByWithoutLimit(node, context),
    checkRC099_LimitAfterJoinInsteadOfBefore(node, context),
    checkRC100_MissingParallelQuery(node, context),
    checkRC101_OveruseParallelWorkers(node, context),
    checkRC102_InefficientJsonProcessing(node, context),
    checkRC103_RepeatedExpressionEvaluation(node, context),
    checkRC104_InefficientCaseExpression(node, context),
    checkRC105_LackQueryResultCaching(node, context),
    checkRC106_FunctionCastOnJoinPredicate(node, context),
    checkRC107_CorrelatedSubqueryNonSargable(node, context),
    checkRC108_IndexDisabledByExpressionJoin(node, context),
    checkRC109_MultipleAntiPatternsCompound(node, context),
    checkRC110_FalsePositiveOptimizationGuard(node, context),
  ].filter(v => v !== null);

  // Recursively check child nodes (Plans)
  if (node.Plans && Array.isArray(node.Plans)) {
    for (const childNode of node.Plans) {
      violations.push(...evaluateNodeRules(childNode, context));
    }
  }

  return violations;
}

/**
 * Main entry point: Analyze entire query plan
 * 
 * @param {object} plan - PostgreSQL EXPLAIN JSON plan (root node)
 * @param {object} context - Context: { planner_cost, grid_intensity, sql_text }
 * @returns {object} Index rule analysis results
 */
function analyzeIndexPatterns(plan, context = {}) {
  if (!plan) {
    return {
      violations: [],
      rule_count: 0,
      high_severity: 0,
      medium_severity: 0,
      combined_runtime_reduction_pct: 0,
      combined_carbon_reduction_pct: 0,
    };
  }

  // Evaluate all rules across the plan tree
  const violations = evaluateNodeRules(plan, context);

  // Calculate statistics
  const highSeverity = violations.filter(v => v.severity === 'HIGH').length;
  const mediumSeverity = violations.filter(v => v.severity === 'MEDIUM').length;

  // Combine runtime reductions from all violations
  const runtimeReductions = violations.map(v => v.runtime_reduction_pct);
  const combinedRuntimeReduction = combineRuleReductions(runtimeReductions);

  // Carbon reduction scales with grid intensity
  const gridIntensity = context.grid_intensity || 475;
  const carbonMultiplier = 1 + (gridIntensity - 400) / 1000;
  const combinedCarbonReduction = Math.round(combinedRuntimeReduction * carbonMultiplier * 100) / 100;

  return {
    violations,
    rule_count: violations.length,
    high_severity: highSeverity,
    medium_severity: mediumSeverity,
    combined_runtime_reduction_pct: combinedRuntimeReduction,
    combined_carbon_reduction_pct: combinedCarbonReduction,
    estimated_improvements: {
      runtime_savings_pct: combinedRuntimeReduction,
      carbon_savings_pct: combinedCarbonReduction,
      cost_savings_pct: Math.round(combinedRuntimeReduction * 0.85 * 100) / 100,
    },
  };
}

/**
 * Combine multiple rule reductions using multiplicative formula
 * total = 1 - product of (1 - r_i/100)
 *
 * @param {Array<number>} reductions - Array of reduction percentages
 * @returns {number} Combined reduction percentage
 */
function combineRuleReductions(reductions) {
  if (!reductions || reductions.length === 0) return 0;
  if (reductions.length === 1) return reductions[0];

  const product = reductions.reduce((acc, r) => {
    return acc * (1 - r / 100);
  }, 1);

  return Math.round((1 - product) * 100 * 100) / 100;
}

module.exports = {
  analyzeIndexPatterns,
  evaluateNodeRules,
  checkRC001_SeqScanLargeTable,
  checkRC002_IndexHighFilterDiscard,
  checkRC003_BitmapHeapScanRecheck,
  checkRC004_UnindexedForeignKey,
  checkRC005_PoorlySelectiveIndex,
  checkRC006_NestedLoopWithoutIndex,
  checkRC007_HashAggregateOnLargeSet,
  checkRC008_MergeJoinUnsortedInput,
  checkRC009_CartesianProductRisk,
  checkRC010_HashJoinSkewedDistribution,
  checkRC011_IndexJoinOnLowCardinality,
  checkRC012_CrossJoinWithFilter,
  checkRC013_StaleTableStatistics,
  checkRC014_MissingColumnStatistics,
  checkRC015_TableBloat,
  checkRC016_IndexBloat,
  checkRC017_PartialVacuumOpportunity,
  checkRC018_N_Plus_One_Pattern,
  checkRC019_HistogramSkew,
  checkRC020_VolatileFunctionInFilter,
  checkRC021_ScalarSubqueryInSelect,
  checkRC022_CorrelatedSubqueryInWhere,
  checkRC023_INSubqueryVsEXISTS,
  checkRC024_LateralSubqueryOverhead,
  checkRC025_SubqueryMaterializationOpportunity,
  checkRC026_AggregateSubqueryInefficiency,
  checkRC027_ExpensiveSubqueryInHaving,
  checkRC028_ImplicitTypeCastInFilter,
  checkRC029_FunctionOnIndexedColumn,
  checkRC030_ORConditionAvoidingIndex,
  checkRC031_LikeWithLeadingWildcard,
  checkRC032_ExpensiveGroupByLargeCardinality,
  checkRC033_WindowFunctionUnsorted,
  checkRC034_DuplicateAggregation,
  checkRC035_DISTINCTOrderingInefficiency,
  checkRC036_ExpensiveUNIONWithoutAll,
  checkRC037_WorkMemoryPressure,
  checkRC038_SequentialScanHighIO,
  checkRC039_ParallelWorkerOverhead,
  checkRC040_SharedBufferCacheMisses,
  checkRC041_LockContentionRisk,
  checkRC042_InefficientPageUtilization,
  checkRC043_JITCompilationOverhead,
  checkRC044_DenormalizationOpportunity,
  checkRC045_PartitionKeyInefficiency,
  checkRC046_InheritedTablePenalty,
  checkRC047_PartialIndexApplicability,
  checkRC048_CoveringIndexOpportunity,
  checkRC049_DISTINCTvsGroupBy,
  checkRC050_CTEMaterializationPolicy,
  checkRC051_LimitPlacementOptimization,
  checkRC052_ORConditionOptimizationUnion,
  checkRC053_ExpensiveOuterJoin,
  checkRC054_FullOuterJoinOverhead,
  checkRC055_ComplexExpressionEvaluation,
  checkRC056_CorrelatedAggregateSubquery,
  checkRC057_RepeatedTableScanCorrelated,
  checkRC058_MissingPreAggregationBeforeJoin,
  checkRC059_AggregateSubqueryInsteadOfJoin,
  checkRC060_ScalarSubqueryMultiRowRisk,
  checkRC061_NestedLoopLargeTablesNoIndex,
  checkRC062_JoinWithoutPredicate,
  checkRC063_JoinKeyTypeMismatch,
  checkRC064_RedundantJoinElimination,
  checkRC065_JoinOnNonIndexedColumns,
  checkRC066_MultiColumnJoinNoComposite,
  checkRC067_SkewedJoinDistribution,
  checkRC068_IndexNotUsedFunctionWrapping,
  checkRC069_IndexNotUsedTypeCast,
  checkRC070_MissingCoveringIndex,
  checkRC071_OverIndexing,
  checkRC072_BitmapHeapScanOpportunityMissed,
  checkRC073_SequentialScanSelectivePredicate,
  checkRC074_NonSargablePredicate,
  checkRC075_BetweenOptimization,
  checkRC076_ORPreventingIndexUsage,
  checkRC077_NotInWithNullRisk,
  checkRC078_InefficientLikePattern,
  checkRC079_GroupByHighCardinality,
  checkRC080_HavingInsteadOfWhere,
  checkRC081_CountVsCountColumn,
  checkRC082_RedundantDistinctWithGroupBy,
  checkRC083_DuplicateAggregationComputation,
  checkRC084_WindowFunctionNoPartitionIndex,
  checkRC085_WindowFunctionLargeDataset,
  checkRC086_MultipleWindowSamePartition,
  checkRC087_UnnecessaryCTEMaterialization,
  checkRC088_ReusedCTENoMaterialization,
  checkRC089_MissingExtendedStatistics,
  checkRC090_CorrelatedColumnsNoStats,
  checkRC091_OutdatedAnalyzeFrequency,
  checkRC092_SortSpillToDisk,
  checkRC093_HashSpillToDisk,
  checkRC094_ExcessiveTemporaryFiles,
  checkRC095_SelectAllUsage,
  checkRC096_DeeplyNestedSubqueries,
  checkRC097_UnionInsteadOfUnionAll,
  checkRC098_OrderByWithoutLimit,
  checkRC099_LimitAfterJoinInsteadOfBefore,
  checkRC100_MissingParallelQuery,
  checkRC101_OveruseParallelWorkers,
  checkRC102_InefficientJsonProcessing,
  checkRC103_RepeatedExpressionEvaluation,
  checkRC104_InefficientCaseExpression,
  checkRC105_LackQueryResultCaching,
  checkRC106_FunctionCastOnJoinPredicate,
  checkRC107_CorrelatedSubqueryNonSargable,
  checkRC108_IndexDisabledByExpressionJoin,
  checkRC109_MultipleAntiPatternsCompound,
  checkRC110_FalsePositiveOptimizationGuard,
  combineRuleReductions,
};
