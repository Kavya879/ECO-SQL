const { estimateOptimizationImpact } = require('../services/impactEstimator');

const EXAMPLES = [
  {
    name: 'seqScanIndexCandidate',
    currentMetrics: {
      cost: 5200,
      rows: 120000,
      co2: 0.42,
    },
    rootCauses: [
      {
        type: 'FULL_TABLE_SCAN',
        evidence: {
          hasSeqScan: true,
          filterColumns: ['email'],
          relationNames: ['users'],
        },
      },
    ],
  },
  {
    name: 'starProjectionOnly',
    currentMetrics: {
      cost: 800,
      rows: 4000,
      co2: 0.05,
    },
    rootCauses: [
      {
        type: 'OVER_FETCHING',
        evidence: {
          selectStar: true,
        },
      },
    ],
  },
  {
    name: 'mixedOptimizations',
    currentMetrics: {
      cost: 9000,
      rows: 200000,
      co2: 0.88,
    },
    rootCauses: [
      {
        type: 'FULL_TABLE_SCAN',
        evidence: {
          hasSeqScan: true,
          filterColumns: ['customer_id'],
        },
      },
      {
        type: 'HIGH_SCAN_INEFFICIENCY',
        evidence: {
          rowsScanned: 200000,
          rowsReturned: 120,
          ratio: 1666.67,
        },
      },
      {
        type: 'JOIN_EXPLOSION',
        evidence: {
          ratio: 120,
        },
      },
    ],
  },
];

for (const testCase of EXAMPLES) {
  console.log(`\n${testCase.name}`);
  console.log(JSON.stringify(estimateOptimizationImpact(testCase.currentMetrics, testCase.rootCauses), null, 2));
}