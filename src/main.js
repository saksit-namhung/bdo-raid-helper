const fs = require('fs');
const path = require('path');

// On Windows, pkg-bundled exes receive CTRL_C_EVENT instead of SIGINT.
// readline registers a proper SetConsoleCtrlHandler that bridges the two.
if (process.platform === 'win32') {
  require('readline').createInterface({ input: process.stdin, output: process.stdout })
    .on('SIGINT', () => process.emit('SIGINT'));
}

let _shuttingDown = false;
async function gracefulShutdown() {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log('\n[Node] Shutting down…');
  try {
    const coordinator = require('./ha/coordinator');
    await coordinator.shutdown();
  } catch { /* best-effort */ }
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

async function main() {
  const forceSetup = process.argv.includes('--setup');

  // 1. Baked-in config (packaged binary only — does not exist in dev runs)
  try {
    const baked = require('./baked-config');
    for (const [k, v] of Object.entries(baked)) {
      if (v && !process.env[k]) process.env[k] = v;
    }
  } catch { /* not a packaged build */ }

  // 2. .env file (never overwrites vars already in process.env)
  require('dotenv').config();

  // 3. config.json — only for keys not already present in process.env
  if (fs.existsSync(CONFIG_FILE)) {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    for (const [k, v] of Object.entries(saved)) {
      if (v && !process.env[k]) process.env[k] = v;
    }
  }

  // 4. Run wizard only when forced or required vars are still missing
  const missingRequired = ['DISCORD_BOT_TOKEN', 'CLIENT_ID'].filter((k) => !process.env[k]);
  if (forceSetup || missingRequired.length > 0) {
    const { runSetup } = require('./setup');
    await runSetup(forceSetup);
  }

  // 5. Start the bot
  require('./index');
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
