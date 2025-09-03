require('dotenv').config();

const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const config = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',
  API_USERNAME: process.env.API_USERNAME,
  API_PASSWORD: process.env.API_PASSWORD,
  IDENFY_API_KEY: process.env.IDENFY_API_KEY,
  IDENFY_API_SECRET: process.env.IDENFY_API_SECRET,
  IDENFY_BASE_URL: process.env.IDENFY_BASE_URL || 'https://ivs.idenfy.com',
  DAILY_VERIFICATION_LIMIT: parseInt(process.env.DAILY_VERIFICATION_LIMIT) || 25,
  ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID,
  VERIFICATION_CHANNEL_ID: process.env.VERIFICATION_CHANNEL_ID,
  DEBUG_MODE: process.env.DEBUG_MODE === 'true',
  GUILD_ID: process.env.GUILD_ID
};

// Store for pending verifications and JWT token
const pendingVerifications = new Map();
let jwtToken = null;

// File path for persistent storage
const PENDING_VERIFICATIONS_FILE = path.join(__dirname, 'pending_verifications.json');

// Real-time save function with error handling and atomic writes
async function savePendingVerifications() {
  try {
    // Convert Map to a plain object for JSON serialization
    const dataToSave = {};
    for (const [key, value] of pendingVerifications.entries()) {
      dataToSave[key] = value;
    }
    
    // Use atomic write by writing to temp file first, then rename
    const tempFile = PENDING_VERIFICATIONS_FILE + '.tmp';
    const jsonData = JSON.stringify(dataToSave, null, 2);
    
    await fs.writeFile(tempFile, jsonData, 'utf8');
    await fs.rename(tempFile, PENDING_VERIFICATIONS_FILE);
    
    if (config.DEBUG_MODE) {
      console.log(`Saved ${pendingVerifications.size} pending verifications to disk`);
    }
  } catch (error) {
    console.error('Failed to save pending verifications:', error.message);
    
    // Try to clean up temp file if it exists
    try {
      await fs.unlink(PENDING_VERIFICATIONS_FILE + '.tmp');
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}

// Enhanced Map wrapper that saves on modification
class PersistentMap extends Map {
  constructor() {
    super();
    this._saving = false;
    this._saveQueued = false;
  }

  async _triggerSave() {
    // Debounce saves to avoid excessive disk I/O
    if (this._saving) {
      this._saveQueued = true;
      return;
    }

    this._saving = true;
    this._saveQueued = false;

    try {
      await savePendingVerifications();
    } finally {
      this._saving = false;
      
      // If another save was queued while we were saving, trigger it now
      if (this._saveQueued) {
        setImmediate(() => this._triggerSave());
      }
    }
  }

  set(key, value) {
    const result = super.set(key, value);
    this._triggerSave(); // Don't await to keep it non-blocking
    return result;
  }

  delete(key) {
    const result = super.delete(key);
    if (result) { // Only save if something was actually deleted
      this._triggerSave();
    }
    return result;
  }

  clear() {
    const hadEntries = this.size > 0;
    super.clear();
    if (hadEntries) {
      this._triggerSave();
    }
  }
}

// Replace the regular Map with our persistent version
const persistentPendingVerifications = new PersistentMap();

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

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

// Create iDenfy verification session
async function createIdenfyVerification(discordId, ckey) {
  try {
    const clientId = `discord-${discordId}`;
    
    const requestBody = {
      clientId: clientId,
      externalRef: `ckey-${ckey}`,
      locale: 'en',
      expiryTime: 3600, // 1 hour (renamed from tokenLifetime)
      sessionLength: 600,   // 10 minutes
      documents: ['ID_CARD', 'PASSPORT', 'DRIVER_LICENSE'],
      tokenType: 'IDENTIFICATION', // This enables face matching
      generateDigitString: false,
      showInstructions: true
    };

    if (config.DEBUG_MODE) {
      console.log('iDenfy Request Body:', JSON.stringify(requestBody, null, 2));
      console.log('Using API Key:', config.IDENFY_API_KEY?.substring(0, 8) + '...');
    }

    // Use basic authentication as shown in the cURL example
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
      console.log('iDenfy Response:', JSON.stringify(response.data, null, 2));
    }

    return {
      sessionToken: response.data.authToken,
      scanRef: response.data.scanRef,
      clientId: clientId,
      verificationUrl: `${config.IDENFY_BASE_URL}/api/v2/redirect?authToken=${response.data.authToken}`
    };
  } catch (error) {
    console.error('Failed to create iDenfy verification:', error.response?.data || error.message);
    if (config.DEBUG_MODE && error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
      console.error('Response data:', error.response.data);
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
    console.error('Failed to get iDenfy verification status:', error.response?.data || error.message);
    throw error;
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

// Register slash commands
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Verify your BYOND account')
      .addStringOption(option =>
        option.setName('ckey')
          .setDescription('Your BYOND ckey (username)')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('verify-debug')
      .setDescription('Debug verification (admin only)')
      .addStringOption(option =>
        option.setName('ckey')
          .setDescription('BYOND ckey to verify')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
    .setName('check-verification')
    .setDescription('Check your verification status')
  ];

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

  const { commandName, options, user, member } = interaction;

  try {
    switch (commandName) {
      case 'verify':
        await handleVerify(interaction);
        break;
      case 'verify-debug':
        await handleDebugVerify(interaction);
        break;
      case 'approve-verification':
        await handleApproveVerification(interaction);
        break;
      case 'check-verification':
        await handleCheckVerification(interaction);
        break;
    }
  } catch (error) {
    console.error(`Error handling command ${commandName}:`, error);
    await interaction.reply({
      content: 'An error occurred while processing your request.',
      ephemeral: true
    });
  }
});

// Handle /verify command
async function handleVerify(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const ckey = interaction.options.getString('ckey');
  const discordId = interaction.user.id;

  // Check if user already has a pending verification
  if (persistentPendingVerifications.has(discordId)) {
    return await interaction.editReply({
      content: 'You already have a pending verification. Please complete it first.',
      ephemeral: true
    });
  }

  // Check existing verification
  try {
    const existing = await api.get(`/api/v1/verify/${discordId}`);
    if (existing.data) {
      return await interaction.editReply({
        content: `You are already verified with ckey: ${existing.data.ckey}`,
        ephemeral: true
      });
    }
  } catch (error) {
    // 404 is expected if not verified
    if (error.response?.status !== 404) {
      throw error;
    }
  }

  // Check daily limit
  const limitExceeded = await checkDailyLimit();
  if (limitExceeded) {
    // Create pending verification request
    const verificationId = uuidv4();
    persistentPendingVerifications.set(verificationId, {
      discordId,
      ckey,
      userId: interaction.user.id,
      username: interaction.user.username,
      timestamp: Date.now(),
      type: 'manual_approval'
    });

    // Send to admin channel
    const adminChannel = await client.channels.fetch(config.VERIFICATION_CHANNEL_ID);
    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('Verification Approval Required')
      .setDescription('Daily verification limit reached')
      .addFields(
        { name: 'Discord User', value: `<@${discordId}> (${interaction.user.username})`, inline: true },
        { name: 'CKEY', value: ckey, inline: true },
        { name: 'Verification ID', value: verificationId, inline: false }
      )
      .setTimestamp();

    await adminChannel.send({
      content: `<@&${config.ADMIN_ROLE_ID}>`,
      embeds: [embed]
    });

    return await interaction.editReply({
      content: 'Daily verification limit reached. Your request has been sent to administrators for approval.',
      ephemeral: true
    });
  }

  // Create iDenfy verification
  try {
    const verification = await createIdenfyVerification(discordId, ckey);
    
    persistentPendingVerifications.set(verification.scanRef, {
      discordId,
      ckey,
      userId: interaction.user.id,
      username: interaction.user.username,
      timestamp: Date.now(),
      type: 'idenfy',
      clientId: verification.clientId,
      sessionToken: verification.sessionToken
    });

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('Verification Started')
      .setDescription('Please complete the identity verification process using iDenfy')
      .addFields(
        { name: 'CKEY', value: ckey, inline: true },
        { name: 'Status', value: 'Pending', inline: true },
        { name: 'Scan Reference', value: verification.scanRef, inline: true }
      )
      .setFooter({ text: 'This link expires in 1 hour' })
      .setTimestamp();

    await interaction.editReply({
      content: `Please complete your verification here: ${verification.verificationUrl}`,
      embeds: [embed],
      ephemeral: true
    });
  } catch (error) {
    await interaction.editReply({
      content: 'Failed to create verification session. Please try again later.',
      ephemeral: true
    });
  }
}

// Handle /verify-debug command
async function handleDebugVerify(interaction) {
  // Check if user is admin
  if (!interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
    return await interaction.reply({
      content: 'You do not have permission to use this command.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const ckey = interaction.options.getString('ckey');
  const discordId = interaction.user.id;

  try {
    const result = await submitVerification(discordId, ckey, true);
    
    const embed = new EmbedBuilder()
      .setColor(0xFFFF00)
      .setTitle('Debug Verification Complete')
      .setDescription('Verification added in debug mode')
      .addFields(
        { name: 'Discord ID', value: discordId, inline: true },
        { name: 'CKEY', value: ckey, inline: true },
        { name: 'Mode', value: 'DEBUG', inline: true }
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      ephemeral: true
    });
  } catch (error) {
    await interaction.editReply({
      content: `Failed to create debug verification: ${error.message}`,
      ephemeral: true
    });
  }
}

async function handleCheckVerification(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const user = interaction.user;
  const discordId = user.id;

  try {
    let pending = null;
    let actualScanRef = null;

    // Find the caller's pending verification in your Map<scanRef, { discordId, ckey, ... }>
    for (const [ref, verification] of persistentPendingVerifications.entries()) {
      if (verification.discordId === discordId) {
        pending = verification;
        actualScanRef = ref;
        break;
      }
    }

    // If nothing pending, see if they are already verified
    if (!pending) {
      try {
        const existing = await api.get(`/api/v1/verify/${discordId}`);
        if (existing?.data) {
          const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('You Are Already Verified')
            .addFields(
              { name: 'Discord User', value: `<@${discordId}> (${user.username})`, inline: true },
              { name: 'CKEY', value: existing.data.ckey, inline: true },
              { name: 'Status', value: 'Completed ✅', inline: true },
              { name: 'Method', value: existing.data.verification_method || 'Unknown', inline: true }
            )
            .setTimestamp();

          return interaction.editReply({ embeds: [embed], ephemeral: true });
        }
      } catch (_) {
        // 404/not found is expected if they aren't verified yet
      }

      return interaction.editReply({
        content: 'No pending or completed verification found for you.',
        ephemeral: true
      });
    }

    // If this is a manual-approval flow, submit immediately
    if (pending.type === 'manual_approval') {
      try {
        const result = await submitVerification(pending.discordId, pending.ckey, false, actualScanRef);

        // Remove from pending after submit
        persistentPendingVerifications.delete(actualScanRef);

        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('Manual Approval Verification - SUBMITTED')
          .addFields(
            { name: 'Discord User', value: `<@${pending.discordId}> (${pending.username})`, inline: true },
            { name: 'CKEY', value: pending.ckey, inline: true },
            { name: 'Status', value: 'Successfully Submitted ✅', inline: true },
            { name: 'Verification ID', value: actualScanRef, inline: true },
            { name: 'Method', value: 'Manual Approval', inline: true },
            { name: 'Submitted At', value: new Date().toLocaleString(), inline: true }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed], ephemeral: true });
      } catch (error) {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('Manual Approval Verification - FAILED')
          .addFields(
            { name: 'Discord User', value: `<@${pending.discordId}> (${pending.username})`, inline: true },
            { name: 'CKEY', value: pending.ckey, inline: true },
            { name: 'Status', value: 'Submission Failed ❌', inline: true },
            { name: 'Error', value: error.message || 'Unknown error', inline: false }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed], ephemeral: true });
      }
    }

    // From here it's iDenfy-style flow; we need a scan ref
    if (!actualScanRef) {
      return interaction.editReply({
        content: 'Pending verification found but no scan reference is associated with it yet.',
        ephemeral: true
      });
    }

    const status = await getIdenfyVerificationStatus(actualScanRef);

    const embed = new EmbedBuilder()
      .setTitle('iDenfy Verification Status')
      .addFields(
        { name: 'Scan Reference', value: actualScanRef, inline: true },
        { name: 'Status', value: status?.status || 'Unknown', inline: true },
        { name: 'Final', value: status?.final ? 'Yes' : 'No', inline: true }
      );

    // Add pending info
    embed.addFields(
      { name: 'Discord User', value: `<@${pending.discordId}> (${pending.username})`, inline: true },
      { name: 'CKEY', value: pending.ckey, inline: true },
      { name: 'Created', value: new Date(pending.timestamp).toLocaleString(), inline: true }
    );

    if (status?.reasonCode) {
      embed.addFields({ name: 'Reason Code', value: String(status.reasonCode), inline: true });
    }
    if (status?.additionalSteps) {
      embed.addFields({ name: 'Additional Steps', value: '```json\n' + JSON.stringify(status.additionalSteps, null, 2) + '\n```', inline: false });
    }

    // If approved, submit and delete iDenfy data
    if (status?.status === 'APPROVED') {
      try {
        const result = await submitVerification(pending.discordId, pending.ckey, false, actualScanRef);

        persistentPendingVerifications.delete(actualScanRef);

        embed.setColor(0x00FF00);
        embed.addFields(
          { name: 'Action Taken', value: 'Verification Submitted ✅', inline: true },
          { name: 'Submitted At', value: new Date().toLocaleString(), inline: true }
        );

        try {
          await deleteIdenfyData(actualScanRef);
          embed.addFields({ name: 'Data Deletion', value: 'iDenfy data deleted ✅', inline: true });
        } catch (deleteError) {
          embed.addFields(
            { name: 'Data Deletion', value: 'Failed to delete iDenfy data ⚠️', inline: true },
            { name: 'Deletion Error', value: deleteError.message || 'Unknown error', inline: false }
          );
        }
      } catch (error) {
        embed.setColor(0xFF8800);
        embed.addFields({ name: 'Submission Error', value: error.message || 'Unknown error', inline: false });
      }
    } else if (status?.final && status?.status === 'DENIED') {
      embed.setColor(0xFF0000);

      // Remove from pending since it's final denied
      persistentPendingVerifications.delete(actualScanRef);
      embed.addFields({ name: 'Action Taken', value: 'Removed from pending (denied)', inline: true });

      try {
        await deleteIdenfyData(actualScanRef);
        embed.addFields({ name: 'Data Deletion', value: 'iDenfy data deleted ✅', inline: true });
      } catch (deleteError) {
        embed.addFields(
          { name: 'Data Deletion', value: 'Failed to delete iDenfy data ⚠️', inline: true },
          { name: 'Deletion Error', value: deleteError.message || 'Unknown error', inline: false }
        );
      }
    } else if (!status?.final) {
      embed.setColor(0xFFFF00); // in progress
    } else {
      embed.setColor(0xFF8800); // other terminal state
    }

    await interaction.editReply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    await interaction.editReply({
      content: `Failed to check verification status: ${error.message || 'Unknown error'}`,
      ephemeral: true
    });
  }
}

// Function to delete iDenfy verification data
async function deleteIdenfyData(scanRef) {
  try {
    const response = await fetch('https://ivs.idenfy.com/api/v2/delete', {
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

    console.log(`Successfully deleted iDenfy data for scanRef: ${scanRef}`);
  } catch (error) {
    console.error(`Failed to delete iDenfy data for scanRef ${scanRef}:`, error);
    throw error;
  }
}

// iDenfy webhook handler
const express = require('express');
const bodyParser = require('body-parser');

const webhookApp = express();
webhookApp.use(bodyParser.json());

// Webhook endpoint for iDenfy callbacks
webhookApp.post('/webhook/idenfy', async (req, res) => {
  try {
    const { scanRef, status, platform } = req.body;
    
    const pending = persistentPendingVerifications.get(scanRef);
    if (!pending) {
      console.log(`No pending verification found for scanRef: ${scanRef}`);
      return res.status(200).send('OK');
    }

    console.log(`Received iDenfy webhook for ${scanRef}: ${status}`);

    if (status === 'APPROVED') {
      // Verification successful
      try {
        await submitVerification(pending.discordId, pending.ckey, false);
        
        // Remove from pending after successful submission
        persistentPendingVerifications.delete(scanRef);
        
        // Notify user
        const user = await client.users.fetch(pending.userId);
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('Verification Successful!')
          .setDescription(`Your identity has been verified successfully using iDenfy.`)
          .addFields(
            { name: 'CKEY', value: pending.ckey, inline: true },
            { name: 'Status', value: 'Verified ✅', inline: true },
            { name: 'Scan Reference', value: scanRef, inline: true }
          )
          .setTimestamp();

        await user.send({ embeds: [embed] });
        
        // Log to verification channel
        if (config.VERIFICATION_CHANNEL_ID) {
          const channel = await client.channels.fetch(config.VERIFICATION_CHANNEL_ID);
          const logEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('New Verification')
            .addFields(
              { name: 'Discord User', value: `<@${pending.discordId}> (${pending.username})`, inline: true },
              { name: 'CKEY', value: pending.ckey, inline: true },
              { name: 'Method', value: 'iDenfy', inline: true },
              { name: 'Scan Reference', value: scanRef, inline: true }
            )
            .setTimestamp();
          await deleteIdenfyData(scanRef);
          await channel.send({ embeds: [logEmbed] });
        }

      } catch (error) {
        console.error('Failed to submit verification:', error);
        
        // Notify user of error
        const user = await client.users.fetch(pending.userId);
        await user.send({
          content: 'Your identity was verified, but there was an error saving it. Please contact an administrator.',
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF6B6B)
              .setTitle('Verification Error')
              .addFields(
                { name: 'Scan Reference', value: scanRef, inline: true },
                { name: 'CKEY', value: pending.ckey, inline: true }
              )
              .setTimestamp()
          ]
        });
      }
    } else if (status === 'DENIED' || status === 'EXPIRED' || status === 'SUSPECTED') {
      // Verification failed - remove from pending
      persistentPendingVerifications.delete(scanRef);
      
      const user = await client.users.fetch(pending.userId);
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Verification Failed')
        .setDescription('Your identity verification was not successful.')
        .addFields(
          { name: 'Status', value: status, inline: true },
          { name: 'Scan Reference', value: scanRef, inline: true }
        )
        .setTimestamp();

      await user.send({ embeds: [embed] });
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('iDenfy webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Start webhook server
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3001;
webhookApp.listen(WEBHOOK_PORT, () => {
  console.log(`iDenfy webhook server listening on port ${WEBHOOK_PORT}`);
});

// Load pending verifications on startup with improved error handling
async function loadPendingVerifications() {
  try {
    // Check if file exists first
    try {
      await fs.access(PENDING_VERIFICATIONS_FILE);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('No pending verifications file found, starting fresh');
        return;
      }
      throw error;
    }

    const data = await fs.readFile(PENDING_VERIFICATIONS_FILE, 'utf8');
    
    // Handle empty file
    if (!data.trim()) {
      console.log('Pending verifications file is empty, starting fresh');
      return;
    }
    
    let pendingObject;
    try {
      pendingObject = JSON.parse(data);
    } catch (parseError) {
      console.error('Failed to parse pending verifications JSON:', parseError.message);
      console.log('Creating backup of corrupted file and starting fresh');
      
      // Create backup of corrupted file
      const backupFile = `${PENDING_VERIFICATIONS_FILE}.backup.${Date.now()}`;
      await fs.copyFile(PENDING_VERIFICATIONS_FILE, backupFile);
      console.log(`Corrupted file backed up to: ${backupFile}`);
      
      return;
    }
    
    // Validate the loaded data structure
    if (typeof pendingObject !== 'object' || pendingObject === null) {
      throw new Error('Invalid pending verifications data structure - not an object');
    }
    
    // Clear existing pending verifications
    persistentPendingVerifications.clear();
    
    let loadedCount = 0;
    let skippedCount = 0;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    const now = Date.now();
    
    // Load each entry back into the Map with validation
    for (const [scanRef, verification] of Object.entries(pendingObject)) {
      // Validate required fields
      if (!verification || 
          typeof verification !== 'object' ||
          !verification.discordId || 
          !verification.ckey || 
          !verification.timestamp ||
          !verification.type) {
        console.warn(`Skipping invalid verification entry for scanRef: ${scanRef}`);
        skippedCount++;
        continue;
      }
      
      // Check if verification is too old (older than 24 hours)
      const age = now - verification.timestamp;
      
      if (age > maxAge) {
        console.log(`Skipping expired verification for scanRef: ${scanRef} (${Math.round(age / (60 * 60 * 1000))}h old)`);
        skippedCount++;
        continue;
      }
      
      // Validate verification type
      if (!['idenfy', 'manual_approval'].includes(verification.type)) {
        console.warn(`Skipping verification with unknown type: ${verification.type} for scanRef: ${scanRef}`);
        skippedCount++;
        continue;
      }
      
      // Use the regular Map.set to avoid triggering save during load
      Map.prototype.set.call(persistentPendingVerifications, scanRef, verification);
      loadedCount++;
    }
    
    console.log(`Loaded ${loadedCount} pending verifications${skippedCount > 0 ? `, skipped ${skippedCount} invalid/expired entries` : ''}`);
    
    // Optional: Log what was loaded for debugging
    if (config.DEBUG_MODE) {
      console.log('Loaded pending verifications:', Array.from(persistentPendingVerifications.keys()));
    }

    // If we skipped any entries, save the cleaned up version
    if (skippedCount > 0) {
      console.log('Saving cleaned up pending verifications...');
      await savePendingVerifications();
    }
  } catch (error) {
    console.error('Error loading pending verifications:', error.message);
    console.log('Starting with empty pending verifications');
    
    // Clear any partial data that might have been loaded
    persistentPendingVerifications.clear();
  }
}

// Cleanup old pending verifications periodically
function startCleanupInterval() {
  const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
  
  setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [scanRef, verification] of persistentPendingVerifications.entries()) {
      if (now - verification.timestamp > MAX_AGE) {
        persistentPendingVerifications.delete(scanRef);
        cleanedCount++;
        console.log(`Cleaned up expired verification: ${scanRef} (${verification.type})`);
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`Cleanup completed: removed ${cleanedCount} expired pending verifications`);
    }
  }, CLEANUP_INTERVAL);
}

// Discord bot ready event
client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  
  // Authenticate with API
  try {
    await authenticateAPI();
  } catch (error) {
    console.error('Failed to authenticate with API. Bot will not function properly.');
    process.exit(1);
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
    await savePendingVerifications();
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

// Start the bot
async function start() {
  try {
    console.log('Starting bot...');
    
    // Load saved pending verifications
    console.log('Loading pending verifications...');
    await loadPendingVerifications();
    
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
  submitVerification,
  checkDailyLimit,
  pendingVerifications: persistentPendingVerifications,
  createIdenfyVerification,
  getIdenfyVerificationStatus,
  savePendingVerifications,
  loadPendingVerifications
};

// Start the bot if this file is run directly
if (require.main === module) {
  start();
}