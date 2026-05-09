const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config = require('./config');
const createEvent = require('./commands/createEvent');
const raidSchedule = require('./commands/raidSchedule');
const handleReactionAdd = require('./handlers/reactionAdd');
const handleReactionRemove = require('./handlers/reactionRemove');
const { scheduleAutoEvent } = require('./scheduler/autoEvent');
const coordinator = require('./ha/coordinator');

// Retry delays in seconds: 10s, 30s, 60s, 120s, then cap at 300s
const LOGIN_RETRY_DELAYS = [10, 30, 60, 120, 300];

async function loginWithRetry(client, token) {
  for (let attempt = 1; ; attempt++) {
    try {
      await client.login(token);
      return;
    } catch (err) {
      const delay = LOGIN_RETRY_DELAYS[Math.min(attempt - 1, LOGIN_RETRY_DELAYS.length - 1)];
      console.error(`[Bot] Login attempt ${attempt} failed: ${err.message}. Retrying in ${delay}s…`);
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }
}

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
  client.commands.set(createEvent.data.name, createEvent);
  client.commands.set(raidSchedule.data.name, raidSchedule);

  client.once('ready', async () => {
    console.log(`✅ BDO Raid Helper online as ${client.user.tag}`);
    await coordinator.startLeaderSync(client);
    scheduleAutoEvent(client);
  });

  client.on('error', (err) => console.error('[Bot] Client error:', err.message));

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      const reply = { content: '❌ An error occurred while executing that command.', ephemeral: true };
      interaction.replied || interaction.deferred ? interaction.followUp(reply) : interaction.reply(reply);
    }
  });

  client.on('messageReactionAdd', handleReactionAdd);
  client.on('messageReactionRemove', handleReactionRemove);

  loginWithRetry(client, config.token);
}

coordinator.on('promote', startAsLeader);
coordinator.start();
