# BDO Raid Helper — orientation for Claude

Standalone Windows tray app: Discord bot for Black Desert Online raid signups.
Node.js + discord.js, packaged with `@yao-pkg/pkg` to a GUI-subsystem `.exe`.

## Module map (read these first; everything else is derivable)

| File | Responsibility |
|---|---|
| [src/main.js](src/main.js) | Entry. Writes `[BOOT ]` log marker, loads baked+env+config.json, runs setup wizard, calls `initTray` + `ensureAutoStart`, then `require('./index')`. |
| [src/index.js](src/index.js) | Discord client (only on leader). `loginWithRetry` with 10/30/60/120/300s backoff. |
| [src/ha/coordinator.js](src/ha/coordinator.js) | Leader election via a Discord coordination channel. State is an attachment on a bot message; standbys poll its age. Has 10s in-memory message cache. |
| [src/scheduler/scheduleConfig.js](src/scheduler/scheduleConfig.js) | Per-day raid schedule (persisted to `schedule.json`). |
| [src/scheduler/autoEvent.js](src/scheduler/autoEvent.js) | Auto-posts the daily raid event at the configured time. |
| [src/tray.js](src/tray.js) | Spawns hidden PowerShell process hosting NotifyIcon + a hidden `TrayForm` (inline C# subclass) for `WM_ENDSESSION`. Auto-start via `.lnk` in Startup folder. |
| [src/utils/baseDir.js](src/utils/baseDir.js) | `dirname(process.execPath)` for packaged, `process.cwd()` for dev. Use for ALL exe-relative paths. |
| [build.js](build.js) | Bakes env vars into binary, runs pkg, patches PE Console→GUI, copies icon. Retries on Defender lock. |

## Build & run

```bash
npm start              # dev: uses .env + cwd, tray runs from project root
npm run build          # pkg → dist/bdo-raid-helper.exe (GUI subsystem, has tray)
node src/commands/deploy.js   # re-register slash commands with Discord
```

## Critical constants ([coordinator.js](src/ha/coordinator.js) top)

- `SYNC_INTERVAL_MS = 15 min` — leader broadcasts state
- `HEALTH_CHECK_MS = 2 min` — standby polls leader age
- `LEADER_TIMEOUT_MS = 20 min` — **must be > SYNC_INTERVAL** or you get false failovers
- `MSG_CACHE_TTL_MS = 10s` — collapses the 4 startup fetches into 1 HTTP call

## Tray IPC (Node ↔ PowerShell)

- Spawn: `spawn('powershell.exe', ['-Sta', '-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', <UTF-16LE base64>])` — NOT `-File` (encoding ambiguity), NOT `-NonInteractive` (blocks WinForms). Encoded size asserted < 30 000 chars.
- **Shutdown signal**: PS or Windows writes `%TEMP%\bdo-tray-<nodePid>.flag` → Node's `fs.watch` + 500ms poller fires `gracefulShutdown` → `coordinator.shutdown()`.
- **Tray PS diagnostic log**: `<exe-dir>\bdo-tray.log`, written via `FileStream` with `FileShare.ReadWrite`. **Never use `File.AppendAllText`** here — Node's open `WriteStream` on the same file would block it (default `FileShare.Read` is exclusive-write).
- **Windows shutdown handling**: `TrayForm` (inline C# subclass via `Add-Type`) overrides `WndProc` to catch `WM_ENDSESSION` (0x16). Calls `ShutdownBlockReasonCreate` to request extra time, raises the `EndSessionReceived` event, PS handler writes the flag file and blocks up to 8s waiting for Node to exit.

## Auto-start

- **Mechanism**: shortcut at `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BDO Raid Helper.lnk` (created via `WScript.Shell` COM). HKCU Run key was unreliable on the user's box.
- Tray menu Auto-start toggle reads/writes the same `.lnk`.
- `ensureAutoStart()` migrates: if legacy `HKCU\...\Run\BDORaidHelper` exists, it's deleted to prevent dual-launch.

## Discord quota

The coordination channel uses one message (attachment = state.json). Leader fetches/deletes/reposts every 15 min; standby polls age every 2 min. Cache collapses startup burst to one fetch. Total ≈ 1 000 API calls / day per running instance.

## Known gotchas (these will bite you again)

- **Fast Startup** (`HKLM:\...\Power\HiberbootEnabled=1`, on by default) breaks `SystemEvents.SessionEnding`. Use Form WndProc instead.
- **PowerShell 5.1 reads `.ps1` files as ANSI without BOM** — non-ASCII chars (`—` `─`) corrupt to smart quotes and break parsing. Use `-EncodedCommand` (immune) or keep PS source ASCII-only + write with BOM.
- **PowerShell `$pid` is read-only** — use `$botPid` or `$nodeHostPid` in scripts.
- **`[Action]{ ... }` scriptblock cast fails silently** in PS 5.1 against `Add-Type`-defined C# fields. Use a `public event EventHandler ...` and `$form.add_EventName(...)` instead.
- **Node `WriteStream` open on a log file** blocks `.NET File.AppendAllText` (incompatible FileShare modes). Use separate log files OR explicit `FileStream` with `FileShare.ReadWrite`.
- **Windows Defender briefly locks new exe** after pkg writes — `build.js` retries with 1 s gaps.
- **pkg targets `node18-win-x64`** even though dev system runs Node 24. The bundled runtime is what matters.
- **Auto-started exe has `cwd=C:\Windows\System32`** — never use `process.cwd()` for project paths; always import `BASE_DIR` from `utils/baseDir.js`.
- **Login retry must never `process.exit(1)`** — a Discord outage isn't permanent.
