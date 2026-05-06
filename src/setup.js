const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

async function runSetup(forceAll = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Use existing process.env value silently, or prompt when missing / forceAll
  const getOrPrompt = async (key, label, fallback = '') => {
    const current = process.env[key];
    if (current && !forceAll) {
      console.log(`  ${label.padEnd(18)}: [using existing]`);
      return current;
    }
    const hint = current ? ` [Enter to keep current]` : '';
    const ans = await ask(rl, `  ${label}${hint}: `);
    return ans || current || fallback;
  };

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║      BDO Raid Helper — First-Time Setup  ║');
  console.log('╚══════════════════════════════════════════╝\n');
  if (forceAll) {
    console.log('Press Enter on any field to keep its current value.\n');
  } else {
    console.log('Prompting only for missing configuration values.\n');
  }

  // ── Required ────────────────────────────────────────────────────────────────
  console.log('── Discord Credentials ──────────────────────────');
  const token    = await getOrPrompt('DISCORD_BOT_TOKEN', 'Bot Token');
  const clientId = await getOrPrompt('CLIENT_ID',         'Client ID');

  // ── Coordination channel ────────────────────────────────────────────────────
  console.log('\n── High-Availability: Bot Sync Channel (optional) ───');
  if (!process.env.COORDINATION_CHANNEL_ID || forceAll) {
    console.log('  ⚠️  This is NOT the channel where raid events are posted.');
    console.log('  Create a separate PRIVATE channel that only the bot can see.');
    console.log('  The bot uses it internally to stay in sync across devices.');
    console.log('  All friends running the bot must enter the same channel ID here.');
  }
  const coordChannel = await getOrPrompt('COORDINATION_CHANNEL_ID', 'Bot Sync Channel ID', '');

  // ── Auto-event ──────────────────────────────────────────────────────────────
  console.log('\n── Daily Auto-Event (optional) ──────────────────');
  const autoEnabledCurrent = process.env.AUTO_EVENT_ENABLED;
  let autoEnabled;
  if (autoEnabledCurrent && !forceAll) {
    autoEnabled = autoEnabledCurrent === 'true';
    console.log(`  Auto-event: [using existing: ${autoEnabled ? 'enabled' : 'disabled'}]`);
  } else {
    const hint = autoEnabledCurrent ? ` [current: ${autoEnabledCurrent === 'true' ? 'y' : 'n'}]` : '';
    const ans = await ask(rl, `  Enable daily auto-event? (y/n)${hint}: `);
    autoEnabled = ans ? ans.toLowerCase() === 'y' : autoEnabledCurrent === 'true';
  }

  const autoConfig = {};
  if (autoEnabled) {
    autoConfig.AUTO_EVENT_CHANNEL_ID  = await getOrPrompt('AUTO_EVENT_CHANNEL_ID',  'Raid Event Channel ID');
    autoConfig.AUTO_EVENT_SCHEDULE    = await getOrPrompt('AUTO_EVENT_SCHEDULE',    'Daily time HH:MM', '21:30');
    autoConfig.AUTO_EVENT_TITLE       = await getOrPrompt('AUTO_EVENT_TITLE',       'Event title',      'Guild Raid Signup');
    autoConfig.AUTO_EVENT_DESCRIPTION = await getOrPrompt('AUTO_EVENT_DESCRIPTION', 'Event description','React to join your pool');
  }

  rl.close();

  // ── Save config ─────────────────────────────────────────────────────────────
  const config = {
    DISCORD_BOT_TOKEN:      token,
    CLIENT_ID:              clientId,
    COORDINATION_CHANNEL_ID: coordChannel,
    AUTO_EVENT_ENABLED:     autoEnabled ? 'true' : 'false',
    ...autoConfig,
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  console.log('\n✅ Config saved to config.json\n');

  // ── Propagate to process.env so deploy.js and index.js can read them ────────
  for (const [k, v] of Object.entries(config)) {
    if (v) process.env[k] = v;
  }

  console.log('Registering slash commands with Discord…');
  try {
    execSync('node src/commands/deploy.js', { stdio: 'inherit' });
  } catch {
    console.warn('⚠️  Could not register slash commands automatically.');
    console.warn('   Run "node src/commands/deploy.js" manually once to register them.\n');
  }
}

module.exports = { runSetup, CONFIG_FILE };
