const express = require('express');
const bodyParser = require('body-parser');
const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');
const { submitVerification } = require('../services/apiClient');
const { deleteIdenfyData } = require('../services/idenfyService');
const logger = require('../utils/logger');
const { setupExpressErrorHandler } = require('@sentry/node');

// Helper function to safely send DM without throwing errors
async function safeSendDM(client, userId, content) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(content);
    return true;
  } catch (error) {
    console.error(`Failed to send DM to user ${userId}:`, error.message);
    return false;
  }
}

// Helper function to retry deletion with initial delay and retries
async function retryDeleteIdenfyData(client, scanRef, userId, maxRetries = 12, baseDelay = 10000, initialDelay = 5000) {
  // Wait 5 seconds before first attempt to give iDenfy time to finish processing
  logger.info(`Waiting ${initialDelay/1000}s before attempting to delete iDenfy data for ${scanRef}...`);
  await new Promise(resolve => setTimeout(resolve, initialDelay));
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await deleteIdenfyData(scanRef);
      logger.info(`Successfully deleted iDenfy data for ${scanRef} on attempt ${attempt + 1}`);
      
      // Notify user of successful deletion (non-blocking)
      const embed = new EmbedBuilder()
        .setColor(0x00AA00)
        .setTitle('Data Cleanup Complete')
        .setDescription('Your verification data has been successfully removed from iDenfy\'s systems for privacy protection.')
        .addFields(
          { name: 'Scan Reference', value: scanRef, inline: true },
          { name: 'Action', value: 'Data Deleted', inline: true }
        )
        .setTimestamp();

        await user.send({ embeds: [embed] });
      } catch (dmError) {
        logger.error(`Failed to send deletion success DM to user ${userId}:`, dmError.message);
      }
      
      return true;
    } catch (error) {
      const isProcessingError = error.message.includes('processing state');
      
      if (!isProcessingError || attempt === maxRetries - 1) {
        // If it's not a processing error or we've exhausted retries, log and give up
        logger.error(`Failed to delete iDenfy data for ${scanRef} after ${attempt + 1} attempts:`, error.message);
        
        // Notify user of deletion failure (non-blocking)
        const embed = new EmbedBuilder()
          .setColor(0xFF6B00)
          .setTitle('Data Cleanup Warning')
          .setDescription('We were unable to automatically delete your verification data from iDenfy\'s systems. This may be temporary - we will continue trying, or you can contact support if needed.')
          .addFields(
            { name: 'Scan Reference', value: scanRef, inline: true },
            { name: 'Issue', value: 'Deletion Failed', inline: true },
            { name: 'Next Steps', value: 'Our team has been notified and will handle this manually if needed.', inline: false }
          )
          .setTimestamp();

          await user.send({ embeds: [embed] });
        } catch (dmError) {
          logger.error(`Failed to send deletion failure DM to user ${userId}:`, dmError.message);
        }
        
        return false;
      }
      
      // Wait before retrying (10s, 20s, 30s, etc.)
      const delay = baseDelay * (attempt + 1);
      logger.info(`Deletion failed for ${scanRef} (attempt ${attempt + 1}/${maxRetries}): ${error.message}. Retrying in ${delay/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return false;
}

function createWebhookServer(client, pendingVerifications) {
  const webhookApp = express();
  setupExpressErrorHandler(webhookApp);
  webhookApp.use(bodyParser.json());

  // Webhook endpoint for iDenfy callbacks
  webhookApp.post('/webhook/idenfy', async (req, res) => {
    try {
      const { scanRef, status, platform } = req.body;
      
      // Extract the actual status from the status object
      const overallStatus = status?.overall;
      
      const pending = pendingVerifications.get(scanRef);
      if (!pending) {
        logger.info(`No pending verification found for scanRef: ${scanRef}`);
        return res.status(200).send('OK');
      }

      logger.info(`Received iDenfy webhook for ${scanRef}: ${overallStatus}`);
      logger.info('Full status object:', JSON.stringify(status, null, 2));

      if (overallStatus === 'APPROVED') {
        // Verification successful
        try {
          // Submit verification first (most critical operation)
          await submitVerification(pending.discordId, pending.ckey, false, scanRef);
          console.log(`Successfully submitted verification for ${pending.ckey}`);
          
          // Remove from pending after successful submission
          pendingVerifications.delete(scanRef);
          
          // Try to assign role (non-critical)
          try {
            const guild = client.guilds.cache.get(config.GUILD_ID);
            if (guild) {
              const member = await guild.members.fetch(pending.discordId);
              const verifiedRoleId = process.env.VERIFIED_ROLE_ID;
              if (verifiedRoleId && member && !member.roles.cache.has(verifiedRoleId)) {
                await member.roles.add(verifiedRoleId, 'User verified with iDenfy');
                console.log(`Assigned verified role to ${pending.username}`);
              }
            }
          } catch (roleError) {
            console.error('Failed to assign verified role (continuing anyway):', roleError.message);
          }
      
          // Notify user (non-critical)
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

          safeSendDM(client, pending.userId, { embeds: [embed] });
          
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
            // Start retry deletion in background with user notification - don't await it
            retryDeleteIdenfyData(client, scanRef, pending.userId).catch(error => {
              logger.error(`Background deletion retry failed for ${scanRef}:`, error);
            });
            
            await channel.send({ embeds: [logEmbed] });
          }
          
          // Start retry deletion in background (non-blocking)
          retryDeleteIdenfyData(client, scanRef, pending.userId).catch(error => {
            console.error(`Background deletion retry failed for ${scanRef}:`, error);
          });

        } catch (error) {
          logger.error('Failed to submit verification:', error);
          
          // Even if verification submission failed, still try to notify user
          const errorEmbed = new EmbedBuilder()
            .setColor(0xFF6B6B)
            .setTitle('Verification Error')
            .setDescription('Your identity was verified, but there was an error saving it. Please contact an administrator.')
            .addFields(
              { name: 'Scan Reference', value: scanRef, inline: true },
              { name: 'CKEY', value: pending.ckey, inline: true }
            )
            .setTimestamp();

          safeSendDM(client, pending.userId, { embeds: [errorEmbed] });
        }
      } else if (overallStatus === 'DENIED' || overallStatus === 'EXPIRED' || overallStatus === 'SUSPECTED') {
        // Verification failed - remove from pending
        pendingVerifications.delete(scanRef);
        
        // Provide more detailed failure information
        let failureReason = 'Unknown reason';
        let description = 'Your identity verification was not successful.';
        
        if (status?.denyReasons && status.denyReasons.length > 0) {
          failureReason = status.denyReasons.join(', ');
          description += ` Reason(s): ${failureReason}`;
        } else if (status?.suspicionReasons && status.suspicionReasons.length > 0) {
          failureReason = status.suspicionReasons.join(', ');
          description += ` Issue(s): ${failureReason}`;
        }
        
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('Verification Failed')
          .setDescription(description)
          .addFields(
            { name: 'Status', value: overallStatus, inline: true },
            { name: 'Scan Reference', value: scanRef, inline: true }
          )
          .setTimestamp();

        // Send failure notification (non-blocking)
        safeSendDM(client, pending.userId, { embeds: [embed] });
        
        // Clean up iDenfy data with retry (non-blocking)
        retryDeleteIdenfyData(client, scanRef, pending.userId).catch(error => {
          logger.error(`Background deletion retry failed for failed verification ${scanRef}:`, error);
        });
      } else if (overallStatus === 'REVIEWING') {
        // Still under review - don't remove from pending
        logger.info(`Verification ${scanRef} is still under review`);
        
        const embed = new EmbedBuilder()
          .setColor(0xFFFF00)
          .setTitle('Verification Under Review')
          .setDescription('Your identity verification is being reviewed. You will be notified once the review is complete.')
          .addFields(
            { name: 'Status', value: overallStatus, inline: true },
            { name: 'Scan Reference', value: scanRef, inline: true }
          )
          .setTimestamp();

        // Send review notification (non-blocking)
        safeSendDM(client, pending.userId, { embeds: [embed] });
      } else {
        // Handle other statuses (ACTIVE, DELETED, ARCHIVED)
        logger.info(`Received unexpected status for ${scanRef}: ${overallStatus}`);
      }

      // Always return success to iDenfy
      res.status(200).send('OK');
    } catch (error) {
      logger.error('iDenfy webhook error:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // Start webhook server
  webhookApp.listen(config.WEBHOOK_PORT, () => {
    logger.info(`iDenfy webhook server listening on port ${config.WEBHOOK_PORT}`);
  });

  return webhookApp;
}

module.exports = { createWebhookServer };