const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const BASE_DIR = require('./utils/baseDir');

let _psProc   = null;
let _flagFile = null;

// ── Auto-start (Node.js side) ─────────────────────────────────────────────────

const REG_KEY  = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_NAME = 'BDORaidHelper';

function _isAutoStartRegistered() {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('reg.exe', ['query', REG_KEY, '/v', REG_NAME],
      { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // Also verify the stored path matches the current exe so a moved exe re-registers.
    return out.toLowerCase().includes(process.execPath.toLowerCase());
  } catch {
    return false;
  }
}

function ensureAutoStart() {
  if (process.platform !== 'win32') return;
  if (_isAutoStartRegistered()) return;
  try {
    const { execFileSync } = require('child_process');
    // Always wrap in quotes so paths with spaces launch correctly from the Run key.
    execFileSync('reg.exe', [
      'add', REG_KEY, '/v', REG_NAME, '/t', 'REG_SZ',
      '/d', `"${process.execPath}"`, '/f',
    ], { windowsHide: true });
    console.log('[Tray] Registered for auto-start with Windows.');
  } catch (err) {
    console.warn('[Tray] Auto-start registration failed:', err.message);
  }
}

// ── Tray (PowerShell NotifyIcon) ──────────────────────────────────────────────

function initTray(onExit) {
  if (process.platform !== 'win32') return;

  const exePath = process.execPath;
  _flagFile = path.join(os.tmpdir(), `bdo-tray-${process.pid}.flag`);

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

  const psScript = `
${psWriteLog(`"${pse(trayLogPath)}"`)}
Write-TrayLog "Tray PS started (PID \$PID)"
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Write-TrayLog "Assemblies loaded"

  \$tray = New-Object System.Windows.Forms.NotifyIcon
  \$tray.Text = "BDO Raid Helper"
  ${iconLine}
  Write-TrayLog "Icon set"
  \$tray.Visible = \$true
  Write-TrayLog "Tray visible"

  \$menu = New-Object System.Windows.Forms.ContextMenuStrip

  \$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem("BDO Raid Helper - Online")
  \$statusItem.Enabled = \$false
  [void]\$menu.Items.Add(\$statusItem)
  [void]\$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

  \$regPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
  \$isAuto  = \$null -ne (Get-ItemProperty -Path \$regPath -Name "BDORaidHelper" -ErrorAction SilentlyContinue)
  \$autoItem = New-Object System.Windows.Forms.ToolStripMenuItem("Auto-start with Windows")
  \$autoItem.Checked = \$isAuto
  \$autoItem.Add_Click({
    if (\$autoItem.Checked) {
      Remove-ItemProperty -Path \$regPath -Name "BDORaidHelper" -ErrorAction SilentlyContinue
      \$autoItem.Checked = \$false
    } else {
      New-ItemProperty -Path \$regPath -Name "BDORaidHelper" -Value '"${pse(exePath)}"' -PropertyType String -Force | Out-Null
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
    \$tray.Visible = \$false
    \$tray.Dispose()
    [System.IO.File]::WriteAllText("${pse(_flagFile)}", "exit")
    \$script:running = \$false
    \$hostPid = ${nodePid}
    \$null = Start-Job -ScriptBlock {
      param(\$p)
      Start-Sleep -Seconds 5
      Stop-Process -Id \$p -Force -ErrorAction SilentlyContinue
    } -ArgumentList \$hostPid
  })
  [void]\$menu.Items.Add(\$exitItem)

  \$tray.ContextMenuStrip = \$menu

  # ── Windows shutdown / logoff handler ────────────────────────────────────────
  # When Windows shuts down it sends WM_QUERYENDSESSION. SystemEvents.SessionEnding
  # is the .NET surface for this. We use script-scoped variables because .NET
  # delegates do not capture PowerShell local variables automatically.
  \$script:flagFilePath = "${pse(_flagFile)}"
  \$script:nodeHostPid  = ${nodePid}
  \$script:sessionHandler = {
    param(\$sender, \$e)
    Write-TrayLog "Windows session ending — requesting graceful shutdown"
    # Signal Node to run gracefulShutdown (same mechanism as the Exit menu item)
    try { [System.IO.File]::WriteAllText(\$script:flagFilePath, "exit") } catch {}
    \$script:running = \$false
    # Block the handler for up to 8 s so Node has time to delete the Discord
    # state message before Windows kills all processes.
    \$deadline = [System.DateTime]::UtcNow.AddSeconds(8)
    while ([System.DateTime]::UtcNow -lt \$deadline) {
      try {
        \$null = Get-Process -Id \$script:nodeHostPid -ErrorAction Stop
        Start-Sleep -Milliseconds 300
      } catch { break }   # Node has exited — we're done
    }
    Write-TrayLog "Session handler complete"
  }
  try {
    [Microsoft.Win32.SystemEvents]::add_SessionEnding(\$script:sessionHandler)
    Write-TrayLog "SessionEnding handler registered"
  } catch {
    Write-TrayLog "SessionEnding registration failed: \$(\$_.Exception.Message)"
  }
  # ─────────────────────────────────────────────────────────────────────────────

  \$script:running = \$true
  while (\$script:running) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 100
  }
  Write-TrayLog "Tray loop exited normally"
  try { [Microsoft.Win32.SystemEvents]::remove_SessionEnding(\$script:sessionHandler) } catch {}
} catch {
  Write-TrayLog "ERROR: \$(\$_.Exception.Message)"
}
`;

  // -EncodedCommand passes the script as UTF-16LE base64, which:
  //   1. Bypasses execution policy entirely (no file needed)
  //   2. Eliminates .ps1 temp-file encoding ambiguity (the #1 silent-failure cause)
  //   3. Removes -NonInteractive which can block WinForms UI creation on some configs
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

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
