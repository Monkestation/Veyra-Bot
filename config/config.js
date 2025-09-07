const { BooleanLike } = require('../utils/other');

require('dotenv').config();

module.exports = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  API_BASE_URL: process.env.API_BASE_URL || "http://localhost:3000",
  API_USERNAME: process.env.API_USERNAME,
  API_PASSWORD: process.env.API_PASSWORD,
  IDENFY_API_KEY: process.env.IDENFY_API_KEY,
  IDENFY_API_SECRET: process.env.IDENFY_API_SECRET,
  IDENFY_BASE_URL: process.env.IDENFY_BASE_URL || "https://ivs.idenfy.com",
  DAILY_VERIFICATION_LIMIT:
    parseInt(process.env.DAILY_VERIFICATION_LIMIT) || 25,
  ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID,
  VERIFICATION_CHANNEL_ID: process.env.VERIFICATION_CHANNEL_ID,
  DEBUG: BooleanLike(process.env.DEBUG_MODE ?? process.env.DEBUG),
  GUILD_ID: process.env.GUILD_ID,
  WEBHOOK_PORT: process.env.WEBHOOK_PORT || 3001,
  VERIFIED_ROLE_ID: process.env.VERIFIED_ROLE_ID,
  SENTRY_DSN: process.env.SENTRY_DSN,
  LOGGER_NEW: BooleanLike(process.env.LOGGER_NEW),
  LOGGER_PRETTY: BooleanLike(process.env.LOGGER_PRETTY),
};