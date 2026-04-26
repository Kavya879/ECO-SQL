const { buildSuggestions } = require('../services/suggestionEngine');

const EXAMPLES = [
  {
    name: 'fullScanWithFilter',
    rootCauses: [
      {
        type: 'FULL_TABLE_SCAN',
      },
    ],
    astFeatures: {
      selectStar: false,
      whereColumns: ['email'],
      joinColumns: [],
      joinTypes: [],
    },
    planMetrics: {
      rowsScanned: 120000,
      rowsReturned: 120,
      relationNames: ['users'],
      joinTypes: [],
    },
  },
  {
    name: 'starProjection',
    rootCauses: [
      {
        type: 'OVER_FETCHING',
      },
    ],
    astFeatures: {
      selectStar: true,
      whereColumns: [],
      joinColumns: [],
      joinTypes: [],
    },
    planMetrics: {
      rowsScanned: 400,
      rowsReturned: 40,
      relationNames: ['orders'],
      joinTypes: [],
    },
  },
  {
    name: 'joinExplosion',
    rootCauses: [
      {
        type: 'JOIN_EXPLOSION',
      },
      {
        type: 'HIGH_SCAN_INEFFICIENCY',
      },
    ],
    astFeatures: {
      selectStar: false,
      whereColumns: [],
      joinColumns: ['o.customer_id', 'c.id'],
      joinTypes: ['inner', 'left'],
    },
    planMetrics: {
      rowsScanned: 50000,
      rowsReturned: 100,
      relationNames: ['orders', 'customers'],
      joinTypes: ['Hash Join'],
    },
  },
];

for (const testCase of EXAMPLES) {
  const suggestionResult = buildSuggestions(testCase.rootCauses, testCase.astFeatures, testCase.planMetrics);

  console.log(`\n${testCase.name}`);
  console.log(JSON.stringify(suggestionResult, null, 2));
}