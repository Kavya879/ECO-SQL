let sqlglotModulesPromise;

const FUNCTION_NODE_NAMES = new Set([
  'Func',
  'Anonymous',
  'Count',
  'Sum',
  'Avg',
  'Max',
  'Min',
  'Lower',
  'Upper',
  'Trim',
  'Coalesce',
  'Concat',
  'Case',
  'If',
]);

const AGGREGATE_NODE_NAMES = new Set(['Count', 'Sum', 'Avg', 'Max', 'Min']);

const TEST_QUERIES = Object.freeze([
  {
    name: 'simpleSelect',
    sql: 'SELECT id, name FROM customers WHERE active = TRUE ORDER BY name LIMIT 10;',
  },
  {
    name: 'join',
    sql: 'SELECT o.id, c.name FROM orders o INNER JOIN customers c ON c.id = o.customer_id WHERE o.total > 100;',
  },
  {
    name: 'nestedSubquery',
    sql: "SELECT customer_id FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE region = 'EU');",
  },
]);

function createEmptyStructure() {
  return {
    tables: [],
    columns: [],
    selectExpressions: [],
    whereConditions: [],
    groupBy: [],
    orderBy: [],
    joins: [],
    limit: null,
    selectStar: false,
    joinCount: 0,
    joinTypes: [],
    whereColumns: [],
    joinColumns: [],
    hasAggregation: false,
    hasFunctionInWhere: false,
    nestingDepth: 0,
    hasSelectStar: false,
    hasWhere: false,
    hasGroupBy: false,
    hasOrderBy: false,
    hasLimit: false,
    hasSubquery: false,
  };
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function nodeSql(node) {
  try {
    return typeof node?.sql === 'function' ? node.sql() : '';
  } catch (error) {
    return '';
  }
}

function containsStar(expression) {
  if (!expression || typeof expression.walk !== 'function') {
    return false;
  }

  for (const node of expression.walk()) {
    if (node?.constructor?.name === 'Star') {
      return true;
    }
  }

  return false;
}

function getNodeName(node) {
  return node?.constructor?.name || '';
}

function getNodeChildren(node) {
  const children = [];
  const args = node?.args || {};

  for (const value of Object.values(args)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          children.push(item);
        }
      }
    } else if (value && typeof value === 'object') {
      children.push(value);
    }
  }

  return children;
}

function traverseNode(node, visitor, options = {}) {
  if (!node || typeof node !== 'object') {
    return;
  }

  const {
    pruneNestedQueries = false,
    isRoot = false,
  } = options;

  visitor(node);

  const nodeName = getNodeName(node);
  if (pruneNestedQueries && !isRoot && (nodeName === 'Select' || nodeName === 'Subquery')) {
    return;
  }

  for (const child of getNodeChildren(node)) {
    traverseNode(child, visitor, {
      pruneNestedQueries,
      isRoot: false,
    });
  }
}

function collectTopLevelNodes(root, predicate) {
  const nodes = [];

  traverseNode(root, (node) => {
    if (predicate(node)) {
      nodes.push(node);
    }
  }, {
    pruneNestedQueries: true,
    isRoot: true,
  });

  return nodes;
}

function collectColumnsFromExpression(expression) {
  const columns = [];

  traverseNode(expression, (node) => {
    if (getNodeName(node) === 'Column') {
      columns.push(nodeSql(node));
    }
  }, {
    pruneNestedQueries: true,
    isRoot: true,
  });

  return unique(columns);
}

function containsFunctionNode(expression, nodeNames = FUNCTION_NODE_NAMES) {
  let found = false;

  traverseNode(expression, (node) => {
    if (nodeNames.has(getNodeName(node))) {
      found = true;
    }
  }, {
    pruneNestedQueries: true,
    isRoot: true,
  });

  return found;
}

function getJoinType(joinNode) {
  const rawType = joinNode?.args?.side?.value || joinNode?.args?.side || joinNode?.args?.kind?.value || joinNode?.args?.kind || '';
  const normalized = String(rawType).toLowerCase();

  if (normalized.includes('left')) {
    return 'left';
  }
  if (normalized.includes('cross')) {
    return 'cross';
  }
  if (normalized.includes('inner')) {
    return 'inner';
  }

  return normalized || 'inner';
}

