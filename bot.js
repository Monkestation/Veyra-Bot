const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config/config');
const { PersistentMap } = require('./utils/PersistentMap');
const { authenticateAPI } = require('./services/apiClient');
const commands = require('./commands/commands');
const { handleVerify, handleDebugVerify, handleCheckVerification } = require('./commands/commandHandlers');
const { createWebhookServer } = require('./webhook/webhookServer');
const { handleTestVerify, handleSimulateWebhook, handleListPending } = require('./commands/testCommandHandlers');
const { PermissionsBitField } = require('discord.js');

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
    console.log('Slash commands registered successfully');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
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
    console.error(`Error handling command ${commandName}:`, error);
    
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
  console.log(`Bot logged in as ${client.user.tag}`);

  // Authenticate with API
  try {
    await authenticateAPI();
  } catch {
    console.error(
      "Failed to authenticate with API. Bot will not function properly."
    );
    process.exit(1);
  }
  
  try {
    await client.guilds.fetch();
  } catch (error) {
    console.error("Failed to fetch guilds.", error);
    return process.exit(1);
  }

  // Check if we have permissions to assign roles to users
  const primaryGuild = client.guilds.resolve(config.GUILD_ID);

  if (!primaryGuild) {
    console.error("Bot is not in primary guild, exiitng...");
    return process.exit(1);
  }

  // Register slash commands
  await registerCommands();

  // Set bot status
  client.user.setActivity("iDenfy Verifications", { type: "WATCHING" });

  // Start cleanup interval
  startCleanupInterval();

  if (!config.VERIFIED_ROLE_ID) {
    console.warn("Proceeding without successful verification role");
    return;
  }

  const verifiedRole = primaryGuild.roles.cache.find(
    (r) => r.id === config.VERIFIED_ROLE_ID
  );

  const repetitiveRoleWarning = "Users will not be assigned role upon successful verification.";

  if (!verifiedRole) {
    console.warn(`Couldn't find verified role in primary guild. ${repetitiveRoleWarning}`);
    return;
  }

  if (
    !primaryGuild.members.me.permissions.has(
      PermissionsBitField.Flags.ManageRoles
    )
  ) {
    console.warn(`Bot does not have permission to manage roles! ${repetitiveRoleWarning}`);
    return;
  }

  const botHighestRole = primaryGuild.guild.members.me.roles.highest;

  if (botHighestRole.position <= verifiedRole.position) {
    console.warn(`Bot's highest role is lower than verified role. ${repetitiveRoleWarning}`);
    return;
  };
});

// Error handling
client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Enhanced graceful shutdown with better error handling
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  
  try {
    // Force a final save of pending verifications
    await pendingVerifications.forceSave();
    console.log('Final save of pending verifications completed');
  } catch (error) {
    console.error('Failed to save pending verifications during shutdown:', error);
  }

  // Close Discord client
  try {
    client.destroy();
    console.log('Discord client closed');
  } catch (error) {
    console.error('Error closing Discord client:', error);
  }

  console.log('Shutdown complete');
  process.exit(0);
});

// Handle other termination signals
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  process.emit('SIGINT');
});

async function preflight() {
  const requiredKeys = [
    "DISCORD_TOKEN",
    "API_USERNAME",
    "API_PASSWORD",
    "IDENFY_API_KEY",
    "IDENFY_API_SECRET",
    "GUILD_ID",
    "VERIFICATION_CHANNEL_ID"
  ];

  const missingKeys = requiredKeys.filter((key) => !config[key]);

  const isDev =
    process.env.NODE_ENV === "development" ||
    config.DEBUG;

  if (missingKeys.length > 0) {
    if (isDev) {
      console.warn(
        `Warning: Missing required config keys: ${missingKeys.join(", ")}`
      );
    } else {
      console.error(
        `Missing required config keys: ${missingKeys.join(", ")}`
      );
      return 1;
    }
  }
}
// Start the bot
async function start() {
  if (preflight()) {
    return process.exit(1);
  }
  try {
    console.log('Starting bot...');
    
    // Load saved pending verifications
    console.log('Loading pending verifications...');
    await pendingVerifications.loadFromFile();
    
    // Start webhook server
    console.log('Starting webhook server...');
    createWebhookServer(client, pendingVerifications);
    
    // Login to Discord
    console.log('Connecting to Discord...');
    await client.login(config.DISCORD_TOKEN);
    
    console.log('Bot startup complete!');
  } catch (error) {
    console.error('Failed to start bot:', error);
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
  start();
}