// In-memory map: messageId -> eventState
const events = new Map();

function createEvent(messageId, channelId, guildId, { title, description, poolLimits, isAutoEvent = false }) {
  events.set(messageId, {
    messageId,
    channelId,
    guildId,
    title,
    description,
    poolLimits,
    isAutoEvent,
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

// Returns the message ID of the current auto-event, or null if none exists.
function findAutoEventId() {
  for (const [id, ev] of events) {
    if (ev.isAutoEvent) return id;
  }
  return null;
}

function getEvent(messageId) {
  return events.get(messageId);
}

function deleteEvent(messageId) {
  events.delete(messageId);
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

module.exports = { createEvent, getEvent, deleteEvent, exportState, importState, findAutoEventId };
