const { EmbedBuilder } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');
const { checkDailyLimit, submitVerification, getExistingVerification } = require('../services/apiClient');
const { createIdenfyVerification, getIdenfyVerificationStatus, deleteIdenfyData } = require('../services/idenfyService');

// Handle /verify command
async function handleVerify(interaction, pendingVerifications, client) {
  await interaction.deferReply({ ephemeral: true });

  const ckey = interaction.options.getString('ckey');
  const discordId = interaction.user.id;

  // Check if user already has a pending verification
  if (pendingVerifications.has(discordId)) {
    return await interaction.editReply({
      content: 'You already have a pending verification. Please complete it first.',
      ephemeral: true
    });
  }

  // Check existing verification
  try {
    const existing = await getExistingVerification(discordId);
    if (existing) {
      return await interaction.editReply({
        content: `You are already verified with ckey: ${existing.ckey}`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Error checking existing verification:', error);
    // Continue with verification process
  }

  // Check daily limit
  const limitExceeded = await checkDailyLimit();
  if (limitExceeded) {
    // Create pending verification request
    const verificationId = uuidv4();
    pendingVerifications.set(verificationId, {
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

async function handleCheckVerification(interaction, pendingVerifications) {
  await interaction.deferReply({ ephemeral: true });

  const user = interaction.user;
  const discordId = user.id;

  try {
    let pending = null;
    let actualScanRef = null;

    // Find the caller's pending verification
    for (const [ref, verification] of pendingVerifications.entries()) {
      if (verification.discordId === discordId) {
        pending = verification;
        actualScanRef = ref;
        break;
      }
    }

    // If nothing pending, see if they are already verified
    if (!pending) {
      try {
        const existing = await getExistingVerification(discordId);
        if (existing) {
          const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('You Are Already Verified')
            .addFields(
              { name: 'Discord User', value: `<@${discordId}> (${user.username})`, inline: true },
              { name: 'CKEY', value: existing.ckey, inline: true },
              { name: 'Status', value: 'Completed ✅', inline: true },
              { name: 'Method', value: existing.verification_method || 'Unknown', inline: true }
            )
            .setTimestamp();

          return interaction.editReply({ embeds: [embed], ephemeral: true });
        }
      } catch (error) {
        // Error checking existing verification
        console.error('Error checking existing verification:', error);
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
        pendingVerifications.delete(actualScanRef);

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

        pendingVerifications.delete(actualScanRef);

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
      pendingVerifications.delete(actualScanRef);
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

module.exports = {
  handleVerify,
  handleDebugVerify,
  handleCheckVerification
};