const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config = require('./config');
const createEvent = require('./commands/createEvent');
const handleReactionAdd = require('./handlers/reactionAdd');
const handleReactionRemove = require('./handlers/reactionRemove');

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

client.once('ready', () => {
  console.log(`✅ BDO Raid Helper online as ${client.user.tag}`);
});

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

client.login(config.token);
