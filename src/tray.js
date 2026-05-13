const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const BASE_DIR = require('./utils/baseDir');

let _psProc   = null;
let _flagFile = null;

// ── Auto-start (Startup folder shortcut) ─────────────────────────────────────
// We use a Startup folder .lnk instead of the HKCU\...\Run registry key because
// Run keys were silently failing to launch the exe on this user's Windows install
// despite a correct registry value. Startup folder is the canonical Windows
// auto-start surface (used by OneDrive, Steam, etc.) and behaves identically
// across Fast Startup, normal boot, and resume.

const LEGACY_REG_KEY  = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const LEGACY_REG_NAME = 'BDORaidHelper';

function _startupLnkPath() {
  return path.join(
    process.env.APPDATA || '',
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
    'BDO Raid Helper.lnk'
  );
}

// Reads the .lnk's TargetPath via WScript.Shell — returns lowercase string or ''.
function _readShortcutTarget(lnk) {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `try { (New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}').TargetPath } catch {}`,
    ], { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim().toLowerCase();
  } catch {
    return '';
  }
}

function _isAutoStartRegistered() {
  const lnk = _startupLnkPath();
  if (!fs.existsSync(lnk)) return false;
  // Also check that the shortcut points at the current exe — a moved install
  // would otherwise silently keep launching the stale path.
  return _readShortcutTarget(lnk) === process.execPath.toLowerCase();
}

