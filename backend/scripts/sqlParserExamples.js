const { TEST_QUERIES, parseQuery, extractQueryStructure } = require('../services/sqlParser');

async function run() {
  for (const testCase of TEST_QUERIES) {
    const ast = await parseQuery(testCase.sql);
    const structure = ast ? await extractQueryStructure(ast) : null;

    console.log(`\n${testCase.name}`);
    console.log(JSON.stringify({
      sql: testCase.sql,
      astType: ast ? ast.constructor?.name : null,
      structure,
    }, null, 2));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});