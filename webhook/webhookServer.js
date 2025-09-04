const express = require('express');
const bodyParser = require('body-parser');
const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');
const { submitVerification } = require('../services/apiClient');
const { deleteIdenfyData } = require('../services/idenfyService');

// Helper function to retry deletion with initial delay and retries
async function retryDeleteIdenfyData(scanRef, maxRetries = 12, baseDelay = 10000, initialDelay = 5000) {
  // Wait 5 seconds before first attempt to give iDenfy time to finish processing
  console.log(`Waiting ${initialDelay/1000}s before attempting to delete iDenfy data for ${scanRef}...`);
  await new Promise(resolve => setTimeout(resolve, initialDelay));
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await deleteIdenfyData(scanRef);
      console.log(`Successfully deleted iDenfy data for ${scanRef} on attempt ${attempt + 1}`);
      return true;
    } catch (error) {
      const isProcessingError = error.message.includes('processing state');
      
      if (!isProcessingError || attempt === maxRetries - 1) {
        // If it's not a processing error or we've exhausted retries, log and give up
        console.error(`Failed to delete iDenfy data for ${scanRef} after ${attempt + 1} attempts:`, error.message);
        return false;
      }
      
      // Wait before retrying (10s, 20s, 30s, etc.)
      const delay = baseDelay * (attempt + 1);
      console.log(`Deletion failed for ${scanRef} (attempt ${attempt + 1}/${maxRetries}): ${error.message}. Retrying in ${delay/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return false;
}

function createWebhookServer(client, pendingVerifications) {
  const webhookApp = express();
  webhookApp.use(bodyParser.json());

  // Webhook endpoint for iDenfy callbacks
  webhookApp.post('/webhook/idenfy', async (req, res) => {
    try {
      const { scanRef, status, platform } = req.body;
      
      // Extract the actual status from the status object
      const overallStatus = status?.overall;
      
      const pending = pendingVerifications.get(scanRef);
      if (!pending) {
        console.log(`No pending verification found for scanRef: ${scanRef}`);
        return res.status(200).send('OK');
      }

      console.log(`Received iDenfy webhook for ${scanRef}: ${overallStatus}`);
      console.log('Full status object:', JSON.stringify(status, null, 2));

      if (overallStatus === 'APPROVED') {
        // Verification successful
        try {
          await submitVerification(pending.discordId, pending.ckey, false, scanRef);
          
          // Remove from pending after successful submission
          pendingVerifications.delete(scanRef);
          
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
            
            // Start retry deletion in background - don't await it
            retryDeleteIdenfyData(scanRef).catch(error => {
              console.error(`Background deletion retry failed for ${scanRef}:`, error);
            });
            
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
      } else if (overallStatus === 'DENIED' || overallStatus === 'EXPIRED' || overallStatus === 'SUSPECTED') {
        // Verification failed - remove from pending
        pendingVerifications.delete(scanRef);
        
        const user = await client.users.fetch(pending.userId);
        
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

        await user.send({ embeds: [embed] });
        
        // Clean up iDenfy data with retry
        retryDeleteIdenfyData(scanRef).catch(error => {
          console.error(`Background deletion retry failed for failed verification ${scanRef}:`, error);
        });
      } else if (overallStatus === 'REVIEWING') {
        // Still under review - don't remove from pending
        console.log(`Verification ${scanRef} is still under review`);
        
        const user = await client.users.fetch(pending.userId);
        const embed = new EmbedBuilder()
          .setColor(0xFFFF00)
          .setTitle('Verification Under Review')
          .setDescription('Your identity verification is being reviewed. You will be notified once the review is complete.')
          .addFields(
            { name: 'Status', value: overallStatus, inline: true },
            { name: 'Scan Reference', value: scanRef, inline: true }
          )
          .setTimestamp();

        await user.send({ embeds: [embed] });
      } else {
        // Handle other statuses (ACTIVE, DELETED, ARCHIVED)
        console.log(`Received unexpected status for ${scanRef}: ${overallStatus}`);
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('iDenfy webhook error:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // Start webhook server
  webhookApp.listen(config.WEBHOOK_PORT, () => {
    console.log(`iDenfy webhook server listening on port ${config.WEBHOOK_PORT}`);
  });

  return webhookApp;
}

module.exports = { createWebhookServer };