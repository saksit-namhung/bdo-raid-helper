const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = path.join(process.cwd(), 'schedule.json');
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIME_RE = /^\d{1,2}:\d{2}$/;

class ScheduleConfig extends EventEmitter {
  constructor() {
    super();
    this._schedule = null;
  }

  init() {
    if (fs.existsSync(SCHEDULE_FILE)) {
      try {
        this._schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
        console.log('[ScheduleConfig] Loaded schedule.json');
        return;
      } catch (err) {
        console.warn('[ScheduleConfig] Failed to parse schedule.json, rebuilding defaults:', err.message);
      }
    }
    // Lazy-require config so env vars are guaranteed to be loaded first
    const config = require('../config');
    this._schedule = this._buildDefaults(config);
    this._save();
    console.log('[ScheduleConfig] Created schedule.json with defaults');
  }

  _buildDefaults(config) {
    const defaultPools = { ...config.autoEvent.poolLimits };
    const defaultTime = config.autoEvent.schedule || '20:00';
    const defaultEnabled = config.autoEvent.enabled;
    const schedule = {};
    for (const day of DAYS) {
      schedule[day] = {
        enabled: defaultEnabled,
        time: defaultTime,
        pools: { ...defaultPools },
      };
    }
    return schedule;
  }

  // Returns a deep copy of the full schedule, or a single day's config
  get(day) {
    if (!this._schedule) return day ? null : {};
    if (day) return this._schedule[day] ? JSON.parse(JSON.stringify(this._schedule[day])) : null;
    return JSON.parse(JSON.stringify(this._schedule));
  }

  // Patch a single day. patch may contain: time, enabled, pools (partial)
  update(day, patch) {
    if (!this._schedule[day]) throw new Error(`Unknown day: ${day}`);
    const current = this._schedule[day];

    if (patch.time !== undefined) {
      if (!TIME_RE.test(patch.time)) throw new Error(`Invalid time: "${patch.time}" — use HH:MM (24h)`);
      current.time = patch.time;
    }
    if (patch.enabled !== undefined) current.enabled = patch.enabled;
    if (patch.pools) {
      for (const [k, v] of Object.entries(patch.pools)) {
        if (typeof v !== 'number' || v < 1) throw new Error(`Pool capacity must be a positive integer`);
        current.pools[k] = v;
      }
    }

    this._save();
    this.emit('change');
  }

  // Replace the entire schedule (used by HA standby sync). Only emits if changed.
  applyFull(newSchedule) {
    if (JSON.stringify(this._schedule) === JSON.stringify(newSchedule)) return;
    this._schedule = JSON.parse(JSON.stringify(newSchedule));
    this._save();
    this.emit('change');
  }

  _save() {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(this._schedule, null, 2), 'utf8');
  }
}

module.exports = new ScheduleConfig();
