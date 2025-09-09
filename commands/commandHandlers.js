const { EmbedBuilder } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');
const { checkDailyLimit, submitVerification, getExistingVerification } = require('../services/apiClient');
const { createIdenfyVerification, getIdenfyVerificationStatus, deleteIdenfyData } = require('../services/idenfyService');
const logger = require('../utils/logger');

/**
 * Handle /verify command
 * @param {import("discord.js").ChatInputCommandInteraction} interaction 
 * @param {import("../utils/PersistentMap").PersistentMap} pendingVerifications 
 * @param {import("discord.js").Client} client 
 * @returns 
 */
async function handleVerify(interaction, pendingVerifications, client) {
  await interaction.deferReply({ ephemeral: true });

  const ckey = interaction.options.getString('ckey');
  const discordId = interaction.user.id;

  // Check if user is vetted and verification status
  try {
    const existing = await getExistingVerification(discordId);
    if (!existing || !existing.verified_flags || !existing.verified_flags.vetted) {
      return await interaction.editReply({
        content: 'Access denied. You must be vetted to use the verification system.',
        ephemeral: true
      });
    }
    
    // Check if they already have scan_ref (already ID verified)
    if (existing.verified_flags.scan_ref) {
      return await interaction.editReply({
        content: `You are already ID verified with ckey: ${existing.ckey}`,
        ephemeral: true
      });
    }
    // If they have vetted flag but no scan_ref, they can proceed with ID verification
    
  } catch (error) {
    logger.error('Error checking verification status:', error);
    return await interaction.editReply({
      content: 'Unable to verify your status. Please try again later.',
      ephemeral: true
    });
  }

  // Check if user already has a pending verification by searching through all pending verifications
  const existingPendingVerification = Array.from(pendingVerifications.values())
    .find(verification => verification.discordId === discordId);

  if (existingPendingVerification) {
    return await interaction.editReply({
      content: 'You already have a pending verification. Please complete it first.',
      ephemeral: true
    });
  }

  // Check daily limit
  const limitExceeded = await checkDailyLimit();
  if (limitExceeded) {
    // Create pending verification request for manual approval
    const verificationId = uuidv4();
    pendingVerifications.set(verificationId, {
      discordId,
      ckey,
      userId: interaction.user.id,
      username: interaction.user.username,
      timestamp: Date.now(),
      type: 'manual_approval_pending'
    });

    // Send to admin channel
    const adminChannel = await client.channels.fetch(config.VERIFICATION_CHANNEL_ID);
    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('Verification Approval Required')
      .setDescription('Daily verification limit reached - Admin approval needed')
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
      content: 'Daily verification limit reached. Your request has been sent to administrators for approval. You will receive a DM with your verification link once approved.',
      ephemeral: true
    });
  }

  // Create iDenfy verification directly (normal flow)
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
    logger.error(`Failed to create verification session`, error);
    await interaction.editReply({
      content: 'Failed to create verification session. Please try again later.',
      ephemeral: true
    });
  }
}

/**
 * @param {string} verificationId 
 * @param {import("../utils/PersistentMap").PersistentMap} pendingVerifications 
 * @param {import("discord.js").Client} client 
 * @param {import("discord.js").User} adminUser 
 * @returns {{
      success: boolean,
      verificationUrl: string,
      scanRef: string,
      userNotified: boolean
    }}
 */
