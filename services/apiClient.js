const axios = require('axios');
const config = require('../config/config');

let jwtToken = null;

// Axios instance for API calls
const api = axios.create({
  baseURL: config.API_BASE_URL,
  timeout: 10000
});

// Add JWT token to requests
api.interceptors.request.use(
  config => {
    if (jwtToken) {
      config.headers.Authorization = `Bearer ${jwtToken}`;
    }
    return config;
  },
  error => Promise.reject(error)
);

// Auto-refresh JWT token on 401
api.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401 && error.config && !error.config._retry) {
      error.config._retry = true;
      await authenticateAPI();
      return api(error.config);
    }
    return Promise.reject(error);
  }
);

// Authenticate with the API
async function authenticateAPI() {
  try {
    const response = await axios.post(`${config.API_BASE_URL}/api/auth/login`, {
      username: config.API_USERNAME,
      password: config.API_PASSWORD
    });
    jwtToken = response.data.token;
    console.log('Successfully authenticated with API');
  } catch (error) {
    console.error('Failed to authenticate with API:', error.message);
    throw error;
  }
}

// Check if daily verification limit is exceeded
async function checkDailyLimit() {
  try {
    const response = await api.get('/api/analytics');
    const { recent_verifications } = response.data;
    return recent_verifications >= config.DAILY_VERIFICATION_LIMIT;
  } catch (error) {
    console.error('Failed to check daily limit:', error.message);
    return false; // Allow verification on error
  }
}

// Submit verification to API
async function submitVerification(discordId, ckey, debugMode = false, scan_ref) {
  const verificationData = {
    discord_id: discordId,
    ckey: ckey,
    verified_flags: {
      byond_verified: true,
      id_verified: true,
      scan_ref: scan_ref
    },
    verification_method: debugMode ? 'debug' : 'idenfy'
  };

  if (debugMode) {
    verificationData.verified_flags.debug = true;
  }

  try {
    const response = await api.post('/api/v1/verify', verificationData);
    return response.data;
  } catch (error) {
    console.error('Failed to submit verification:', error.message);
    throw error;
  }
}

// Get existing verification
async function getExistingVerification(discordId) {
  try {
    const response = await api.get(`/api/v1/verify/${discordId}`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      return null; // Not found is expected
    }
    throw error;
  }
}

module.exports = {
  authenticateAPI,
  checkDailyLimit,
  submitVerification,
  getExistingVerification
};