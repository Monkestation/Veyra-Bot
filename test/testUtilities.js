const axios = require('axios');
const config = require('../config/config');

/**
 * iDenfy provides dummy sessions for testing in development environment
 * These generate real webhook responses without requiring actual document verification
 */

// Create a dummy verification session that will auto-complete with specified status
async function createDummyVerification(discordId, ckey, dummyStatus = 'APPROVED') {
  try {
    const clientId = `test-discord-${discordId}`;

    const requestBody = {
      clientId: clientId,
      externalRef: `test-ckey-${ckey}`,
      locale: 'en',
      expiryTime: 3600,
      sessionLength: 600,
      documents: ['ID_CARD', 'PASSPORT', 'DRIVER_LICENSE'],
      tokenType: 'IDENTIFICATION',
      generateDigitString: false,
      showInstructions: true,
      // This is the key parameter for dummy sessions
      dummyStatus: dummyStatus // Can be: APPROVED, DENIED, EXPIRED, SUSPECTED
    };

    console.log('Creating dummy verification with status:', dummyStatus);
    console.log('Request body:', JSON.stringify(requestBody, null, 2));

    const response = await axios.post(`${config.IDENFY_BASE_URL}/api/v2/token`, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      auth: {
        username: config.IDENFY_API_KEY,
        password: config.IDENFY_API_SECRET
      }
    });

    return {
      sessionToken: response.data.authToken,
      scanRef: response.data.scanRef,
      clientId: clientId,
      verificationUrl: `${config.IDENFY_BASE_URL}/api/v2/redirect?authToken=${response.data.authToken}`,
      dummyStatus: dummyStatus
    };
  } catch (error) {
    console.error('Failed to create dummy verification:', error.response?.data || error.message);
    throw error;
  }
}

// Manually trigger a dummy manual status (for testing manual review scenarios)
async function setDummyManualStatus(scanRef, manualStatus = 'FACE_MATCH,DOC_VALIDATED') {
  try {
    const requestBody = {
      scanRef: scanRef,
      manualStatus: manualStatus // Can be: FACE_MATCH, DOC_VALIDATED, FACE_MISMATCH, DOC_NOT_VALIDATED
    };

    console.log('Setting dummy manual status:', manualStatus, 'for scanRef:', scanRef);

    const response = await axios.post(`${config.IDENFY_BASE_URL}/api/v2/dummy-manual-status`, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      auth: {
        username: config.IDENFY_API_KEY,
        password: config.IDENFY_API_SECRET
      }
    });

    return response.data;
  } catch (error) {
    console.error('Failed to set dummy manual status:', error.response?.data || error.message);
    throw error;
  }
}

// Simulate a webhook call to your local server (for testing)
async function simulateWebhookCall(scanRef, status = 'APPROVED', webhookUrl = `http://localhost:${config.WEBHOOK_PORT}/webhook/idenfy`) {
  try {
    const webhookPayload = {
      scanRef: scanRef,
      status: status,
      platform: 'PC',
      clientId: `test-discord-123`,
      externalRef: 'test-ckey-testuser',
      final: true,
      autoDocument: status === 'APPROVED' ? 'DOC_VALIDATED' : 'DOC_NOT_VALIDATED',
      autoFace: status === 'APPROVED' ? 'FACE_MATCH' : 'FACE_MISMATCH',
      manualDocument: status === 'APPROVED' ? 'DOC_VALIDATED' : null,
      manualFace: status === 'APPROVED' ? 'FACE_MATCH' : null,
      additionalSteps: null,
      suspicionReasons: [],
      fraudTags: [],
      mismatchTags: [],
      reasonCode: null,
      ...(status === 'DENIED' && { reasonCode: 'DOC_NOT_VALIDATED' }),
      ...(status === 'SUSPECTED' && {
        suspicionReasons: ['FACE_SUSPICIOUS'],
        fraudTags: ['FACE_PHOTO_OF_PHOTO']
      })
    };

    console.log('Simulating webhook call to:', webhookUrl);
    console.log('Payload:', JSON.stringify(webhookPayload, null, 2));

    const response = await axios.post(webhookUrl, webhookPayload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'iDenfy-Webhook/1.0'
      },
      timeout: 5000
    });

    console.log('Webhook simulation response:', response.status, response.statusText);
    return response.data;
  } catch (error) {
    console.error('Failed to simulate webhook:', error.message);
    throw error;
  }
}

