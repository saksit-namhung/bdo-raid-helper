const fs = require('fs');
const path = require('path');

// Earliest-possible boot marker — written before anything else can crash.
// Lets us distinguish "Windows didn't auto-start us" from "we crashed early".
try {
  const exeDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
  fs.appendFileSync(
    path.join(exeDir, 'bdo-raid-helper.log'),
    `[${new Date().toISOString()}] [BOOT ] process started, argv=${JSON.stringify(process.argv)}\n`
  );
} catch { /* best-effort */ }

const BASE_DIR = require('./utils/baseDir');
const { initTray, ensureAutoStart } = require('./tray');

// In packaged GUI-subsystem builds there is no console, so redirect all output
// to a rolling log file next to the exe for later inspection.
if (typeof process.pkg !== 'undefined') {
  const logPath   = path.join(BASE_DIR, 'bdo-raid-helper.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const ts = () => new Date().toISOString();
  ['log', 'info', 'warn', 'error'].forEach((lvl) => {
    console[lvl] = (...args) => {
      logStream.write(`[${ts()}] [${lvl.toUpperCase().padEnd(5)}] ${args.map(String).join(' ')}\n`);
    };
  });
}

// readline SIGINT bridge — only useful when a real console is attached (dev mode).
// In the packaged GUI build stdin is a null device so we skip this.
if (process.platform === 'win32' && typeof process.pkg === 'undefined') {
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

// Anchored to the exe location so Windows auto-start (which sets cwd to
// system32) does not break config loading.
const CONFIG_FILE = path.join(BASE_DIR, 'config.json');

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

  // 5. Initialise the per-day schedule (creates schedule.json from defaults if missing)
  require('./scheduler/scheduleConfig').init();

  // 6. Start the system tray icon and register auto-start (Windows only)
  initTray(gracefulShutdown);
  ensureAutoStart();

  // 7. Start the bot
  require('./index');
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
