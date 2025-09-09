const logger = require('./utils/logger');
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config/config');
const { PersistentMap } = require('./utils/PersistentMap');
const { authenticateAPI } = require('./services/apiClient');
const commands = require('./commands/commands');
const { handleVerify, handleDebugVerify, handleCheckVerification } = require('./commands/commandHandlers');
const { createWebhookServer } = require('./webhook/webhookServer');
const { handleTestVerify, handleSimulateWebhook, handleListPending } = require('./commands/testCommandHandlers');

// Initialize persistent storage for pending verifications
const pendingVerifications = new PersistentMap();

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Register slash commands
async function registerCommands() {
  try {
    await client.application.commands.set(commands, config.GUILD_ID);
    logger.info('Slash commands registered successfully');
  } catch (error) {
    logger.error('Failed to register slash commands:', error);
  }
}

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'verify':
        await handleVerify(interaction, pendingVerifications, client);
        break;
      case 'verify-debug':
        await handleDebugVerify(interaction);
        break;
      case 'check-verification':
        await handleCheckVerification(interaction, pendingVerifications);
        break;
      case 'test-verify':
        await handleTestVerify(interaction, pendingVerifications);
        break;
      case 'simulate-webhook':
        await handleSimulateWebhook(interaction, pendingVerifications);
        break;
      case 'list-pending':
        await handleListPending(interaction, pendingVerifications);
        break;
    }
  } catch (error) {
    logger.error(`Error handling command ${commandName}:`, error);
    
    const reply = {
      content: 'An error occurred while processing your request.',
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// Cleanup old pending verifications periodically
function startCleanupInterval() {
  const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  
  setInterval(() => {
    pendingVerifications.cleanup();
  }, CLEANUP_INTERVAL);
}

// Discord bot ready event
client.once('ready', async () => {
  logger.info(`Bot logged in as ${client.user.tag}`);
  
  // Authenticate with API
  try {
    await authenticateAPI();
  } catch {
    logger.error('Failed to authenticate with API. Bot will not function properly.');
    return process.exit(1);
  }

  // Register slash commands
  await registerCommands();

  // Set bot status
  client.user.setActivity('iDenfy Verifications', { type: 'WATCHING' });

  // Start cleanup interval
  startCleanupInterval();
});

// Error handling
client.on('error', error => {
  logger.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  logger.error('Unhandled promise rejection:', error);
});

// Enhanced graceful shutdown with better error handling
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  
  try {
    // Force a final save of pending verifications
    await pendingVerifications.forceSave();
    logger.info('Final save of pending verifications completed');
  } catch (error) {
    logger.error('Failed to save pending verifications during shutdown:', error);
  }

  // Close Discord client
  try {
    client.destroy();
    logger.info('Discord client closed');
  } catch (error) {
    logger.error('Error closing Discord client:', error);
  }

  logger.info('Shutdown complete');
  process.exit(0);
});

// Handle other termination signals
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down...');
  process.emit('SIGINT');
});

// Start the bot
async function start() {
  try {
    logger.info('Starting bot...');
    
    // Load saved pending verifications
    logger.info('Loading pending verifications...');
    await pendingVerifications.loadFromFile();
    
    // Start webhook server
    logger.info('Starting webhook server...');
    createWebhookServer(client, pendingVerifications);
    
    // Login to Discord
    logger.info('Connecting to Discord...');
    await client.login(config.DISCORD_TOKEN);
    
    logger.info('Bot startup complete!');
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Export for testing
module.exports = {
  client,
  pendingVerifications,
  start
};

// Start the bot if this file is run directly
if (require.main === module) {
  return start();
}