function _removeLegacyRunKey() {
  try {
    const { execFileSync } = require('child_process');
    execFileSync('reg.exe',
      ['query', LEGACY_REG_KEY, '/v', LEGACY_REG_NAME],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // It exists — delete it so we don't double-launch.
    execFileSync('reg.exe',
      ['delete', LEGACY_REG_KEY, '/v', LEGACY_REG_NAME, '/f'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    console.log('[Tray] Removed legacy Run key (migrated to Startup folder).');
  } catch { /* not present — fine */ }
}

function ensureAutoStart() {
  if (process.platform !== 'win32') return;
  _removeLegacyRunKey();
  if (_isAutoStartRegistered()) return;
  try {
    const { execFileSync } = require('child_process');
    const lnk    = _startupLnkPath();
    const exe    = process.execPath;
    const exeDir = path.dirname(exe);
    // Single-quote escape for PowerShell string literals
    const psQ = (s) => s.replace(/'/g, "''");
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${psQ(lnk)}');` +
      `$s.TargetPath = '${psQ(exe)}';` +
      `$s.WorkingDirectory = '${psQ(exeDir)}';` +
      `$s.IconLocation = '${psQ(exe)},0';` +
      `$s.Description = 'BDO Raid Helper Discord bot';` +
      `$s.Save()`,
    ], { windowsHide: true });
    console.log('[Tray] Auto-start shortcut created in Startup folder.');
  } catch (err) {
    console.warn('[Tray] Auto-start registration failed:', err.message);
  }
}

// ── Tray (PowerShell NotifyIcon) ──────────────────────────────────────────────

function initTray(onExit) {
  if (process.platform !== 'win32') return;

  const exePath = process.execPath;
  _flagFile = path.join(os.tmpdir(), `bdo-tray-${process.pid}.flag`);

  // Clean up flag files from previous force-killed runs so a stale "exit"
  // signal can't cause a spurious immediate shutdown of this instance.
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (/^bdo-tray-\d+\.flag$/.test(f)) {
        try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch { /* in use */ }
      }
    }
  } catch { /* tmpdir unreadable — non-fatal */ }

  const iconPath    = path.join(BASE_DIR, 'icon.ico');
  const logPath     = path.join(BASE_DIR, 'bdo-raid-helper.log');
  // Separate log for the PS tray process — written with FileShare.ReadWrite so it
  // doesn't conflict with Node's WriteStream that holds bdo-raid-helper.log open.
  // File.AppendAllText uses FileShare.Read (exclusive write), which is incompatible
  // with Node's stream, causing all tray errors to be silently swallowed.
  const trayLogPath = path.join(BASE_DIR, 'bdo-tray.log');

  // In PowerShell the escape character is the backtick, NOT backslash.
  // Only escape backtick, $, and " — backslashes are literal.
  const pse = (s) => s.replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '`"');

  const iconLine = fs.existsSync(iconPath)
    ? `$tray.Icon = New-Object System.Drawing.Icon("${pse(iconPath)}")`
    : `$tray.Icon = [System.Drawing.SystemIcons]::Application`;

  const nodePid = process.pid;

  // Write to trayLogPath using FileStream + FileShare.ReadWrite so it never
  // conflicts with Node's WriteStream that holds bdo-raid-helper.log open.
  const psWriteLog = (varName) => `
function Write-TrayLog([string]\$line) {
  try {
    \$fs = [System.IO.File]::Open(${varName}, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
    \$sw = New-Object System.IO.StreamWriter(\$fs, [System.Text.Encoding]::UTF8)
    \$sw.AutoFlush = \$true
    \$sw.WriteLine("[$(Get-Date -Format 'o')] \$line")
    \$sw.Close(); \$fs.Close()
  } catch {}
}`;

  // Startup folder path used by the in-menu auto-start toggle (must match
  // _startupLnkPath() on the JS side so both surfaces agree on truth).
  const lnkPath = path.join(
    process.env.APPDATA || '',
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
    'BDO Raid Helper.lnk'
  );

  const psScript = `
${psWriteLog(`"${pse(trayLogPath)}"`)}
Write-TrayLog "Tray PS started (PID \$PID)"
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Write-TrayLog "Assemblies loaded"

  # Inline C# Form subclass with WndProc override.
  # Top-level forms reliably receive WM_ENDSESSION (0x16) via WndProc, unlike
  # SystemEvents.SessionEnding which is unreliable under Fast Startup.
  # We call ShutdownBlockReasonCreate to extend Windows shutdown timeout while
  # Node finishes deleting the Discord state message.
  if (-not ('TrayForm' -as [Type])) {
    Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @"
      using System;
      using System.Runtime.InteropServices;
      using System.Windows.Forms;
      public class TrayForm : Form {
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern bool ShutdownBlockReasonCreate(IntPtr hWnd, string pwszReason);
        [DllImport("user32.dll")]
        static extern bool ShutdownBlockReasonDestroy(IntPtr hWnd);
        // Standard event pattern — PowerShell wires this via add_EndSessionReceived
        // without needing a [Action] scriptblock cast (which fails silently in PS 5.1).
        public event EventHandler EndSessionReceived;
        protected override void WndProc(ref Message m) {
          if (m.Msg == 0x0016 /* WM_ENDSESSION */ && m.WParam != IntPtr.Zero) {
            try { ShutdownBlockReasonCreate(this.Handle, "Saving Discord state"); } catch {}
            try { if (EndSessionReceived != null) EndSessionReceived(this, EventArgs.Empty); } catch {}
            try { ShutdownBlockReasonDestroy(this.Handle); } catch {}
          }
          base.WndProc(ref m);
        }
      }
"@
  }

  \$form = New-Object TrayForm
  \$form.Text             = "BDO Raid Helper"
  \$form.ShowInTaskbar    = \$false
  \$form.FormBorderStyle  = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
  \$form.WindowState      = [System.Windows.Forms.FormWindowState]::Minimized
  \$form.Opacity          = 0
  \$form.Size             = New-Object System.Drawing.Size(1, 1)
  \$form.Location         = New-Object System.Drawing.Point(-32000, -32000)
  Write-TrayLog "Hidden Form created"

  \$tray = New-Object System.Windows.Forms.NotifyIcon
  \$tray.Text = "BDO Raid Helper"
  ${iconLine}
  \$tray.Visible = \$true
  Write-TrayLog "Tray visible"

  \$menu = New-Object System.Windows.Forms.ContextMenuStrip

  \$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem("BDO Raid Helper - Online")
  \$statusItem.Enabled = \$false
  [void]\$menu.Items.Add(\$statusItem)
  [void]\$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

  # Auto-start uses a Startup folder .lnk (canonical Windows mechanism).
  \$lnkPath  = "${pse(lnkPath)}"
  \$exeFull  = "${pse(exePath)}"
  \$exeDir   = "${pse(path.dirname(exePath))}"
  function Test-AutoStart {
    if (-not (Test-Path \$lnkPath)) { return \$false }
    try {
      \$tp = (New-Object -ComObject WScript.Shell).CreateShortcut(\$lnkPath).TargetPath
      return (\$tp.ToLower() -eq \$exeFull.ToLower())
    } catch { return \$false }
  }
  \$autoItem = New-Object System.Windows.Forms.ToolStripMenuItem("Auto-start with Windows")
  \$autoItem.Checked = Test-AutoStart
  \$autoItem.Add_Click({
    if (\$autoItem.Checked) {
      Remove-Item \$lnkPath -ErrorAction SilentlyContinue
      \$autoItem.Checked = \$false
    } else {
      \$s = (New-Object -ComObject WScript.Shell).CreateShortcut(\$lnkPath)
      \$s.TargetPath = \$exeFull
      \$s.WorkingDirectory = \$exeDir
      \$s.IconLocation = "\$exeFull,0"
      \$s.Description = "BDO Raid Helper Discord bot"
      \$s.Save()
      \$autoItem.Checked = \$true
    }
  })
  [void]\$menu.Items.Add(\$autoItem)
  [void]\$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

  \$logsItem = New-Object System.Windows.Forms.ToolStripMenuItem("View Logs")
  \$logsItem.Add_Click({
    if (Test-Path "${pse(logPath)}") { Start-Process notepad "${pse(logPath)}" }
  })
  [void]\$menu.Items.Add(\$logsItem)
  [void]\$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

  \$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem("Exit")
  \$exitItem.Add_Click({
    # User-initiated exit: signal Node async, then close the form. We do NOT
    # block here -- gracefulShutdown will run on Node side via the flag file.
    try { [System.IO.File]::WriteAllText("${pse(_flagFile)}", "exit") } catch {}
    \$form.Close()
    # 5 s watchdog: if Node hangs in coordinator.shutdown(), force-kill it.
    \$hostPid = ${nodePid}
    \$null = Start-Job -ScriptBlock {
      param(\$p)
      Start-Sleep -Seconds 5
      Stop-Process -Id \$p -Force -ErrorAction SilentlyContinue
    } -ArgumentList \$hostPid
  })
  [void]\$menu.Items.Add(\$exitItem)

  \$tray.ContextMenuStrip = \$menu
  Write-TrayLog "Menu attached to tray"

  # Wire the Form's WndProc -> EndSessionReceived -> flag-file + wait-for-Node.
  # Re-entrancy guarded by \$script:shuttingDown so a concurrent Exit click
  # can't trigger a second 8 s block.
  \$script:shuttingDown = \$false
  \$script:flagFilePath = "${pse(_flagFile)}"
  \$script:nodeHostPid  = ${nodePid}
  \$form.add_EndSessionReceived({
    if (\$script:shuttingDown) { return }
    \$script:shuttingDown = \$true
    Write-TrayLog "WM_ENDSESSION received -- signaling Node graceful shutdown"
    try { [System.IO.File]::WriteAllText(\$script:flagFilePath, "exit") } catch {}
    # Block up to 8 s waiting for Node to finish coordinator.shutdown()
    \$deadline = [System.DateTime]::UtcNow.AddSeconds(8)
    while ([System.DateTime]::UtcNow -lt \$deadline) {
      try {
        \$null = Get-Process -Id \$script:nodeHostPid -ErrorAction Stop
        Start-Sleep -Milliseconds 200
      } catch { break }
    }
    Write-TrayLog "WM_ENDSESSION handler complete"
  })

  Write-TrayLog "Form message loop started"
  try {
    [System.Windows.Forms.Application]::Run(\$form)
  } finally {
    try { \$tray.Visible = \$false; \$tray.Dispose() } catch {}
    try { \$menu.Dispose() } catch {}
    Write-TrayLog "Application.Run returned - tray disposed"
  }
} catch {
  Write-TrayLog "ERROR: \$(\$_.Exception.Message)"
}
`;

  // -EncodedCommand passes the script as UTF-16LE base64, which:
  //   1. Bypasses execution policy entirely (no file needed)
  //   2. Eliminates .ps1 temp-file encoding ambiguity (the #1 silent-failure cause)
  //   3. Removes -NonInteractive which can block WinForms UI creation on some configs
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  // CreateProcessW caps the command line at ~32 KB. We're well under, but a
  // future change ballooning the script should fail loud, not silently.
  if (encoded.length > 30000) {
    throw new Error(`Tray PS script too large for -EncodedCommand: ${encoded.length} chars`);
  }

  try {
    _psProc = spawn('powershell.exe', [
      '-Sta',
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-EncodedCommand', encoded,
    ], {
      windowsHide: true,
      stdio: 'ignore',
    });
    _psProc.unref();
  } catch (err) {
    console.warn('[Tray] Failed to launch tray process:', err.message);
    return;
  }

  const flagBase = path.basename(_flagFile);
  let _exitHandled = false;
  function _handleExitFlag() {
    if (_exitHandled) return;
    if (!fs.existsSync(_flagFile)) return;
    _exitHandled = true;
    try { watcher.close(); } catch {}
    clearInterval(poller);
    try { fs.unlinkSync(_flagFile); } catch {}
    onExit();
  }

  // fs.watch on Windows can deliver null for filename — check the flag file
  // directly on every event rather than filtering by name.
  const watcher = fs.watch(os.tmpdir(), { persistent: false }, (_event, filename) => {
    if (filename === null || filename === flagBase) _handleExitFlag();
  });
  watcher.unref();

  // Polling fallback in case the fs.watch event is dropped.
  const poller = setInterval(_handleExitFlag, 500);
  poller.unref();

  process.on('exit', () => {
    if (_psProc && !_psProc.killed) try { _psProc.kill(); } catch {}
    try { if (_flagFile) fs.unlinkSync(_flagFile); } catch {}
  });

  console.log('[Tray] System tray initialized.');
}

module.exports = { initTray, ensureAutoStart };
