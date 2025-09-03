const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');
const { createDummyVerification, simulateWebhookCall } = require('../test/testUtilities');

// Handle /test-verify command (creates a dummy verification that will auto-complete)
async function handleTestVerify(interaction, pendingVerifications) {
  // Check if user is admin
  if (!interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
    return await interaction.reply({
      content: 'You do not have permission to use this command.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const ckey = interaction.options.getString('ckey');
  const status = interaction.options.getString('status') || 'APPROVED';
  const discordId = interaction.user.id;

  try {
    // Create dummy verification
    const verification = await createDummyVerification(discordId, ckey, status);
    
    // Add to pending verifications
    pendingVerifications.set(verification.scanRef, {
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
      .setColor(0xFFFF00)
      .setTitle('🧪 Test Verification Created')
      .setDescription(`Dummy verification session created with status: **${status}**`)
      .addFields(
        { name: 'CKEY', value: ckey, inline: true },
        { name: 'Expected Status', value: status, inline: true },
        { name: 'Scan Reference', value: verification.scanRef, inline: true },
        { name: 'Test URL', value: verification.verificationUrl, inline: false }
      )
      .setFooter({ text: 'This is a test verification - it will auto-complete with the specified status' })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      ephemeral: true
    });

    // Auto-trigger webhook after a delay
    setTimeout(async () => {
      try {
        await simulateWebhookCall(verification.scanRef, status);
        console.log(`✅ Auto-triggered webhook for test verification: ${verification.scanRef}`);
      } catch (error) {
        console.error(`❌ Failed to auto-trigger webhook for ${verification.scanRef}:`, error);
      }
    }, 5000); // 5 second delay

  } catch (error) {
    await interaction.editReply({
      content: `Failed to create test verification: ${error.message}`,
      ephemeral: true
    });
  }
}

// Handle /simulate-webhook command (directly simulates a webhook call)
async function handleSimulateWebhook(interaction, pendingVerifications) {
  // Check if user is admin
  if (!interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
    return await interaction.reply({
      content: 'You do not have permission to use this command.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const scanRef = interaction.options.getString('scan_ref');
  const status = interaction.options.getString('status') || 'APPROVED';

  // Check if there's a pending verification for this scan ref
  const pending = pendingVerifications.get(scanRef);
  if (!pending) {
    return await interaction.editReply({
      content: `No pending verification found for scan reference: ${scanRef}`,
      ephemeral: true
    });
  }

  try {
    await simulateWebhookCall(scanRef, status);

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🔄 Webhook Simulated')
      .setDescription('Webhook call has been simulated successfully')
      .addFields(
        { name: 'Scan Reference', value: scanRef, inline: true },
        { name: 'Status', value: status, inline: true },
        { name: 'Discord User', value: `<@${pending.discordId}>`, inline: true },
        { name: 'CKEY', value: pending.ckey, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      ephemeral: true
    });

  } catch (error) {
    await interaction.editReply({
      content: `Failed to simulate webhook: ${error.message}`,
      ephemeral: true
    });
  }
}

// Handle /list-pending command (shows all pending verifications)
async function handleListPending(interaction, pendingVerifications) {
  // Check if user is admin
  if (!interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
    return await interaction.reply({
      content: 'You do not have permission to use this command.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  if (pendingVerifications.size === 0) {
    return await interaction.editReply({
      content: 'No pending verifications found.',
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle('📋 Pending Verifications')
    .setDescription(`Total: ${pendingVerifications.size} pending verification(s)`)
    .setTimestamp();

  const fields = [];
  let count = 0;
  
  for (const [scanRef, verification] of pendingVerifications.entries()) {
    if (count >= 10) { // Limit to 10 to avoid embed limits
      fields.push({
        name: '...',
        value: `And ${pendingVerifications.size - count} more...`,
        inline: false
      });
      break;
    }

    const age = Math.round((Date.now() - verification.timestamp) / (1000 * 60)); // minutes
    fields.push({
      name: `${verification.ckey} (${verification.type})`,
      value: `<@${verification.discordId}>\nScan: \`${scanRef.substring(0, 20)}...\`\nAge: ${age}m`,
      inline: true
    });
    count++;
  }

  embed.addFields(fields);

  await interaction.editReply({
    embeds: [embed],
    ephemeral: true
  });
}

module.exports = {
  handleTestVerify,
  handleSimulateWebhook,
  handleListPending
};