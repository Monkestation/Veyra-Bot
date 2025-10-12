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
      locale: "en",
      expiryTime: 3600, // 1 hour
      sessionLength: 600, // 10 minutes
      documents: ["ID_CARD", "PASSPORT", "DRIVER_LICENSE"],
      tokenType: "IDENTIFICATION", // This enables face matching
      generateDigitString: false,
      showInstructions: true,
    };

    logger.debug("iDenfy Request Body:", JSON.stringify(requestBody, null, 2));
    logger.debug(
      "Using API Key:",
      config.IDENFY_API_KEY?.substring(0, 8) + "..."
    );

    const response = await axios.post(
      `${config.IDENFY_BASE_URL}/api/v2/token`,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        auth: {
          username: config.IDENFY_API_KEY,
          password: config.IDENFY_API_SECRET,
        },
      }
    );

    logger.debug("iDenfy Response:", JSON.stringify(response.data, null, 2));

    return {
      sessionToken: response.data.authToken,
      scanRef: response.data.scanRef,
      clientId: clientId,
      verificationUrl: `${config.IDENFY_BASE_URL}/api/v2/redirect?authToken=${response.data.authToken}`,
    };
  } catch (error) {
    logger.error({
      message: "iDenfy verification error",
      error,
      context: {
        discordId,
        ckey
      }
    });
    throw error;
  }
}

// Get verification status from iDenfy
async function getIdenfyVerificationStatus(scanRef) {
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
}

// Function to delete iDenfy verification data
async function deleteIdenfyData(scanRef) {
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
}

module.exports = {
  createIdenfyVerification,
  getIdenfyVerificationStatus,
  deleteIdenfyData
};