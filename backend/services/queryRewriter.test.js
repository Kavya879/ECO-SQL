/**
 * queryRewriter.test.js
 * Test cases for the query rewriter module
 * Valid test cases demonstrating each rewrite type
 */

const { rewriteQuery } = require('./queryRewriter');

// Test helper function
function runTest(name, sql, firedRules = [], explainPlan = null, context = {}) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST: ${name}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`SQL: ${sql}`);
  console.log(`Fired Rules: ${firedRules.length > 0 ? firedRules.map(r => r.rule_id).join(', ') : 'none'}`);
  
  const result = rewriteQuery(sql, firedRules, explainPlan, context);
  
  console.log(`\nResult:`);
  console.log(`  Was rewritten: ${result.was_rewritten}`);
  console.log(`  Total rewrites: ${result.total_rewrites}`);
  
  if (result.rewrites_applied.length > 0) {
    console.log(`\nRewrites applied:`);
    result.rewrites_applied.forEach((r, idx) => {
      console.log(`  ${idx + 1}. [${r.rule_id}] ${r.rewrite_name}`);
      console.log(`     Before: ${r.before_snippet}`);
      console.log(`     After:  ${r.after_snippet}`);
      console.log(`     Carbon reduction: ~${r.estimated_carbon_reduction_pct}%`);
    });
  }
  
  if (result.optimized_sql !== result.original_sql) {
    console.log(`\nOptimized SQL:\n${result.optimized_sql}`);
  }
  
  console.log(`\nNotes:\n${result.optimization_notes}`);
}

// ============================================================
// TEST CASES
// ============================================================

// R1: Add Missing LIMIT
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R1: Add Missing LIMIT — No LIMIT + rows > 10k                      ║');
console.log('╚' + '═'.repeat(68) + '╝');
const rc061 = {
  rule_id: 'RC-061',
  rule_name: 'Unbounded Result Set',
  severity: 'HIGH',
};
runTest(
  'R1: Add LIMIT when rows > 10k',
  'SELECT id, name FROM orders',
  [rc061],
  null,
  { rows_returned: 15000, plan_rows: 15000 }
);

// R2: Replace SELECT *
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R2: Replace SELECT * with Column Placeholder                      ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'R2: SELECT * replacement',
  'SELECT * FROM users WHERE active = true',
  [],
  null,
  {}
);

runTest(
  'R2: SELECT table.* replacement',
  'SELECT u.* FROM users u JOIN orders o ON u.id = o.user_id',
  [],
  null,
  {}
);

// R3: Replace OFFSET with Keyset Pagination
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R3: Replace OFFSET with Keyset Pagination                         ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'R3: OFFSET to keyset pagination',
  'SELECT * FROM products ORDER BY id LIMIT 20 OFFSET 400',
  [],
  null,
  {}
);

// R4: NOT IN to NOT EXISTS
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R4: Replace NOT IN with NOT EXISTS                                ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'R4: NOT IN to NOT EXISTS',
  'SELECT * FROM a WHERE id NOT IN (SELECT a_id FROM b)',
  [],
  null,
  {}
);

// R6: Index Suggestion (requires RC-001)
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R6: Index Suggestion Comment (RC-001 triggered)                   ║');
console.log('╚' + '═'.repeat(68) + '╝');
const rc001 = {
  rule_id: 'RC-001',
  rule_name: 'Sequential Scan on Large Table',
  severity: 'HIGH',
  affected_node: { relation_name: 'orders', plan_rows: 50000 },
  fix_suggestion: 'CREATE INDEX CONCURRENTLY idx_orders_customer_id ON orders(customer_id);',
  carbon_reason: 'Full table scan 10-100x more I/O than index scan',
};
runTest(
  'R6: Index suggestion (RC-001)',
  'SELECT * FROM orders WHERE customer_id = 123',
  [rc001],
  null,
  {}
);

// R9: COUNT(*) to pg_class
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R9: COUNT(*) to pg_class Lookup (O(1) instead of O(N))            ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'R9: COUNT(*) optimization',
  'SELECT COUNT(*) FROM events',
  [],
  null,
  {}
);

// R11: Remove Redundant ORDER BY in Subquery
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R11: Remove Redundant ORDER BY in Subquery                        ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'R11: Remove ORDER BY in subquery',
  'SELECT * FROM (SELECT id, name FROM users ORDER BY name) sub WHERE active = true',
  [],
  null,
  {}
);

// R12: IN (subquery) to EXISTS
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R12: IN Subquery to EXISTS                                        ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'R12: IN to EXISTS',
  'SELECT * FROM a WHERE id IN (SELECT a_id FROM b WHERE b.active = true)',
  [],
  null,
  {}
);

// R15: DISTINCT to GROUP BY
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R15: DISTINCT to GROUP BY (when rows > 10k)                       ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'R15: DISTINCT to GROUP BY',
  'SELECT DISTINCT customer_id, status FROM orders',
  [],
  null,
  { plan_rows: 25000 }
);

// R19: UNION to UNION ALL
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R19: UNION to UNION ALL (different tables)                        ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'R19: UNION to UNION ALL',
  'SELECT id FROM orders UNION SELECT id FROM archive_orders',
  [],
  null,
  {}
);

// R21: Implicit Cross Join to Explicit JOIN
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ R21: Implicit Cross Join to Explicit INNER JOIN                   ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'R21: Implicit join to explicit',
  'SELECT a.id, b.name FROM a, b WHERE a.id = b.a_id AND a.active = true',
  [],
  null,
  {}
);

// Complex example: Multiple rewrites
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ COMPLEX: Multiple Rewrites on Single Query                        ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'Multiple rewrites: SELECT *, no LIMIT, offset',
  'SELECT * FROM users LIMIT 50 OFFSET 200',
  [rc001],
  null,
  { rows_returned: 5000 }
);

// No rewrite case
console.log('\n\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║ NO-OP: Well-optimized query (no rewrites)                         ║');
console.log('╚' + '═'.repeat(68) + '╝');
runTest(
  'No rewrites needed',
  'SELECT id, name, email FROM users WHERE user_id = $1 LIMIT 10',
  [],
  null,
  {}
);

console.log('\n\n' + '═'.repeat(70));
console.log('All tests completed!');
console.log('═'.repeat(70) + '\n');
