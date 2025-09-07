const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

// Create iDenfy verification session
async function createIdenfyVerification(discordId, ckey) {
  try {
    const clientId = `discord-${discordId}`;
    
    const requestBody = {
      clientId: clientId,
      externalRef: `ckey-${ckey}`,
      locale: 'en',
      expiryTime: 3600, // 1 hour
      sessionLength: 600,   // 10 minutes
      documents: ['ID_CARD', 'PASSPORT', 'DRIVER_LICENSE'],
      tokenType: 'IDENTIFICATION', // This enables face matching
      generateDigitString: false,
      showInstructions: true
    };

    if (config.DEBUG_MODE) {
      logger.info('iDenfy Request Body:', JSON.stringify(requestBody, null, 2));
      logger.info('Using API Key:', config.IDENFY_API_KEY?.substring(0, 8) + '...');
    }

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

    if (config.DEBUG_MODE) {
      logger.info('iDenfy Response:', JSON.stringify(response.data, null, 2));
    }

    return {
      sessionToken: response.data.authToken,
      scanRef: response.data.scanRef,
      clientId: clientId,
      verificationUrl: `${config.IDENFY_BASE_URL}/api/v2/redirect?authToken=${response.data.authToken}`
    };
  } catch (error) {
    logger.error('Failed to create iDenfy verification:', error.response?.data || error.message);
    if (config.DEBUG_MODE && error.response) {
      logger.error('Response status:', error.response.status);
      logger.error('Response headers:', error.response.headers);
      logger.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// Get verification status from iDenfy
async function getIdenfyVerificationStatus(scanRef) {
  try {
    const response = await axios.post(`${config.IDENFY_BASE_URL}/api/v2/status`, {
      scanRef: scanRef
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      auth: {
        username: config.IDENFY_API_KEY,
        password: config.IDENFY_API_SECRET
      }
    });
    
    return response.data;
  } catch (error) {
    logger.error('Failed to get iDenfy verification status:', error.response?.data || error.message);
    throw error;
  }
}

// Function to delete iDenfy verification data
async function deleteIdenfyData(scanRef) {
  try {
    const response = await fetch(`${config.IDENFY_BASE_URL}/api/v2/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${config.IDENFY_API_KEY}:${config.IDENFY_API_SECRET}`).toString('base64')}`
      },
      body: JSON.stringify({
        scanRef: scanRef
      })
    });

    if (!response.ok) {
      if (response.status !== 200) {
        const errorData = await response.json();
        throw new Error(`iDenfy deletion failed: ${errorData.message || 'Unknown error'}`);
      }
    }

    logger.info(`Successfully deleted iDenfy data for scanRef: ${scanRef}`);
  } catch (error) {
    logger.error(`Failed to delete iDenfy data for scanRef ${scanRef}:`, error);
    throw error;
  }
}

module.exports = {
  createIdenfyVerification,
  getIdenfyVerificationStatus,
  deleteIdenfyData
};