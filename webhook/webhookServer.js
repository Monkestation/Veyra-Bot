const express = require('express');
const bodyParser = require('body-parser');
const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');
const { submitVerification } = require('../services/apiClient');
const { deleteIdenfyData } = require('../services/idenfyService');

function createWebhookServer(client, pendingVerifications) {
  const webhookApp = express();
  webhookApp.use(bodyParser.json());

  // Webhook endpoint for iDenfy callbacks
  webhookApp.post('/webhook/idenfy', async (req, res) => {
    try {
      const { scanRef, status, platform } = req.body;
      
      const pending = pendingVerifications.get(scanRef);
      if (!pending) {
        console.log(`No pending verification found for scanRef: ${scanRef}`);
        return res.status(200).send('OK');
      }

      console.log(`Received iDenfy webhook for ${scanRef}: ${status}`);

      if (status === 'APPROVED') {
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
        pendingVerifications.delete(scanRef);
        
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
        
        // Clean up iDenfy data
        try {
          await deleteIdenfyData(scanRef);
        } catch (deleteError) {
          console.error(`Failed to delete iDenfy data for failed verification ${scanRef}:`, deleteError);
        }
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