const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { REST, Routes, AttachmentBuilder } = require('discord.js');
const config = require('../config');
const { exportState, importState } = require('../state/eventStore');

const STATE_FILE = path.join(process.cwd(), 'state.json');
const SYNC_INTERVAL_MS = 5 * 60 * 1000;    // 5 minutes — full state sync cadence
const HEALTH_CHECK_MS = 30 * 1000;         // 30 seconds — leader liveness poll cadence
const LEADER_TIMEOUT_MS = 6 * 60 * 1000;  // 6 minutes — leader considered dead after this
const NODE_STALE_MS = LEADER_TIMEOUT_MS * 2; // presence message age threshold

const instanceId = `node-${Date.now()}-${Math.floor(Math.random() * 9999)
  .toString()
  .padStart(4, '0')}`;

class Coordinator extends EventEmitter {
  constructor() {
    super();
    this.isLeader = false;
    this._syncTimer = null;
    this._presenceMessageId = null; // this node's heartbeat message in coord channel
    this._statusMessageId = null;   // standalone status message posted when no state msg existed
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

  // ── Status card ──────────────────────────────────────────────────────────────

  // Updates the status card in the coord channel.
  // If a state message (with attachment) exists it is patched in-place so the
  // attachment is preserved for standbys still syncing.
  // If no state message exists a standalone text message is posted and its ID
  // is stored in _statusMessageId so it can be cleaned up later.
  async _updateStatusCard(content) {
    if (!config.coordinationChannelId) return;
    try {
      const messages = await this._getCoordMessages();
      const stateMsg = this._findStateMessage(messages);
      if (stateMsg) {
        await this._rest.patch(
          Routes.channelMessage(config.coordinationChannelId, stateMsg.id),
          { body: { content } }
        );
      } else {
        const msg = await this._rest.post(
          Routes.channelMessages(config.coordinationChannelId),
          { body: { content } }
        );
        this._statusMessageId = msg.id;
      }
    } catch (err) {
      console.warn('[Node] Failed to update status card:', err.message);
    }
  }

  // ── Presence heartbeat ───────────────────────────────────────────────────────

  async _updatePresence(role) {
    if (!config.coordinationChannelId) return;

    const content = `[NODE] \`${instanceId}\` | **${role}** | <t:${Math.floor(Date.now() / 1000)}:R>`;

    if (this._presenceMessageId) {
      try {
        await this._rest.patch(
          Routes.channelMessage(config.coordinationChannelId, this._presenceMessageId),
          { body: { content } }
        );
        return;
      } catch {
        this._presenceMessageId = null;
      }
    }

    try {
      const msg = await this._rest.post(
        Routes.channelMessages(config.coordinationChannelId),
        { body: { content } }
      );
      this._presenceMessageId = msg.id;
    } catch (err) {
      console.warn('[Node] Failed to post presence:', err.message);
    }
  }

  async _deletePresence() {
    if (!config.coordinationChannelId || !this._presenceMessageId) return;
    try {
      await this._rest.delete(Routes.channelMessage(config.coordinationChannelId, this._presenceMessageId));
    } catch { /* already gone */ }
    this._presenceMessageId = null;
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
    if (!config.coordinationChannelId) {
      console.log('[Node] No COORDINATION_CHANNEL_ID set — starting as sole leader.');
      this._becomeLeader();
      return;
    }

    console.log(`[Node] Instance ID: ${instanceId}`);

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
      // Recover whatever state exists in the coord channel before taking over so
      // that in-flight event registrations (reactions) keep working after handoff.
      await this._syncFromCoordChannel().catch(() => {});
      await this._updateStatusCard([
        '⚠️ **No active host** — starting…',
        `📅 **Detected:** <t:${Math.floor(Date.now() / 1000)}:R>`,
      ].join('\n')).catch(() => {});
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

    await this._updatePresence('standby').catch(() => {});
  }

  _runStandby() {
    let lastSyncAt = Date.now();

    this._syncTimer = setInterval(async () => {
      const ageMs = await this._getLeaderAgeMs().catch(() => Infinity);

      if (ageMs >= LEADER_TIMEOUT_MS) {
        clearInterval(this._syncTimer);

        // Mark the status card as offline before waiting — any standby can do this
        // since it just patches the existing state message via REST
        await this._updateStatusCard([
          '🔴 **Host offline** — electing new leader…',
          `📅 **Detected:** <t:${Math.floor(Date.now() / 1000)}:R>`,
        ].join('\n')).catch(() => {});

        const jitterMs = Math.floor(Math.random() * 30000);
        console.log(
          `[Standby] Leader offline! Waiting ${Math.floor(jitterMs / 1000)}s before claiming…`
        );
        await new Promise((r) => setTimeout(r, jitterMs));

        const ageAfter = await this._getLeaderAgeMs().catch(() => Infinity);
        if (ageAfter < LEADER_TIMEOUT_MS) {
          console.log('[Standby] Another node claimed leadership. Staying standby.');
          this._runStandby();
          return;
        }

        this._becomeLeader();
      } else if (Date.now() - lastSyncAt >= SYNC_INTERVAL_MS) {
        await this._syncFromCoordChannel().catch((err) =>
          console.warn('[Standby] Sync error:', err.message)
        );
        lastSyncAt = Date.now();
      }
    }, HEALTH_CHECK_MS);
  }

  _becomeLeader() {
    this.isLeader = true;
    this._deletePresence().catch(() => {});
    console.log(`[Leader] This node is now the leader`);
    this.emit('promote');
  }

  // Called by main.js gracefulShutdown on SIGINT/SIGTERM.
  // Deletes the state message so standbys see Infinity age on their next
  // 30-second health check and immediately start a new election.
  async shutdown() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }

