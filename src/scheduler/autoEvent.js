const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const { createEvent, deleteEvent } = require('../state/eventStore');
const { buildEventEmbed } = require('../logic/messageBuilder');

const createdDates = new Set();

let currentAutoEventMsgId = null;
let currentCountdownMsg = null; // tracked so runAutoEvent can delete it

const PRE_TRANSITION_MS = 60_000; // 1 minute before schedule

function validate() {
  const { autoEvent } = config;
  if (!autoEvent.enabled) return 'AUTO_EVENT_ENABLED is not set to true';
  if (!autoEvent.channelId) return 'AUTO_EVENT_CHANNEL_ID is missing';
  if (!autoEvent.title) return 'AUTO_EVENT_TITLE is missing';
  if (!/^\d{1,2}:\d{2}$/.test(autoEvent.schedule)) return 'AUTO_EVENT_SCHEDULE must be in HH:MM format';
  return null;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function msUntilNext(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

// Deletes all messages in a channel, using bulkDelete where possible.
async function clearChannel(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  if (messages.size === 0) return;

  if (messages.size === 1) {
    await messages.first().delete().catch(() => {});
    return;
  }

  // bulkDelete only works for messages < 14 days old; fall back to individual deletes
  await channel.bulkDelete(messages).catch(async () => {
    for (const msg of messages.values()) {
      await msg.delete().catch(() => {});
    }
  });
}

// Called ~1 minute before the next scheduled event.
// Clears ALL messages in AUTO_EVENT_CHANNEL_ID then posts a countdown.
async function preTransition(client, msUntilEvent) {
  // Remove current event from store so reaction handlers ignore it
  if (currentAutoEventMsgId) {
    deleteEvent(currentAutoEventMsgId);
    currentAutoEventMsgId = null;
  }

  let channel;
  try {
    channel = await client.channels.fetch(config.autoEvent.channelId);
  } catch (err) {
    console.error('[AutoEvent] Pre-transition failed to fetch channel:', err.message);
    return;
  }

  try {
    await clearChannel(channel);
  } catch (err) {
    console.error('[AutoEvent] Pre-transition failed to clear channel:', err.message);
  }

  const eventUnixTs = Math.floor((Date.now() + msUntilEvent) / 1000);

  const countdownEmbed = new EmbedBuilder()
    .setTitle('⏳ Next Event Starting Soon')
    .setDescription(`A new event will begin <t:${eventUnixTs}:R>.`)
    .setColor(0x808080)
    .setFooter({ text: 'Signups are closed. Please wait for the new card.' });

  try {
    currentCountdownMsg = await channel.send({ embeds: [countdownEmbed] });
    console.log('[AutoEvent] Pre-transition: cleared channel, posted countdown.');
  } catch (err) {
    console.error('[AutoEvent] Pre-transition failed to send countdown:', err.message);
  }
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

  // Remove the countdown now that the event card is live
  if (currentCountdownMsg) {
    await currentCountdownMsg.delete().catch(() => {});
    currentCountdownMsg = null;
  }

  currentAutoEventMsgId = message.id;

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

    if (delay > PRE_TRANSITION_MS) {
      setTimeout(async () => {
        await preTransition(client, PRE_TRANSITION_MS);
      }, delay - PRE_TRANSITION_MS);
    }

    setTimeout(async () => {
      await runAutoEvent(client);
      scheduleTick();
    }, delay);
  }

  scheduleTick();
}

module.exports = { scheduleAutoEvent };
