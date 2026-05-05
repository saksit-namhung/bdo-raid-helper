// In-memory map: messageId -> eventState
const events = new Map();

function createEvent(messageId, channelId, guildId, { title, scheduledTime, description, poolLimits }) {
  events.set(messageId, {
    messageId,
    channelId,
    guildId,
    title,
    scheduledTime,
    description,
    poolLimits,
    // participants: userId -> { userId, username, selectedPool, assignedPool, joinOrder }
    participants: {},
    pools: {
      mainball: [],
      'def-team': [],
      commander: [],
      shai: [],
      flex: [],
      donkey: [],
    },
    joinSequence: 0,
  });
}

function getEvent(messageId) {
  return events.get(messageId);
}

module.exports = { createEvent, getEvent };
