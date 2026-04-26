const { analyzeQuery } = require('../services/analysisPipeline');

async function run() {
  const query = `SELECT * FROM orders o INNER JOIN customers c ON c.id = o.customer_id WHERE o.total > 100`;
  const explainPlan = [
    {
      Plan: {
        'Node Type': 'Hash Join',
        'Startup Cost': 15,
        'Total Cost': 85,
        'Plan Rows': 50,
        'Actual Rows': 50,
        'Hash Cond': '(o.customer_id = c.id)',
        Plans: [
          {
            'Node Type': 'Seq Scan',
            'Relation Name': 'orders',
            'Startup Cost': 0,
            'Total Cost': 40,
            'Plan Rows': 500,
            'Actual Rows': 500,
            Filter: '(total > 100)',
          },
          {
            'Node Type': 'Index Scan',
            'Relation Name': 'customers',
            'Startup Cost': 0.5,
            'Total Cost': 18,
            'Plan Rows': 200,
            'Actual Rows': 200,
            'Index Cond': '(id = o.customer_id)',
          },
        ],
      },
    },
  ];

  const analysis = await analyzeQuery(query, explainPlan);
  console.log(JSON.stringify(analysis, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});