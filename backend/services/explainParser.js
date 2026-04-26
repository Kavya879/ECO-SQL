const FILTER_KEYS = ['Filter', 'Join Filter', 'Hash Cond', 'Merge Cond', 'Index Cond', 'Recheck Cond'];
const CHILD_PLAN_KEYS = ['Plans', 'InitPlan', 'Subplans'];
const SCAN_NODE_PATTERN = /(seq scan|index scan|index only scan|bitmap heap scan|bitmap index scan|cte scan|subquery scan|function scan|values scan|tid scan|table scan)/i;
const INDEX_SCAN_PATTERN = /(index scan|index only scan|bitmap index scan)/i;
const JOIN_NODE_PATTERN = /(join|loop)/i;

const TEST_PLANS = Object.freeze([
  {
    name: 'simpleSeqScan',
    plan: [
      {
        Plan: {
          'Node Type': 'Seq Scan',
          'Relation Name': 'customers',
          Alias: 'customers',
          'Startup Cost': 0.0,
          'Total Cost': 12.5,
          'Plan Rows': 100,
          'Actual Rows': 100,
          Filter: '(active = true)',
        },
      },
    ],
  },
  {
    name: 'hashJoin',
    plan: [
      {
        Plan: {
          'Node Type': 'Hash Join',
          'Startup Cost': 15.0,
          'Total Cost': 85.0,
          'Plan Rows': 50,
          'Actual Rows': 50,
          'Hash Cond': '(o.customer_id = c.id)',
          Plans: [
            {
              'Node Type': 'Seq Scan',
              'Relation Name': 'orders',
              Alias: 'o',
              'Startup Cost': 0.0,
              'Total Cost': 40.0,
              'Plan Rows': 500,
              'Actual Rows': 500,
              Filter: '(total > 100)',
            },
            {
              'Node Type': 'Hash',
              'Startup Cost': 10.0,
              'Total Cost': 10.0,
              'Plan Rows': 200,
              Plans: [
                {
                  'Node Type': 'Index Scan',
                  'Relation Name': 'customers',
                  Alias: 'c',
                  'Startup Cost': 0.5,
                  'Total Cost': 18.0,
                  'Plan Rows': 200,
                  'Actual Rows': 200,
                  'Index Cond': '(id = o.customer_id)',
                },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    name: 'nestedSubqueryPlan',
    plan: [
      {
        Plan: {
          'Node Type': 'Nested Loop',
          'Startup Cost': 20.0,
          'Total Cost': 120.0,
          'Plan Rows': 25,
          'Actual Rows': 25,
          Plans: [
            {
              'Node Type': 'Seq Scan',
              'Relation Name': 'orders',
              Alias: 'o',
              'Startup Cost': 0.0,
              'Total Cost': 35.0,
              'Plan Rows': 250,
              'Actual Rows': 250,
              Filter: '(customer_id IS NOT NULL)',
            },
            {
              'Node Type': 'Subquery Scan',
              Alias: 'subq',
              'Startup Cost': 5.0,
              'Total Cost': 70.0,
              'Plan Rows': 25,
              'Actual Rows': 25,
              Plans: [
                {
                  'Node Type': 'Aggregate',
                  'Startup Cost': 5.0,
                  'Total Cost': 65.0,
                  'Plan Rows': 25,
                  'Actual Rows': 25,
                  Plans: [
                    {
                      'Node Type': 'Index Scan',
                      'Relation Name': 'customers',
                      Alias: 'c',
                      'Startup Cost': 0.3,
                      'Total Cost': 18.0,
                      'Plan Rows': 100,
                      'Actual Rows': 100,
                      'Index Cond': '(region = \'EU\')',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  },
]);

function createEmptyStructure() {
  return {
    totalCost: 0,
    rowsScanned: 0,
    rowsReturned: 0,
    nodeTypes: [],
    hasSeqScan: false,
    hasIndexScan: false,
    joinTypes: [],
    maxNodeCost: 0,
    filters: [],
    relationNames: [],
  };
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizePlanInput(input) {
  if (!input) {
    return null;
  }

  if (typeof input === 'string') {
    try {
      return normalizePlanInput(JSON.parse(input));
    } catch (error) {
      return null;
    }
  }

  if (Array.isArray(input)) {
    return input[0] || null;
  }

  if (typeof input !== 'object') {
    return null;
  }

  if (input.Plan && typeof input.Plan === 'object') {
    return input.Plan;
  }

  if (input['Plan']) {
    return input['Plan'];
  }

  return input;
}

function getNodeType(node) {
  return String(node?.['Node Type'] || node?.NodeType || node?.nodeType || 'Unknown');
}

function getNodeCost(node) {
  return toNumber(node?.['Total Cost'] ?? node?.['Startup Cost']);
}

function getNodeRows(node) {
  if (node && Object.prototype.hasOwnProperty.call(node, 'Actual Rows')) {
    return toNumber(node['Actual Rows']);
  }

  return toNumber(node?.['Plan Rows']);
}

function getRelationName(node) {
  return String(node?.['Relation Name'] || node?.['CTE Name'] || '').trim();
}

function getChildPlans(node) {
  const children = [];

  for (const key of CHILD_PLAN_KEYS) {
    const value = node?.[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object') {
          children.push(child);
        }
      }
    }
  }

  return children;
}

function traversePlanTree(node, visitor, depth = 0, visited = new Set()) {
  if (!node || typeof node !== 'object' || visited.has(node)) {
    return;
  }

  visited.add(node);
  visitor(node, depth);

  for (const child of getChildPlans(node)) {
    traversePlanTree(child, visitor, depth + 1, visited);
  }
}

function collectFilters(node) {
  const filters = [];

  for (const key of FILTER_KEYS) {
    const value = node?.[key];
    if (value) {
      filters.push({
        nodeType: getNodeType(node),
        relationName: getRelationName(node) || null,
        filterType: key,
        condition: String(value),
      });
    }
  }

  return filters;
}

function isLeafPlan(node) {
  return getChildPlans(node).length === 0;
}

function isScanNode(node) {
  return SCAN_NODE_PATTERN.test(getNodeType(node));
}

function isJoinNode(node) {
  return JOIN_NODE_PATTERN.test(getNodeType(node));
}

function extractExplainPlanStructure(planInput) {
  const root = normalizePlanInput(planInput);
  const structure = createEmptyStructure();

  if (!root) {
    return structure;
  }

  const nodeTypes = [];
  const joinTypes = [];
  const relationNames = [];
  const filters = [];
  let rowsScanned = 0;
  let rowsReturned = 0;
  let totalCost = 0;
  let maxNodeCost = 0;
  let rootSeen = false;

  traversePlanTree(root, (node, depth) => {
    const nodeType = getNodeType(node);
    nodeTypes.push(nodeType);

    const relationName = getRelationName(node);
    if (relationName) {
      relationNames.push(relationName);
    }

    if (isJoinNode(node)) {
      joinTypes.push(nodeType);
    }

    filters.push(...collectFilters(node));

    const nodeCost = getNodeCost(node);
    if (nodeCost > maxNodeCost) {
      maxNodeCost = nodeCost;
    }

    if (!rootSeen && depth === 0) {
      totalCost = toNumber(node?.['Total Cost']);
      rowsReturned = getNodeRows(node);
      rootSeen = true;
    }

    if (isLeafPlan(node) && isScanNode(node)) {
      rowsScanned += getNodeRows(node);
    }
  });

  structure.totalCost = totalCost;
  structure.rowsScanned = rowsScanned;
  structure.rowsReturned = rowsReturned;
  structure.nodeTypes = unique(nodeTypes);
  structure.hasSeqScan = structure.nodeTypes.some((type) => type.toLowerCase() === 'seq scan');
  structure.hasIndexScan = structure.nodeTypes.some((type) => INDEX_SCAN_PATTERN.test(type));
  structure.joinTypes = unique(joinTypes);
  structure.maxNodeCost = maxNodeCost;
  structure.filters = filters;
  structure.relationNames = unique(relationNames);

  return structure;
}

module.exports = {
  TEST_PLANS,
  parseExplainPlan: normalizePlanInput,
  extractExplainPlanStructure,
  traversePlanTree,
};