    await this._deletePresence().catch(() => {});

    if (!config.coordinationChannelId) return;

    try {
      const messages = await this._getCoordMessages();
      const stateMsg = this._findStateMessage(messages);
      if (stateMsg) {
        await this._rest.delete(
          Routes.channelMessage(config.coordinationChannelId, stateMsg.id)
        );
        console.log('[Node] State message removed — standbys will elect a new leader.');
      }
    } catch (err) {
      console.warn('[Node] Shutdown cleanup error:', err.message);
    }
  }

  // ── Leader mode ───────────────────────────────────────────────────────────────

  async shutdown() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }

    if (config.coordinationChannelId) {
      try {
        // Delete the state attachment message so standbys immediately see Infinity age
        const messages = await this._getCoordMessages();
        const stateMsg = this._findStateMessage(messages);
        if (stateMsg) {
          await this._rest.delete(
            Routes.channelMessage(config.coordinationChannelId, stateMsg.id)
          );
        }
        await this._updateStatusCard([
          '🔴 **Host offline** — shutting down.',
          `📅 **Stopped:** <t:${Math.floor(Date.now() / 1000)}:R>`,
        ].join('\n')).catch(() => {});
      } catch (err) {
        console.warn('[Node] Shutdown cleanup error:', err.message);
      }
      await this._deletePresence().catch(() => {});
    }

    if (this._client) this._client.destroy();
  }

  async startLeaderSync(client) {
    this._client = client;

    // Clean up any standalone status message we posted before the Discord client
    // was ready (the "no active host" case where no state message existed yet)
    if (this._statusMessageId) {
      await this._rest.delete(
        Routes.channelMessage(config.coordinationChannelId, this._statusMessageId)
      ).catch(() => {});
      this._statusMessageId = null;
    }

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

    const existing = await channel.messages.fetch({ limit: 20 });

    // Remove the previous state message (has attachment) — this also removes
    // the patched "host offline" content since it's on the same message
    for (const msg of existing.filter((m) => m.author.id === client.user.id && m.attachments.size > 0).values()) {
      await msg.delete().catch(() => {});
    }

    // Remove stale presence messages from nodes that went offline
    for (const msg of existing.filter((m) =>
      m.author.id === client.user.id &&
      m.attachments.size === 0 &&
      (Date.now() - (m.editedTimestamp ?? m.createdTimestamp)) >= NODE_STALE_MS
    ).values()) {
      await msg.delete().catch(() => {});
    }

    // Count standby nodes: fresh bot messages without attachments
    const standbyCnt = existing.filter((m) =>
      m.author.id === client.user.id &&
      m.attachments.size === 0 &&
      (Date.now() - (m.editedTimestamp ?? m.createdTimestamp)) < NODE_STALE_MS
    ).size;
    const nodeCount = standbyCnt + 1; // +1 for this leader node

    const attachment = new AttachmentBuilder(
      Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      { name: 'state.json' }
    );

    await channel.send({
      content: [
        `🟢 **Leader:** \`${instanceId}\``,
        `📅 **Synced:** <t:${Math.floor(Date.now() / 1000)}:R>`,
        `🖥️ **Running nodes:** ${nodeCount}`,
      ].join('\n'),
      files: [attachment],
    });

    console.log(`[Leader] State broadcast complete (${nodeCount} node(s) running)`);
  }
}

module.exports = new Coordinator();
