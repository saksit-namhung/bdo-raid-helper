'use strict';

// No-op on non-Windows so the module is safe to require everywhere.
if (process.platform !== 'win32') {
  module.exports = { init() {}, destroy() {}, updateStatus() {} };
  return;
}

const fs      = require('fs');
const path    = require('path');
const { exec, spawn } = require('child_process');
const logger  = require('./logger');
const startup = require('./startup');

// ── Icon generation ───────────────────────────────────────────────────────────
// Generates a minimal valid 16×16 ICO file (32-bit BGRA, single image).
// No external assets needed — written to disk next to the exe at runtime.

function createIco(r, g, b) {
  const w = 16, h = 16;
  const pixBytes  = w * h * 4;          // BGRA, fully opaque
  const maskBytes = (w * h) / 8;        // 1 bit/pixel AND + XOR masks
  const bmpSize   = 40 + pixBytes + maskBytes * 2;
  const buf       = Buffer.alloc(6 + 16 + bmpSize, 0);
  let p = 0;

  // ICO file header (6 bytes)
  buf.writeUInt16LE(0, p); p += 2;        // reserved
  buf.writeUInt16LE(1, p); p += 2;        // type = 1 (ICO)
  buf.writeUInt16LE(1, p); p += 2;        // image count

  // Image directory entry (16 bytes)
  buf[p++] = w; buf[p++] = h;             // width, height
  buf[p++] = 0; buf[p++] = 0;             // colorCount, reserved
  buf.writeUInt16LE(1, p);  p += 2;       // planes
  buf.writeUInt16LE(32, p); p += 2;       // bitCount
  buf.writeUInt32LE(bmpSize, p); p += 4;  // sizeInBytes
  buf.writeUInt32LE(22, p); p += 4;       // offset = 6 + 16

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, p); p += 4;
  buf.writeInt32LE(w, p);   p += 4;
  buf.writeInt32LE(h * 2, p); p += 4;    // ×2 includes AND/XOR mask rows
  buf.writeUInt16LE(1, p);  p += 2;       // planes
  buf.writeUInt16LE(32, p); p += 2;       // bitCount (32 = BGRA)
  p += 24;                                 // compression…importantColors (all 0)

  // Pixel data — bottom-up, BGRA, alpha = 255 (fully opaque)
  for (let i = 0; i < w * h; i++) {
    buf[p++] = b; buf[p++] = g; buf[p++] = r; buf[p++] = 255;
  }
  // AND + XOR masks already zeroed by Buffer.alloc → all pixels visible
  return buf;
}

// ── Tray state ────────────────────────────────────────────────────────────────

let sysTray  = null;
let iconPath = null;

// Menu item indices (must match the items array order in init())
const IDX_STATUS  = 0;
const IDX_STARTUP = 3;   // after status + separator + open-logs
const IDX_RESTART = 5;
const IDX_QUIT    = 6;

// ── Internal helpers ──────────────────────────────────────────────────────────

function updateItem(seqId, title, checked, enabled = true) {
  if (!sysTray) return;
  try {
    sysTray.sendAction({
      type: 'update-item',
      item: { title, checked, enabled, tooltip: '' },
      seq_id: seqId,
    });
  } catch { /* non-fatal */ }
}

function restartApp() {
  logger.info('Restart requested via tray');
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio:    'ignore',
    cwd:      process.cwd(),
  });
  child.unref();
  // Give the new instance a head-start before we begin shutting down.
  setTimeout(() => process.emit('SIGINT'), 800);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the system tray icon.  Call once after the packaged app starts.
 * Safe to call in dev (non-packaged) — it will still work if @trufflesuite/systray
 * is installed, but is simply skipped on non-Windows platforms.
 */
function init() {
  // Write the icon file next to the exe (overwrite on each launch — cheap)
  const baseDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
  iconPath = path.join(baseDir, 'bdo-tray.ico');
  try {
    // Windows blue (R=0, G=120, B=212)
    fs.writeFileSync(iconPath, createIco(0, 120, 212));
  } catch (err) {
    logger.warn(`Tray: could not write icon file: ${err.message}`);
    iconPath = '';
  }

  let SysTray;
  try {
    SysTray = require('@trufflesuite/systray').default;
  } catch (err) {
    logger.warn(`Tray: @trufflesuite/systray not available — tray disabled: ${err.message}`);
    return;
  }

  const startupEnabled = startup.isRegistered();

  try {
    sysTray = new SysTray({
      menu: {
        icon:    iconPath,
        title:   'BDO Raid Helper',
        tooltip: 'BDO Raid Helper',
        items: [
          // IDX_STATUS (0)
          { title: '○ Starting…', tooltip: 'Bot status', checked: false, enabled: false },
          SysTray.separator,
          // IDX (2)
          { title: 'Open Logs Folder', tooltip: logger.dir, checked: false, enabled: true },
          // IDX_STARTUP (3)
          {
            title:   startupEnabled ? '✓ Start with Windows' : 'Start with Windows',
            tooltip: '',
            checked: startupEnabled,
            enabled: true,
          },
          SysTray.separator,
          // IDX_RESTART (5)
          { title: 'Restart', tooltip: 'Restart the bot', checked: false, enabled: true },
          // IDX_QUIT (6)
          { title: 'Quit',    tooltip: 'Stop the bot',    checked: false, enabled: true },
        ],
      },
      debug:   false,
      copyDir: true,   // copies the helper binary to process.cwd() — works with pkg
    });

    sysTray.onClick((action) => {
      switch (action.seq_id) {
        case 2: // Open Logs Folder
          exec(`explorer "${logger.dir}"`);
          break;

        case IDX_STARTUP: // Toggle startup
          if (startup.isRegistered()) {
            startup.unregister();
            logger.info('Startup: disabled by user via tray');
            updateItem(IDX_STARTUP, 'Start with Windows', false);
          } else {
            const ok = startup.register(process.execPath);
            logger.info(`Startup: enabled by user via tray (ok=${ok})`);
            updateItem(IDX_STARTUP, '✓ Start with Windows', true);
          }
          break;

        case IDX_RESTART:
          restartApp();
          break;

        case IDX_QUIT:
          process.emit('SIGINT');
          break;
      }
    });

    sysTray.onExit((code, signal) => {
      logger.warn(`Tray: helper exited (code=${code} signal=${signal})`);
      sysTray = null;
    });

    logger.info(`Tray: initialised (startup=${startupEnabled})`);
  } catch (err) {
    logger.warn(`Tray: failed to create icon: ${err.message}`);
    sysTray = null;
  }
}

/**
 * Update the status line visible in the tray tooltip/menu.
 * @param {string} status  e.g. '● Online', '○ Offline'
 */
function updateStatus(status) {
  updateItem(IDX_STATUS, status, false, false);
}

/**
 * Destroy the tray icon cleanly on shutdown.
 */
function destroy() {
  if (!sysTray) return;
  try {
    sysTray.kill();
    sysTray = null;
    logger.info('Tray: destroyed');
  } catch { /* non-fatal */ }

  if (iconPath) {
    try { fs.unlinkSync(iconPath); } catch {}
    iconPath = null;
  }
}

module.exports = { init, destroy, updateStatus };
