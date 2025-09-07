#!/usr/bin/env node

/**
 * Standalone test script for iDenfy integration
 * Run this independently of the Discord bot to test webhook functionality
 */

require('dotenv').config();
const { BooleanLike } = require('../utils/other');
const { runInteractiveTest, testScenarios, simulateWebhookCall } = require('./testUtilities');

async function main() {
  console.log('🧪 iDenfy Integration Test Suite');
  console.log('================================\n');

  if (process.argv.length > 2) {
    // Command line arguments
    const command = process.argv[2];
    const discordId = process.argv[3] || '123456789012345678';
    const ckey = process.argv[4] || 'testuser' + Date.now();
    
    console.log(`Running: ${command}`);
    console.log(`Discord ID: ${discordId}`);
    console.log(`CKEY: ${ckey}\n`);

    switch (command) {
      case 'approved':
        await testScenarios.approved(discordId, ckey);
        break;
      case 'denied':
        await testScenarios.denied(discordId, ckey);
        break;
      case 'expired':
        await testScenarios.expired(discordId, ckey);
        break;
      case 'suspected':
        await testScenarios.suspected(discordId, ckey);
        break;
      case 'webhook': {
        const scanRef = process.argv[5] || 'test-scan-ref-' + Date.now();
        const status = process.argv[6] || 'APPROVED';
        await simulateWebhookCall(scanRef, status);
        break;
      }
      default: {
        console.log('Unknown command. Available commands:');
        console.log('  approved   - Test approved verification');
        console.log('  denied     - Test denied verification');
        console.log('  expired    - Test expired verification');
        console.log('  suspected  - Test suspected verification');
        console.log('  webhook    - Simulate webhook only');
        console.log('\nUsage: node test/standaloneTest.js <command> [discordId] [ckey] [scanRef] [status]');
      }
    }
  } else {
    // Interactive mode
    await runInteractiveTest();
  }
}

main().then(() => {
  console.log('\n✅ Test completed successfully!');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Test failed:', error.message);
  if (BooleanLike(process.env.DEBUG_MODE ?? process.env.DEBUG)) {
    console.error(error.stack);
  }
  process.exit(1);
});