const { SlashCommandBuilder } = require('discord.js');

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

module.exports = commands;