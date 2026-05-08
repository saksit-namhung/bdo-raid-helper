'use strict';

/**
 * Lightweight rotating file logger.
 *
 * Log location : <exe-dir>/logs/app.log   (packaged)
 *                <cwd>/logs/app.log        (dev)
 * Rotation     : rotates when file exceeds MAX_BYTES (512 KB)
 * Retention    : keeps at most MAX_FILES (3) rotated files; older ones are deleted
 * Policy       : only lifecycle / error events are logged — no heartbeat spam
 * Secrets      : never log bot tokens or sensitive env values
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const MAX_BYTES = 512 * 1024;   // 512 KB per file
const MAX_FILES = 3;            // keep app.log + .1 + .2 + .3

// process.pkg is truthy when running as a @yao-pkg/pkg packaged executable.
// In that case, use the directory containing the .exe as the base so that
// logs are always next to the binary regardless of launch context (e.g. startup).
const BASE_DIR = process.pkg
  ? path.dirname(process.execPath)
  : process.cwd();

const LOG_DIR  = path.join(BASE_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch { /* never crash */ }
}

function rotate() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const { size } = fs.statSync(LOG_FILE);
    if (size < MAX_BYTES) return;

    // Shift old files: .3 deleted, .2 → .3, .1 → .2, current → .1
    for (let i = MAX_FILES; i >= 1; i--) {
      const src  = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
      const dest = `${LOG_FILE}.${i}`;
      if (i === MAX_FILES && fs.existsSync(dest)) fs.unlinkSync(dest);
      if (fs.existsSync(src)) fs.renameSync(src, dest);
    }
  } catch { /* never crash */ }
}

function pruneStale() {
  // On startup, delete any rotated files beyond MAX_FILES so disk usage stays bounded.
  try {
    const entries = fs.readdirSync(LOG_DIR)
      .filter((f) => f.startsWith('app.log'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);   // newest first

    for (const entry of entries.slice(MAX_FILES + 1)) {
      fs.unlinkSync(path.join(LOG_DIR, entry.name));
    }
  } catch { /* never crash */ }
}

function write(level, message) {
  try {
    ensureDir();
    rotate();
    const line = `[${new Date().toISOString()}] [${level}] ${message}${os.EOL}`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch { /* never crash */ }
}

// ── Initialise on require ─────────────────────────────────────────────────────

ensureDir();
pruneStale();

// ── Public API ────────────────────────────────────────────────────────────────

module.exports = {
  info(msg)  { console.log(`[INFO]  ${msg}`);  write('INFO',  msg); },
  warn(msg)  { console.warn(`[WARN]  ${msg}`); write('WARN',  msg); },
  error(msg) { console.error(`[ERROR] ${msg}`); write('ERROR', msg); },
  /** Absolute path to the logs directory — used by the tray "Open Logs" menu item. */
  dir: LOG_DIR,
};
