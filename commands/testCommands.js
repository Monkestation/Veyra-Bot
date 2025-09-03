const { SlashCommandBuilder } = require('discord.js');

// Test commands for development/debugging
const testCommands = [
  new SlashCommandBuilder()
    .setName('test-verify')
    .setDescription('Create a test verification that auto-completes (admin only)')
    .addStringOption(option =>
      option.setName('ckey')
        .setDescription('BYOND ckey to test with')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('status')
        .setDescription('Expected verification result')
        .setRequired(false)
        .addChoices(
          { name: 'Approved', value: 'APPROVED' },
          { name: 'Denied', value: 'DENIED' },
          { name: 'Expired', value: 'EXPIRED' },
          { name: 'Suspected', value: 'SUSPECTED' }
        )
    ),
  
  new SlashCommandBuilder()
    .setName('simulate-webhook')
    .setDescription('Manually trigger a webhook for existing verification (admin only)')
    .addStringOption(option =>
      option.setName('scan_ref')
        .setDescription('Scan reference from pending verification')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('status')
        .setDescription('Webhook status to simulate')
        .setRequired(false)
        .addChoices(
          { name: 'Approved', value: 'APPROVED' },
          { name: 'Denied', value: 'DENIED' },
          { name: 'Expired', value: 'EXPIRED' },
          { name: 'Suspected', value: 'SUSPECTED' }
        )
    ),

  new SlashCommandBuilder()
    .setName('list-pending')
    .setDescription('List all pending verifications (admin only)')
];

module.exports = testCommands;