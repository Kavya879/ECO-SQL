/**
 * Parse PostgreSQL EXPLAIN (ANALYZE, FORMAT JSON) output
 * Top-level: [{ Plan: {...}, "Planning Time": n, "Execution Time": n }]
 */

export function parseExplainJson(rows) {
  if (!rows?.length) return null;
  const raw = rows[0];
  const keys = Object.keys(raw || {});
  const json = keys.length ? raw[keys[0]] : null;
  if (json == null) return null;
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    const top = Array.isArray(parsed) ? parsed[0] : parsed;
    const plan = top?.Plan ?? top?.plan ?? top;
    const acc = extractPlanMetrics(plan);
    acc.planningTime = top['Planning Time'] ?? top.planning_time ?? acc.planningTime;
    acc.executionTime = top['Execution Time'] ?? top.execution_time ?? top['Total Runtime'] ?? acc.executionTime;
    return acc;
  } catch {
    return null;
  }
}

function extractPlanMetrics(node, acc = { totalCost: 0, actualTime: 0, rows: 0 }) {
  if (!node) return acc;

  const cost = node['Total Cost'] ?? node.total_cost;
  const actualTime = node['Actual Total Time'] ?? node.actual_total_time;
  const actualRows = node['Actual Rows'] ?? node.actual_rows;

  if (cost != null) acc.totalCost = Math.max(acc.totalCost, parseFloat(cost));
  if (actualTime != null) acc.actualTime = Math.max(acc.actualTime, parseFloat(actualTime));
  if (actualRows != null) acc.rows += parseInt(actualRows, 10) || 0;

  for (const child of node.Plans || node.plans || []) {
    extractPlanMetrics(child, acc);
  }
  return acc;
}

export function getRuntimeMs(parsed) {
  if (!parsed) return null;
  if (parsed.executionTime != null) return parsed.executionTime;
  if (parsed.actualTime != null) return parsed.actualTime;
  return null;
}

export function getPlannerCost(parsed) {
  return parsed?.totalCost ?? null;
}

export function getRowsExamined(parsed) {
  return parsed?.rows ?? null;
}
