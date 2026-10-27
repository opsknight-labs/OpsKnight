/* Shared bounded PostgreSQL query-plan evidence, without predicates or values. */
const fields = new Set([
  'Node Type',
  'Relation Name',
  'Index Name',
  'Actual Startup Time',
  'Actual Total Time',
  'Actual Rows',
  'Actual Loops',
  'Rows Removed by Filter',
  'Rows Removed by Index Recheck',
  'Shared Hit Blocks',
  'Shared Read Blocks',
]);
function boundedPlan(node) {
  return Object.fromEntries(
    Object.entries(node).flatMap(([key, value]) =>
      key === 'Plans' ? [[key, value.map(boundedPlan)]] : fields.has(key) ? [[key, value]] : []
    )
  );
}

module.exports = { boundedPlan };
