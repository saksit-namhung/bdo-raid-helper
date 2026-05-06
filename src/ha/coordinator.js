const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { REST, Routes, AttachmentBuilder } = require('discord.js');
const config = require('../config');
const { exportState, importState } = require('../state/eventStore');

const STATE_FILE = path.join(process.cwd(), 'state.json');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const LEADER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — leader considered dead after this

const instanceId = `node-${Date.now()}-${Math.floor(Math.random() * 9999)
  .toString()
  .padStart(4, '0')}`;

class Coordinator extends EventEmitter {
  constructor() {
    super();
    this.isLeader = false;
    this._syncTimer = null;
    this._rest = new REST().setToken(config.token);
  }

  // ── File helpers ────────────────────────────────────────────────────────────

  _saveLocally(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  }

  _loadLocally() {
    if (!fs.existsSync(STATE_FILE)) return null;
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
      return null;
    }
  }

  // ── Discord REST helpers ─────────────────────────────────────────────────────

  async _getCoordMessages() {
    return this._rest.get(
      Routes.channelMessages(config.coordinationChannelId, { limit: 10 })
    );
  }

  _findStateMessage(messages) {
    // Raw Discord API: attachments is an array with a `filename` field
    return messages.find(
      (m) => m.author.bot && m.attachments?.some((a) => a.filename === 'state.json')
    );
  }

  async _downloadState(url) {
    const res = await fetch(url);
    return res.json();
  }

  // ── Role determination ───────────────────────────────────────────────────────

  async _getLeaderAgeMs() {
    try {
      const messages = await this._getCoordMessages();
      const msg = this._findStateMessage(messages);
      if (!msg) return Infinity;
      return Date.now() - new Date(msg.timestamp).getTime();
    } catch {
      return Infinity;
    }
  }

  // ── Startup ──────────────────────────────────────────────────────────────────

  async start() {
    // No coordination channel configured → run as a simple single instance
    if (!config.coordinationChannelId) {
      console.log('[Node] No COORDINATION_CHANNEL_ID set — starting as sole leader.');
      this._becomeLeader();
      return;
    }

    console.log(`[Node] Instance ID: ${instanceId}`);

    // Load whatever state we have locally
    const local = this._loadLocally();
    if (local) {
      importState(local.events || {});
      console.log(
        `[Node] Loaded ${Object.keys(local.events || {}).length} events from state.json`
      );
    }

    const ageMs = await this._getLeaderAgeMs();

    if (ageMs < LEADER_TIMEOUT_MS) {
      const ageMin = Math.floor(ageMs / 60000);
      console.log(`[Standby] Leader active (last sync ${ageMin}m ago). Running in standby.`);
      await this._syncFromCoordChannel().catch(() => {});
      this._runStandby();
    } else {
      console.log('[Node] No active leader found. Claiming leadership…');
      this._becomeLeader();
    }
  }

  // ── Standby mode ─────────────────────────────────────────────────────────────

  async _syncFromCoordChannel() {
    const messages = await this._getCoordMessages();
    const msg = this._findStateMessage(messages);
    if (!msg) return;

    const attachment = msg.attachments.find((a) => a.filename === 'state.json');
    const state = await this._downloadState(attachment.url);

    importState(state.events || {});
    this._saveLocally(state);
    console.log(
      `[Standby] State synced (${Object.keys(state.events || {}).length} events)`
    );
  }

  _runStandby() {
    this._syncTimer = setInterval(async () => {
      const ageMs = await this._getLeaderAgeMs().catch(() => Infinity);

      if (ageMs >= LEADER_TIMEOUT_MS) {
        clearInterval(this._syncTimer);

        // Random jitter so multiple standbys don't claim simultaneously
        const jitterMs = Math.floor(Math.random() * 30000);
        console.log(
          `[Standby] Leader offline! Waiting ${Math.floor(jitterMs / 1000)}s before claiming…`
        );
        await new Promise((r) => setTimeout(r, jitterMs));

        // Re-check after jitter — another standby may have already claimed it
        const ageAfter = await this._getLeaderAgeMs().catch(() => Infinity);
        if (ageAfter < LEADER_TIMEOUT_MS) {
          console.log('[Standby] Another node claimed leadership. Staying standby.');
          this._runStandby();
          return;
        }

        this._becomeLeader();
      } else {
        await this._syncFromCoordChannel().catch((err) =>
          console.warn('[Standby] Sync error:', err.message)
        );
      }
    }, SYNC_INTERVAL_MS);
  }

  _becomeLeader() {
    this.isLeader = true;
    console.log(`[Leader] This node is now the leader`);
    this.emit('promote');
  }

  // ── Leader mode ───────────────────────────────────────────────────────────────

  async startLeaderSync(client) {
    // Broadcast immediately when we first come online as leader
    await this._broadcastState(client).catch(console.error);

    this._syncTimer = setInterval(() => {
      this._broadcastState(client).catch(console.error);
    }, SYNC_INTERVAL_MS);
  }

  async _broadcastState(client) {
    const state = {
      syncedAt: Date.now(),
      leaderId: instanceId,
      events: exportState(),
    };

    this._saveLocally(state);

    if (!config.coordinationChannelId) return;

    const channel = await client.channels.fetch(config.coordinationChannelId);

    // Remove previous bot messages to keep the channel clean
    const existing = await channel.messages.fetch({ limit: 10 });
    for (const msg of existing.filter((m) => m.author.id === client.user.id).values()) {
      await msg.delete().catch(() => {});
    }

    const attachment = new AttachmentBuilder(
      Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      { name: 'state.json' }
    );

    const eventCount = Object.keys(state.events).length;
    await channel.send({
      content: [
        `🟢 **Leader:** \`${instanceId}\``,
        `📅 **Synced:** <t:${Math.floor(Date.now() / 1000)}:R>`,
        `📋 **Active events:** ${eventCount}`,
      ].join('\n'),
      files: [attachment],
    });

    console.log(`[Leader] State broadcast complete (${eventCount} active events)`);
  }
}

module.exports = new Coordinator();
