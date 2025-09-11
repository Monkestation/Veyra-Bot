const config = require("./config/config");
const fs = require("node:fs");
const logger = require("./utils/logger");
const { EmbedBuilder } = require("discord.js");

class Pruner {
  /**
   * 
   * @param {import("discord.js").Client} client 
   * @param {{
    daysBetweenPrunes: number;
    excludeRecentJoinHours: number;
    lastPruneFile: import("fs").PathLike;
   }} config 
   */
  constructor(client, config) {
    this.client = client;
    this.pruning = false;
    this.pruneIntervalVal = null;
    this.config = config;
  }

  getLastPruneDate() {
    try {
      const data = fs.readFileSync(this.config.lastPruneFile, 'utf8');
      return JSON.parse(data).lastPrune;
    } catch {
      return null;
    }
  }

  setLastPruneDate(timestamp) {
    fs.writeFileSync(this.config.lastPruneFile, JSON.stringify({ lastPrune: timestamp }));
  }

  /**
   * Prunes members in a guild based on role and join time.
   * @param {import("discord.js").Guild} guild 
   */
  async pruneMembers(guild) {
    try {
      this.pruning = true;
      logger.info(`Pruning members in guild: ${guild.name}`);

      const now = Date.now();
      const joinedCutoff = now - this.config.excludeRecentJoinHours * 60 * 60 * 1000;

      let prunedCount, failedPruneCount = 0;

      await guild.members.fetch();

      for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;
        if (member.roles.cache.size <= 1 && (!member.joinedAt || member.joinedAt.getTime() <= joinedCutoff)) {
          try {
            await member.kick('Pruned: No roles and not recently joined');
            prunedCount++;
          } catch (err) {
            failedPruneCount++;
            logger.warn(`Failed to prune member ${member.user.tag}:`, err);
          }
        }
      }

      logger.info(`Pruned ${prunedCount} members with no roles.`);

      let excludedCount = 0;
      for (const member of guild.members.cache.values()) {
        if (
          !member.user.bot &&
          member.roles.cache.size <= 1 &&
          member.joinedAt &&
          member.joinedAt.getTime() > joinedCutoff
        ) {
          excludedCount++;
        }
      }

      // Send embed to log channel
      const logChannelId = config.VERIFICATION_CHANNEL_ID;
      if (logChannelId) {
        const embed = new EmbedBuilder()
          .setTitle('Prune Report')
          .setColor(failedPruneCount ? 0xFF6000 : 0xff9900)
          .setTimestamp()
          .setDescription(
            `**Pruned Members:** ${prunedCount}\n` +
            `**Excluded (joined in last ${this.config.excludeRecentJoinHours} hours):** ${excludedCount}`
          );

        if (failedPruneCount) {
          embed.addFields([{
            name: "Warning",
            value: `Failed to prune ${failedPruneCount} members, check Sentry or logs.`
          }]);
        }

        const logChannel = guild.channels.cache.get(logChannelId);
        if (logChannel && logChannel.isTextBased()) {
          logChannel.send({ embeds: [embed] }).catch(err => {
            logger.warn('Failed to send prune report embed:', err);
          });
        } else {
          logger.warn('Verification log channel not found or not text-based.');
        }
      }

      this.setLastPruneDate(now);
      this.pruning = false;

    } catch (error) {
      this.pruning = false;
      throw error;
    }
  }

  async maybePruneOnStartup() {
    const lastPrune = this.getLastPruneDate();
    const now = Date.now();

    const daysSinceLastPrune = lastPrune
      ? (now - lastPrune) / (1000 * 60 * 60 * 24)
      : Infinity;

    if (daysSinceLastPrune >= this.config.daysBetweenPrunes) {
      const guild = await this.client.guilds.fetch(config.GUILD_ID);
      const fullGuild = await guild.fetch();
      await this.pruneMembers(fullGuild);
    }
  }

  startPruneInterval() {
    const FIVE_MINUTES = 5 * 60 * 1000;

    this.pruneIntervalVal = setInterval(async () => {
      if (this.pruning) return;

      try {
        const lastPrune = this.getLastPruneDate();
        const now = Date.now();
        const daysSinceLastPrune = lastPrune
          ? (now - lastPrune) / (1000 * 60 * 60 * 24)
          : Infinity;

        if (daysSinceLastPrune >= this.config.daysBetweenPrunes) {
          const guild = await this.client.guilds.fetch(config.GUILD_ID);
          const fullGuild = await guild.fetch();
          await this.pruneMembers(fullGuild);
        }
      } catch (err) {
        logger.error('Error during scheduled prune check:', err);
      }
    }, FIVE_MINUTES);
  }

}

module.exports = Pruner;
