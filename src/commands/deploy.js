const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

// Mirror main.js config loading: baked-config → .env → config.json
try { const baked = require('../baked-config'); for (const [k, v] of Object.entries(baked)) { if (v && !process.env[k]) process.env[k] = v; } } catch {}
require('dotenv').config();
const CONFIG_FILE = path.join(process.cwd(), 'config.json');
if (fs.existsSync(CONFIG_FILE)) {
  const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  for (const [k, v] of Object.entries(saved)) { if (v && !process.env[k]) process.env[k] = v; }
}

const config = require('../config');

console.log('[Deploy] CLIENT_ID  :', config.clientId  || '⚠️  MISSING');
console.log('[Deploy] Token      :', config.token ? `${config.token.slice(0, 10)}…` : '⚠️  MISSING');

if (!config.clientId || !config.token) {
  console.error('[Deploy] Cannot deploy — credentials missing. Run the setup wizard first: node src/main.js --setup');
  process.exit(1);
}

const createEvent  = require('./createEvent');
const raidSchedule = require('./raidSchedule');

const commands = [createEvent.data.toJSON(), raidSchedule.data.toJSON()];
console.log('[Deploy] Registering commands:', commands.map((c) => c.name).join(', '));

const rest = new REST().setToken(config.token);

(async () => {
  try {
    console.log('[Deploy] Sending to Discord...');
    const result = await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`[Deploy] Done! ${result.length} command(s) registered: ${result.map((c) => c.name).join(', ')}`);
  } catch (err) {
    console.error('[Deploy] Discord API error:', err.message);
    if (err.rawError) console.error('[Deploy] Raw error:', JSON.stringify(err.rawError, null, 2));
  }
})();
