const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'config.json');
const DOTENV_FILE = path.join(process.cwd(), '.env');

async function main() {
  // If neither config.json nor .env exists, run the first-time setup wizard
  if (!fs.existsSync(CONFIG_FILE) && !fs.existsSync(DOTENV_FILE)) {
    const { runSetup } = require('./setup');
    await runSetup();
  }

  // Load config into process.env before any other module reads it
  if (fs.existsSync(CONFIG_FILE)) {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    for (const [k, v] of Object.entries(saved)) {
      if (v) process.env[k] = v;
    }
  }

  // Start the bot
  require('./index');
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
