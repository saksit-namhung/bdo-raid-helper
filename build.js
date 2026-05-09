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

const PLATFORM_MAP = { win32: 'win', darwin: 'macos', linux: 'linux' };
const platform = PLATFORM_MAP[process.platform] ?? process.platform;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const target = `node18-${platform}-${arch}`;

console.log(`\n✅ Baked ${Object.keys(baked).length} config values into binary`);
console.log(`📦 Running pkg for ${target}…\n`);

try {
  execSync(`npx pkg . --out-path dist --targets ${target}`, { stdio: 'inherit' });

  // Patch the PE header: change Windows subsystem from Console (3) to GUI (2).
  // A GUI-subsystem exe never allocates a console window — no runtime hiding needed.
  // Both PE32 and PE32+ have the Subsystem WORD at OptionalHeader + 0x44,
  // which is peOffset + 4 (sig) + 20 (FileHeader) + 0x44 = peOffset + 0x5C.
  if (platform === 'win') {
    const exeName = 'bdo-raid-helper.exe';
    const exePath = require('path').join('dist', exeName);
    // Windows Defender may briefly lock the file after pkg writes it.
    // Retry up to 5 times with 1-second gaps before giving up.
    let buf;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        buf = fs.readFileSync(exePath);
        break;
      } catch (e) {
        if (attempt === 5) throw e;
        console.log(`  Waiting for file lock to release (attempt ${attempt}/5)…`);
        execSync('ping 127.0.0.1 -n 2 > nul'); // ~1 s delay without requiring sleep
      }
    }
    const peOff  = buf.readUInt32LE(0x3C);
    const subOff = peOff + 0x5C;
    if (buf.readUInt16LE(subOff) === 3) {
      buf.writeUInt16LE(2, subOff);
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          fs.writeFileSync(exePath, buf);
          break;
        } catch (e) {
          if (attempt === 5) throw e;
          console.log(`  Waiting for write lock to release (attempt ${attempt}/5)…`);
          execSync('ping 127.0.0.1 -n 2 > nul');
        }
      }
      console.log(`✅ Patched ${exeName}: subsystem Console → GUI (no console window)`);
    }
  }

  // Copy icon.ico next to the exe so the tray can load it at runtime
  const iconSrc = require('path').join(__dirname, 'icon.ico');
  const iconDst = require('path').join('dist', 'icon.ico');
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, iconDst);
    console.log('✅ Copied icon.ico → dist/');
  } else {
    console.warn('⚠️  icon.ico not found in project root — tray will use fallback icon');
  }

  console.log('\n✅ Build complete — binaries are in dist/');
} finally {
  // Always clean up the temp file, even if pkg fails
  fs.unlinkSync(BAKED);
}
