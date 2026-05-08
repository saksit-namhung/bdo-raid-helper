'use strict';

/**
 * Windows startup registration via HKCU\Run registry key.
 *
 * Why HKCU\Run:
 *   - No admin rights required (user-scoped)
 *   - Appears in Task Manager → Startup tab and Windows Settings → Startup Apps
 *   - User can toggle it off/on from those UIs without needing the app
 *
 * When Windows settings disables a startup entry, it keeps the Run key but
 * adds a "disabled" marker in StartupApproved\Run. Our isRegistered() only
 * checks the Run key itself — this is intentional: toggling via the tray menu
 * always removes/re-adds the key cleanly.
 */

const { execSync } = require('child_process');

const APP_NAME = 'BDO Raid Helper';
const REG_RUN  = `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run`;

function isRegistered() {
  if (process.platform !== 'win32') return false;
  try {
    execSync(`reg query "${REG_RUN}" /v "${APP_NAME}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Register the executable as a startup app.
 * @param {string} exePath  Absolute path to the packaged .exe
 * @returns {boolean}  true on success
 */
function register(exePath) {
  if (process.platform !== 'win32') return false;
  try {
    // Wrap in quotes in case path contains spaces
    execSync(`reg add "${REG_RUN}" /v "${APP_NAME}" /t REG_SZ /d "\\"${exePath}\\"" /f`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the startup registry entry.
 * @returns {boolean}  true on success
 */
function unregister() {
  if (process.platform !== 'win32') return false;
  try {
    execSync(`reg delete "${REG_RUN}" /v "${APP_NAME}" /f`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

module.exports = { isRegistered, register, unregister };
