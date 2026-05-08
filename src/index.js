'use strict';

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config          = require('./config');
const logger          = require('./logger');
const tray            = require('./tray');
const createEvent     = require('./commands/createEvent');
const raidSchedule    = require('./commands/raidSchedule');
const handleReactionAdd    = require('./handlers/reactionAdd');
const handleReactionRemove = require('./handlers/reactionRemove');
const { scheduleAutoEvent } = require('./scheduler/autoEvent');
const coordinator     = require('./ha/coordinator');

function startAsLeader() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  client.commands = new Collection();
  client.commands.set(createEvent.data.name,  createEvent);
  client.commands.set(raidSchedule.data.name, raidSchedule);

  client.once('ready', async () => {
    logger.info(`Bot online as ${client.user.tag}`);
    tray.updateStatus(`● Online  (${client.user.tag})`);
    await coordinator.startLeaderSync(client);
    scheduleAutoEvent(client);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(`Command "${interaction.commandName}" failed: ${err.message}`);
      const reply = { content: '❌ An error occurred while executing that command.', ephemeral: true };
      interaction.replied || interaction.deferred ? interaction.followUp(reply) : interaction.reply(reply);
    }
  });

  client.on('error', (err) => {
    logger.error(`Discord client error: ${err.message}`);
    tray.updateStatus('○ Error — reconnecting…');
  });

  client.on('messageReactionAdd',    handleReactionAdd);
  client.on('messageReactionRemove', handleReactionRemove);

  logger.info('Discord client logging in…');
  client.login(config.token).catch((err) => {
    logger.error(`Discord login failed: ${err.message}`);
    tray.updateStatus('○ Login failed');
  });
}

coordinator.on('promote', startAsLeader);
coordinator.start();
