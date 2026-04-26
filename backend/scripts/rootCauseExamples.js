const { analyzeRootCauses } = require('../services/rootCauseAnalyzer');

const EXAMPLES = [
  {
    name: 'scanHeavyStarQuery',
    astFeatures: {
      selectStar: true,
      selectExpressions: ['*'],
      joinCount: 0,
      joinTypes: [],
    },
    planMetrics: {
      totalCost: 90,
      rowsScanned: 50000,
      rowsReturned: 120,
      nodeTypes: ['Seq Scan'],
      hasSeqScan: true,
      hasIndexScan: false,
      joinTypes: [],
      maxNodeCost: 90,
      relationNames: ['orders'],
    },
  },
  {
    name: 'joinHeavyQuery',
    astFeatures: {
      selectStar: false,
      selectExpressions: ['o.id', 'c.name'],
      joinCount: 2,
      joinTypes: ['inner', 'left'],
    },
    planMetrics: {
      totalCost: 210,
      rowsScanned: 120000,
      rowsReturned: 80,
      nodeTypes: ['Hash Join', 'Seq Scan', 'Index Scan'],
      hasSeqScan: true,
      hasIndexScan: true,
      joinTypes: ['Hash Join', 'Nested Loop'],
      maxNodeCost: 210,
      relationNames: ['orders', 'customers'],
    },
  },
  {
    name: 'cpuBoundQuery',
    astFeatures: {
      selectStar: false,
      selectExpressions: ['customer_id', 'COUNT(*)'],
      joinCount: 0,
      joinTypes: [],
    },
    planMetrics: {
      totalCost: 180,
      rowsScanned: 800,
      rowsReturned: 40,
      nodeTypes: ['Aggregate', 'Index Scan'],
      hasSeqScan: false,
      hasIndexScan: true,
      joinTypes: [],
      maxNodeCost: 180,
      relationNames: ['events'],
    },
  },
];

for (const testCase of EXAMPLES) {
  const findings = analyzeRootCauses(testCase.astFeatures, testCase.planMetrics);

  console.log(`\n${testCase.name}`);
  console.log(JSON.stringify(findings, null, 2));
}