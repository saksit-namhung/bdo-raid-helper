const { REST, Routes } = require('discord.js');
const config = require('../config');
const createEvent = require('./createEvent');
const raidSchedule = require('./raidSchedule');

const commands = [createEvent.data.toJSON(), raidSchedule.data.toJSON()];
const rest = new REST().setToken(config.token);

(async () => {
  try {
    console.log('Deploying slash commands globally...');
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log('Done! Slash commands deployed.');
  } catch (err) {
    console.error(err);
  }
})();
