'use strict';

const fs   = require('fs');
const path = require('path');

// ── 1. Working-directory anchor ───────────────────────────────────────────────
// When launched via Windows startup (HKCU\Run), the cwd may default to
// C:\Windows\System32 instead of the exe's directory, which would scatter
// config.json / schedule.json / state.json. Fix it early, before any I/O.
if (process.pkg) {
  try {
    process.chdir(path.dirname(process.execPath));
  } catch { /* best-effort */ }
}

// ── 2. Logger — first thing so all later code can log ────────────────────────
const logger = require('./logger');
logger.info(`Application starting (pid=${process.pid} cwd=${process.cwd()})`);

// ── 3. Windows: bridge CTRL_C_EVENT → SIGINT for pkg-bundled .exe ────────────
if (process.platform === 'win32') {
  require('readline').createInterface({ input: process.stdin, output: process.stdout })
    .on('SIGINT', () => process.emit('SIGINT'));
}

// ── 4. Graceful shutdown ──────────────────────────────────────────────────────
let _shuttingDown = false;

async function gracefulShutdown() {
  if (_shuttingDown) return;
  _shuttingDown = true;
  logger.info('Shutdown: initiated');

  // Safety net: if cleanup hangs longer than 5 s, force-exit.
  const forceTimer = setTimeout(() => {
    logger.error('Shutdown: timed out — forcing exit');
    process.exit(1);
  }, 5000);
  forceTimer.unref(); // don't let this timer alone keep the process alive

  try {
    // Stop auto-event scheduler timers (safe: require is cached after bot start)
    try { require('./scheduler/autoEvent').stopScheduler(); } catch {}

    // HA coordinator: remove state message so standbys elect a new leader
    try { await require('./ha/coordinator').shutdown(); } catch (err) {
      logger.error(`Shutdown: coordinator error — ${err.message}`);
    }
  } catch (err) {
    logger.error(`Shutdown: unexpected error — ${err.message}`);
  }

  // Destroy tray icon (Windows only; no-op on other platforms)
  try { require('./tray').destroy(); } catch {}

  logger.info('Shutdown: complete');
  clearTimeout(forceTimer);
  process.exit(0);
}

process.on('SIGINT',  gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// ── 5. Config loading + bot startup ──────────────────────────────────────────
const CONFIG_FILE = path.join(process.cwd(), 'config.json');

async function main() {
  const forceSetup = process.argv.includes('--setup');

  // 5a. Baked-in config (packaged binary only)
  try {
    const baked = require('./baked-config');
    for (const [k, v] of Object.entries(baked)) {
      if (v && !process.env[k]) process.env[k] = v;
    }
  } catch { /* not a packaged build */ }

  // 5b. .env file
  require('dotenv').config();

  // 5c. config.json
  if (fs.existsSync(CONFIG_FILE)) {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    for (const [k, v] of Object.entries(saved)) {
      if (v && !process.env[k]) process.env[k] = v;
    }
  }

  // 5d. Setup wizard if required vars are still missing
  const missingRequired = ['DISCORD_BOT_TOKEN', 'CLIENT_ID'].filter((k) => !process.env[k]);
  if (forceSetup || missingRequired.length > 0) {
    const { runSetup } = require('./setup');
    await runSetup(forceSetup);
  }

  // 5e. Per-day schedule (creates schedule.json from defaults if missing)
  require('./scheduler/scheduleConfig').init();

  // 5f. Windows startup registration — register on first packaged run.
  //     The tray provides a toggle so the user can disable it later.
  if (process.pkg && process.platform === 'win32') {
    const startup = require('./startup');
    if (!startup.isRegistered()) {
      const ok = startup.register(process.execPath);
      logger.info(`Startup: auto-registered with Windows (ok=${ok})`);
    }
  }

  // 5g. System tray (Windows only; no-op on other platforms)
  try {
    require('./tray').init();
  } catch (err) {
    logger.warn(`Tray init failed (non-fatal): ${err.message}`);
  }

  // 5h. Start the bot
  require('./index');
}

main().catch((err) => {
  logger.error(`Fatal error during startup: ${err.message}`);
  process.exit(1);
});
