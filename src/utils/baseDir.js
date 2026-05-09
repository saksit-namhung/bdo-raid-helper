const path = require('path');

// When running as a pkg-bundled .exe, process.execPath is the exe itself.
// process.cwd() is unreliable in that context (Windows auto-start sets it to
// system32 or the user profile). Use this module everywhere a stable file
// path anchor is needed (state.json, config.json, icon.ico, etc.).
const isPkg = typeof process.pkg !== 'undefined';
const BASE_DIR = isPkg ? path.dirname(process.execPath) : process.cwd();

module.exports = BASE_DIR;
