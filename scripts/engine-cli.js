'use strict';
/**
 * CLI runner for testing the native scheduler engine locally or in CI.
 * Usage: node scripts/engine-cli.js
 */
const { runDueWorkflows } = require('../lib/engine');

async function main() {
  console.log('[engine-cli] Checking and executing due workflows...');
  try {
    const result = await runDueWorkflows();
    console.log('[engine-cli] Result:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('[engine-cli] Error:', err.message);
    process.exit(1);
  }
}

main();
