/**
 * Test backend API response with query optimizations
 */

const http = require('http');

// Test with a simple SELECT * query (should trigger R2 rewrite)
const testPayload = {
  sql: 'SELECT * FROM users WHERE active = true LIMIT 10',
  database: 'postgres'
};

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/analyze',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      
      console.log('\n' + '='.repeat(70));
      console.log('BACKEND API RESPONSE TEST');
      console.log('='.repeat(70));
      
      // Check if query_optimizations field exists
      if (response.query_optimizations) {
        console.log('\n✅ query_optimizations field present');
        console.log(`   - Was rewritten: ${response.query_optimizations.was_rewritten}`);
        console.log(`   - Total rewrites: ${response.query_optimizations.total_rewrites}`);
        
        if (response.query_optimizations.rewrites_applied.length > 0) {
          console.log(`\n   Applied rewrites:`);
          response.query_optimizations.rewrites_applied.forEach((r, i) => {
            console.log(`     ${i + 1}. [${r.rule_id}] ${r.rewrite_name}`);
            console.log(`        Carbon reduction: ${r.estimated_carbon_reduction_pct}%`);
          });
        }
        
        console.log(`\n   Optimization notes:\n   ${response.query_optimizations.optimization_notes.substring(0, 100)}...`);
      } else {
        console.log('\n❌ query_optimizations field NOT found in response');
        console.log('\n Response keys:');
        console.log('   ', Object.keys(response).slice(0, 20).join(', '));
      }
      
      // Also check index violations
      console.log(`\n   Index violations: ${response.index_rule_count || 0}`);
      
      console.log('\n' + '='.repeat(70) + '\n');
    } catch (e) {
      console.error('Error parsing response:', e);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e);
  console.log('\nMake sure backend server is running on localhost:5000');
});

console.log('\nSending test query to backend...');
console.log(`Query: ${testPayload.sql}`);
console.log(`Database: ${testPayload.database}\n`);

req.write(JSON.stringify(testPayload));
req.end();
