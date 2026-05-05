const config = require('../config');
const { createEvent } = require('../state/eventStore');
const { buildEventEmbed } = require('../logic/messageBuilder');

// Tracks dates (YYYY-MM-DD) where an auto-event was already created this session
const createdDates = new Set();

function validate() {
  const { autoEvent } = config;
  if (!autoEvent.enabled) return 'AUTO_EVENT_ENABLED is not set to true';
  if (!autoEvent.channelId) return 'AUTO_EVENT_CHANNEL_ID is missing';
  if (!autoEvent.title) return 'AUTO_EVENT_TITLE is missing';
  if (!/^\d{1,2}:\d{2}$/.test(autoEvent.schedule)) return 'AUTO_EVENT_SCHEDULE must be in HH:MM format';
  return null;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function msUntilNext(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

async function runAutoEvent(client) {
  const error = validate();
  if (error) {
    console.log(`[AutoEvent] Skipping: ${error}`);
    return;
  }

  const today = todayKey();
  if (createdDates.has(today)) {
    console.log(`[AutoEvent] Already created for ${today}, skipping duplicate.`);
    return;
  }

  const { autoEvent } = config;

  let channel;
  try {
    channel = await client.channels.fetch(autoEvent.channelId);
  } catch {
    console.error(`[AutoEvent] Could not fetch channel ${autoEvent.channelId}`);
    return;
  }

  const tempEvent = {
    title: autoEvent.title,
    description: autoEvent.description,
    poolLimits: autoEvent.poolLimits,
    pools: { mainball: [], 'def-team': [], commander: [], shai: [], flex: [], donkey: [] },
    participants: {},
  };

  const embed = buildEventEmbed(tempEvent);
  const message = await channel.send({ embeds: [embed] });

  createEvent(message.id, channel.id, channel.guildId, {
    title: autoEvent.title,
    description: autoEvent.description,
    poolLimits: autoEvent.poolLimits,
  });

  for (const pool of ['mainball', 'def-team', 'commander', 'shai', 'flex']) {
    await message.react(config.emojis[pool]);
  }

  createdDates.add(today);
  console.log(`[AutoEvent] Created event "${autoEvent.title}" for ${today}`);
}

function scheduleAutoEvent(client) {
  const error = validate();
  if (error) {
    console.log(`[AutoEvent] Scheduler not started: ${error}`);
    return;
  }

  const [hour, minute] = config.autoEvent.schedule.split(':').map(Number);

  function scheduleTick() {
    const delay = msUntilNext(hour, minute);
    const minutesUntil = Math.round(delay / 60000);
    console.log(`[AutoEvent] Next auto-event in ${minutesUntil} minute(s) at ${config.autoEvent.schedule}`);

    setTimeout(async () => {
      await runAutoEvent(client);
      scheduleTick();
    }, delay);
  }

  scheduleTick();
}

module.exports = { scheduleAutoEvent };
