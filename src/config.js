require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  emojis: {
    mainball: process.env.MAINBALL_EMOJI || '⚔️',
    'def-team': process.env.DEF_TEAM_EMOJI || '🛡️',
    commander: process.env.COMMANDER_EMOJI || '👑',
    shai: process.env.SHAI_EMOJI || '🎵',
    flex: process.env.FLEX_EMOJI || '🔄',
    donkey: process.env.DONKEY_EMOJI || '🐴',
  },
};
