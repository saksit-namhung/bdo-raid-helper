const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

async function runSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║      BDO Raid Helper — First-Time Setup  ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('Answer the questions below to configure your bot.');
  console.log('You only need to do this once.\n');

  // ── Required ────────────────────────────────────────────────────────────────
  console.log('── Discord Credentials ──────────────────────────');
  const token = await ask(rl, '  Bot Token       : ');
  const clientId = await ask(rl, '  Client ID       : ');

  // ── Coordination channel ────────────────────────────────────────────────────
  console.log('\n── High-Availability (optional) ─────────────────');
  console.log('  Create a private Discord channel that only the bot can see.');
  console.log('  All friends running the bot must use the same channel ID.');
  const coordChannel = await ask(rl, '  Coord Channel ID (Enter to skip): ');

  // ── Auto-event ──────────────────────────────────────────────────────────────
  console.log('\n── Daily Auto-Event (optional) ──────────────────');
  const autoEnabledAns = await ask(rl, '  Enable daily auto-event? (y/n): ');
  const autoEnabled = autoEnabledAns.toLowerCase() === 'y';

  const autoConfig = {};
  if (autoEnabled) {
    autoConfig.AUTO_EVENT_CHANNEL_ID = await ask(rl, '  Event channel ID  : ');
    autoConfig.AUTO_EVENT_SCHEDULE   = (await ask(rl, '  Daily time HH:MM  : [21:30] ')) || '21:30';
    autoConfig.AUTO_EVENT_TITLE       = (await ask(rl, '  Event title       : [Guild Raid Signup] ')) || 'Guild Raid Signup';
    autoConfig.AUTO_EVENT_DESCRIPTION = (await ask(rl, '  Event description : [React to join your pool] ')) || 'React to join your pool';
  }

  rl.close();

  // ── Save config ─────────────────────────────────────────────────────────────
  const config = {
    DISCORD_BOT_TOKEN: token,
    CLIENT_ID: clientId,
    COORDINATION_CHANNEL_ID: coordChannel,
    AUTO_EVENT_ENABLED: autoEnabled ? 'true' : 'false',
    ...autoConfig,
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  console.log('\n✅ Config saved to config.json\n');

  // ── Register slash commands ─────────────────────────────────────────────────
  // Set env vars so deploy.js can read them without dotenv
  for (const [k, v] of Object.entries(config)) {
    process.env[k] = v;
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
