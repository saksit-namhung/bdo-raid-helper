const config = require('../config');

const REAL_POOLS = ['mainball', 'def-team', 'commander', 'shai', 'flex'];

function getPoolFromEmoji(emoji) {
  // For custom emojis: "<:name:id>", for unicode: the character itself
  const emojiStr = emoji.id ? `<:${emoji.name}:${emoji.id}>` : emoji.name;

  for (const pool of REAL_POOLS) {
    const configured = config.emojis[pool];
    if (configured === emojiStr || configured === emoji.name) {
      return pool;
    }
  }
  return null;
}

module.exports = { getPoolFromEmoji };