// Complete test flow: create dummy verification and simulate completion
async function runCompleteTestFlow(discordId, ckey, finalStatus = 'APPROVED') {
  try {
    console.log('\n=== Starting Complete Test Flow ===');
    console.log(`Discord ID: ${discordId}`);
    console.log(`CKEY: ${ckey}`);
    console.log(`Final Status: ${finalStatus}`);

    // Step 1: Create dummy verification
    console.log('\n1. Creating dummy verification...');
    const verification = await createDummyVerification(discordId, ckey, finalStatus);
    console.log('✅ Dummy verification created:', verification.scanRef);

    // Step 2: Wait a moment to simulate processing time
    console.log('\n2. Waiting 3 seconds to simulate processing...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 3: Simulate webhook callback
    console.log('\n3. Simulating webhook callback...');
    await simulateWebhookCall(verification.scanRef, finalStatus);
    console.log('✅ Webhook simulation completed');

    console.log('\n=== Test Flow Complete ===\n');
    return verification;
  } catch (error) {
    console.error('❌ Test flow failed:', error.message);
    throw error;
  }
}

// Test different verification scenarios
const testScenarios = {
  approved: (discordId, ckey) => runCompleteTestFlow(discordId, ckey, 'APPROVED'),
  denied: (discordId, ckey) => runCompleteTestFlow(discordId, ckey, 'DENIED'),
  expired: (discordId, ckey) => runCompleteTestFlow(discordId, ckey, 'EXPIRED'),
  suspected: (discordId, ckey) => runCompleteTestFlow(discordId, ckey, 'SUSPECTED')
};

// Interactive test menu
async function runInteractiveTest() {
  console.log('\n🧪 iDenfy Test Utility');
  console.log('=====================');
  console.log('Available test scenarios:');
  console.log('1. Approved verification');
  console.log('2. Denied verification');
  console.log('3. Expired verification');
  console.log('4. Suspected verification');
  console.log('5. Custom webhook simulation only');
  console.log('6. Exit');

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('\nSelect test scenario (1-6): ', async (choice) => {
      try {
        const testDiscordId = '123456789012345678';
        const testCkey = 'testuser' + Date.now();

        switch (choice) {
          case '1':
            await testScenarios.approved(testDiscordId, testCkey);
            break;
          case '2':
            await testScenarios.denied(testDiscordId, testCkey);
            break;
          case '3':
            await testScenarios.expired(testDiscordId, testCkey);
            break;
          case '4':
            await testScenarios.suspected(testDiscordId, testCkey);
            break;
          case '5': {
            const scanRef = 'test-scan-ref-' + Date.now();
            await simulateWebhookCall(scanRef, 'APPROVED');
            break;
          }
          case '6':
            console.log('Exiting...');
            break;
          default:
            console.log('Invalid choice');
        }
      } catch (error) {
        console.error('Test failed:', error.message);
      } finally {
        rl.close();
        resolve();
      }
    });
  });
}

module.exports = {
  createDummyVerification,
  setDummyManualStatus,
  simulateWebhookCall,
  runCompleteTestFlow,
  testScenarios,
  runInteractiveTest
};

// If this file is run directly, start interactive testing
if (require.main === module) {
  runInteractiveTest().then(() => {
    console.log('Testing complete!');
    process.exit(0);
  }).catch(error => {
    console.error('Testing failed:', error);
    process.exit(1);
  });
}