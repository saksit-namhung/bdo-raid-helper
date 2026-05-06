// Load .env when running from source; main.js handles config.json for packaged builds
require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  coordinationChannelId: process.env.COORDINATION_CHANNEL_ID || '',
  emojis: {
    mainball: process.env.MAINBALL_EMOJI || '⚔️',
    'def-team': process.env.DEF_TEAM_EMOJI || '🛡️',
    commander: process.env.COMMANDER_EMOJI || '👑',
    shai: process.env.SHAI_EMOJI || '🎵',
    flex: process.env.FLEX_EMOJI || '🔄',
    donkey: process.env.DONKEY_EMOJI || '🐴',
  },
  autoEvent: {
    enabled: process.env.AUTO_EVENT_ENABLED === 'true',
    channelId: process.env.AUTO_EVENT_CHANNEL_ID || '',
    schedule: process.env.AUTO_EVENT_SCHEDULE || '21:30',
    title: process.env.AUTO_EVENT_TITLE || '',
    description: process.env.AUTO_EVENT_DESCRIPTION || '',
    poolLimits: {
      mainball: parseInt(process.env.AUTO_EVENT_MAINBALL_MAX) || 20,
      'def-team': parseInt(process.env.AUTO_EVENT_DEF_TEAM_MAX) || 10,
      commander: parseInt(process.env.AUTO_EVENT_COMMANDER_MAX) || 2,
      shai: parseInt(process.env.AUTO_EVENT_SHAI_MAX) || 3,
      flex: parseInt(process.env.AUTO_EVENT_FLEX_MAX) || 5,
    },
  },
};
