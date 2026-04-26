const { TEST_PLANS, parseExplainPlan, extractExplainPlanStructure } = require('../services/explainParser');

for (const testCase of TEST_PLANS) {
  const rootPlan = parseExplainPlan(testCase.plan);
  const structure = extractExplainPlanStructure(rootPlan);

  console.log(`\n${testCase.name}`);
  console.log(JSON.stringify({
    structure,
  }, null, 2));
}