async function handleManualApproval(verificationId, pendingVerifications, client, adminUser) {
  const pendingVerification = pendingVerifications.get(verificationId);
  
  if (!pendingVerification) {
    throw new Error('Verification not found');
  }

  if (pendingVerification.type !== 'manual_approval_pending') {
    throw new Error('Verification is not awaiting manual approval');
  }

  // Create iDenfy verification now that it's approved
  try {
    const verification = await createIdenfyVerification(
      pendingVerification.discordId, 
      pendingVerification.ckey
    );
    
    // Update the pending verification with iDenfy details
    pendingVerifications.delete(verificationId); // Remove old entry
    pendingVerifications.set(verification.scanRef, {
      ...pendingVerification,
      type: 'idenfy',
      clientId: verification.clientId,
      sessionToken: verification.sessionToken,
      manuallyApproved: true,
      approvedBy: adminUser.id,
      approvedAt: Date.now()
    });

    // Try to DM the user with their iDenfy link
    try {
      const user = await client.users.fetch(pendingVerification.discordId);
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Verification Approved!')
        .setDescription('Your verification has been approved by an administrator. Please complete the identity verification process using the link below.')
        .addFields(
          { name: 'CKEY', value: pendingVerification.ckey, inline: true },
          { name: 'Status', value: 'Approved - Complete iDenfy', inline: true },
          { name: 'Scan Reference', value: verification.scanRef, inline: true },
          { name: 'Approved By', value: `${adminUser.username}`, inline: true }
        )
        .setFooter({ text: 'This link expires in 1 hour' })
        .setTimestamp();

      await user.send({
        content: `Your verification has been approved! Please complete your verification here: ${verification.verificationUrl}`,
        embeds: [embed]
      });

      logger.info(`Successfully sent iDenfy link to user ${pendingVerification.username} (${pendingVerification.discordId})`);
    } catch (dmError) {
      logger.error('Failed to DM user with iDenfy link:', dmError);
      
      // Try to post in verification channel as fallback
      try {
        const verificationChannel = await client.channels.fetch(config.VERIFICATION_CHANNEL_ID);
        const fallbackEmbed = new EmbedBuilder()
          .setColor(0xFFAA00)
          .setTitle('⚠️ Unable to DM User - Manual Contact Required')
          .setDescription('User approval completed but DM failed. Please contact user manually.')
          .addFields(
            { name: 'User', value: `<@${pendingVerification.discordId}>`, inline: true },
            { name: 'CKEY', value: pendingVerification.ckey, inline: true },
            { name: 'Verification Link', value: verification.verificationUrl, inline: false },
            { name: 'Scan Reference', value: verification.scanRef, inline: true }
          )
          .setTimestamp();

        await verificationChannel.send({
          content: `<@${pendingVerification.discordId}> - Your verification was approved but we couldn't DM you.`,
          embeds: [fallbackEmbed]
        });
      } catch (channelError) {
        logger.error('Failed to post fallback message in verification channel:', channelError);
      }
    }

    return {
      success: true,
      verificationUrl: verification.verificationUrl,
      scanRef: verification.scanRef,
      userNotified: true // We attempted to notify (success handled above)
    };
  } catch (error) {
    logger.error('Failed to create iDenfy verification after approval:', error);
    throw error;
  }
}

/**
 * Handle /verify-debug command
 * @param {import("discord.js").ChatInputCommandInteraction} interaction 
 * @returns 
 */
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

/**
 * @function handleCheckVerification
 * @param {import('discord.js').CommandInteraction} interaction - The Discord interaction object representing the user's command.
 * @param {Map<string, Object>} pendingVerifications - A map of pending verification references to their associated verification data.
 * @returns {Promise<void>}
 */
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
        logger.error('Error checking existing verification:', error);
      }

      return interaction.editReply({
        content: 'No pending or completed verification found for you.',
        ephemeral: true
      });
    }

    // Handle manual approval pending state
    if (pending.type === 'manual_approval_pending') {
      const embed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle('Manual Approval - Awaiting Admin Review')
        .setDescription('Your verification is waiting for administrator approval due to daily limits.')
        .addFields(
          { name: 'Discord User', value: `<@${pending.discordId}> (${pending.username})`, inline: true },
          { name: 'CKEY', value: pending.ckey, inline: true },
          { name: 'Status', value: 'Awaiting Admin Approval ⏳', inline: true },
          { name: 'Verification ID', value: actualScanRef, inline: true },
          { name: 'Submitted At', value: new Date(pending.timestamp).toLocaleString(), inline: true },
          { name: 'Next Step', value: 'You will receive a DM with your iDenfy link after approval', inline: false }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // Legacy manual approval flow (immediate submission)
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

    // Show if this was manually approved
    if (pending.manuallyApproved) {
      embed.addFields({ name: 'Approval Method', value: 'Manually Approved by Admin', inline: true });
      if (pending.approvedBy && pending.approvedAt) {
        embed.addFields(
          { name: 'Approved By', value: `<@${pending.approvedBy}>`, inline: true },
          { name: 'Approved At', value: new Date(pending.approvedAt).toLocaleString(), inline: true }
        );
      }
    }

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

        // Assign verified role
        try {
          const guild = interaction.guild;
          const member = await guild.members.fetch(pending.discordId);
          const verifiedRoleId = config.VERIFIED_ROLE_ID;
          if (verifiedRoleId && member && !member.roles.cache.has(verifiedRoleId)) {
            await member.roles.add(verifiedRoleId, 'User verified with iDenfy');
            embed.addFields({ name: 'Role Assigned', value: `<@&${verifiedRoleId}>`, inline: true });
          }
        } catch (roleError) {
          embed.addFields({ name: 'Role Assignment Error', value: roleError.message || 'Failed to assign role', inline: false });
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
  handleCheckVerification,
  handleManualApproval
};