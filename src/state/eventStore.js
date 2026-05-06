// In-memory map: messageId -> eventState
const events = new Map();

function createEvent(messageId, channelId, guildId, { title, description, poolLimits }) {
  events.set(messageId, {
    messageId,
    channelId,
    guildId,
    title,
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

function exportState() {
  const obj = {};
  for (const [id, event] of events) {
    obj[id] = event;
  }
  return obj;
}

function importState(obj) {
  events.clear();
  for (const [id, event] of Object.entries(obj || {})) {
    events.set(id, event);
  }
}

module.exports = { createEvent, getEvent, exportState, importState };
