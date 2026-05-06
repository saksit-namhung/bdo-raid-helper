#!/usr/bin/env node
const fs = require('fs');
const { execSync } = require('child_process');

// Load .env so values are available in process.env
require('dotenv').config();

const BAKED = 'src/baked-config.js';

// All env vars the app reads — only bake non-empty values
const KNOWN_VARS = [
  'DISCORD_BOT_TOKEN',
  'CLIENT_ID',
  'COORDINATION_CHANNEL_ID',
  'AUTO_EVENT_ENABLED',
  'AUTO_EVENT_CHANNEL_ID',
  'AUTO_EVENT_SCHEDULE',
  'AUTO_EVENT_TITLE',
  'AUTO_EVENT_DESCRIPTION',
  'AUTO_EVENT_MAINBALL_MAX',
  'AUTO_EVENT_DEF_TEAM_MAX',
  'AUTO_EVENT_COMMANDER_MAX',
  'AUTO_EVENT_SHAI_MAX',
  'AUTO_EVENT_FLEX_MAX',
  'MAINBALL_EMOJI',
  'DEF_TEAM_EMOJI',
  'COMMANDER_EMOJI',
  'SHAI_EMOJI',
  'FLEX_EMOJI',
  'DONKEY_EMOJI',
];

// Validate required vars before building
const missing = ['DISCORD_BOT_TOKEN', 'CLIENT_ID'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\n❌ Build failed: missing required env vars: ${missing.join(', ')}`);
  console.error('   Set them in .env before building.\n');
  process.exit(1);
}

// Collect non-empty values
const baked = {};
for (const key of KNOWN_VARS) {
  if (process.env[key]) baked[key] = process.env[key];
}

// Write temporary baked-config.js — pkg will bundle this into the binary
fs.writeFileSync(
  BAKED,
  `// Auto-generated at build time — do not edit\nmodule.exports = ${JSON.stringify(baked, null, 2)};\n`,
  'utf8'
);

console.log(`\n✅ Baked ${Object.keys(baked).length} config values into binary`);
console.log('📦 Running pkg…\n');

try {
  execSync('npx pkg . --out-path dist', { stdio: 'inherit' });
  console.log('\n✅ Build complete — binaries are in dist/');
} finally {
  // Always clean up the temp file, even if pkg fails
  fs.unlinkSync(BAKED);
}