function computeNestingDepth(node, depth = 0) {
  if (!node || typeof node !== 'object') {
    return depth;
  }

  const currentDepth = getNodeName(node) === 'Select' ? depth + 1 : depth;
  let maxDepth = currentDepth;

  for (const child of getNodeChildren(node)) {
    const childDepth = computeNestingDepth(child, currentDepth);
    if (childDepth > maxDepth) {
      maxDepth = childDepth;
    }
  }

  return maxDepth;
}

function isAggregationNode(node) {
  return AGGREGATE_NODE_NAMES.has(getNodeName(node));
}

async function loadSqlGlotModules() {
  if (!sqlglotModulesPromise) {
    sqlglotModulesPromise = Promise.all([
      import('sqlglot-ts'),
      import('sqlglot-ts/expressions'),
    ]).then(([core, expressions]) => ({
      parse: core.parse,
      expressions,
    }));
  }

  return sqlglotModulesPromise;
}

async function parseQuery(query) {
  const sql = typeof query === 'string' ? query.trim() : '';
  if (!sql) {
    return null;
  }

  try {
    const { parse } = await loadSqlGlotModules();
    const statements = parse(sql);
    return Array.isArray(statements) && statements.length > 0 ? statements[0] : null;
  } catch (error) {
    console.error('[sqlParser] Failed to parse query:', error.message);
    return null;
  }
}

async function extractQueryStructure(ast) {
  const structure = createEmptyStructure();

  if (!ast || typeof ast.findAll !== 'function') {
    return structure;
  }

  const { expressions } = await loadSqlGlotModules();
  const {
    Select,
    Table,
    Column,
    Join,
    Where,
    Group,
    Order,
    Limit,
    Subquery,
  } = expressions;

  const selectNodes = ast.constructor?.name === 'Select' ? [ast] : Array.from(ast.findAll(Select));
  const primarySelect = selectNodes[0] || null;

  if (primarySelect) {
    structure.selectExpressions = unique((primarySelect.expressions || []).map(nodeSql));
    structure.selectStar = (primarySelect.expressions || []).some(containsStar);
    structure.hasSelectStar = structure.selectStar;
    structure.hasAggregation = (primarySelect.expressions || []).some((expression) => containsFunctionNode(expression, AGGREGATE_NODE_NAMES));
  }

  structure.tables = unique(Array.from(ast.findAll(Table)).map(nodeSql));
  structure.columns = unique(Array.from(ast.findAll(Column)).map(nodeSql));
  const topLevelJoins = collectTopLevelNodes(ast, (node) => getNodeName(node) === 'Join');
  structure.joins = unique(topLevelJoins.map(nodeSql));
  structure.joinCount = topLevelJoins.length;
  structure.joinTypes = unique(topLevelJoins.map(getJoinType));

  const topLevelWhere = collectTopLevelNodes(ast, (node) => getNodeName(node) === 'Where')[0] || null;
  const topLevelGroup = collectTopLevelNodes(ast, (node) => getNodeName(node) === 'Group');
  const topLevelOrder = collectTopLevelNodes(ast, (node) => getNodeName(node) === 'Order');

  structure.whereConditions = topLevelWhere ? unique([nodeSql(topLevelWhere.this) || nodeSql(topLevelWhere)]) : [];
  structure.whereColumns = topLevelWhere ? collectColumnsFromExpression(topLevelWhere.this) : [];
  structure.hasFunctionInWhere = topLevelWhere ? containsFunctionNode(topLevelWhere.this) : false;
  structure.groupBy = unique(topLevelGroup.flatMap((node) => (node.expressions || []).map(nodeSql)));
  structure.orderBy = unique(topLevelOrder.flatMap((node) => (node.expressions || []).map(nodeSql)));
  structure.joinColumns = unique(topLevelJoins.flatMap((joinNode) => collectColumnsFromExpression(joinNode.args?.on)));

  const limitNodes = Array.from(ast.findAll(Limit));
  if (limitNodes.length > 0) {
    structure.limit = nodeSql(limitNodes[0].this) || nodeSql(limitNodes[0]);
  }

  structure.nestingDepth = computeNestingDepth(ast);
  structure.hasWhere = structure.whereConditions.length > 0;
  structure.hasGroupBy = structure.groupBy.length > 0;
  structure.hasOrderBy = structure.orderBy.length > 0;
  structure.hasLimit = limitNodes.length > 0;
  structure.hasSubquery = Array.from(ast.findAll(Subquery)).length > 0;

  return structure;
}

module.exports = {
  TEST_QUERIES,
  parseQuery,
  extractQueryStructure,
};