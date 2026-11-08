# recipes/reload-extension.ps1: reload the unpacked "Browser Agent Bridge" extension in the user's
# running Chrome by Windows UI Automation (Windows PowerShell 5.1). Written 2026-10-23, stage
# RELOAD-AUTO (decisions.md 2026-10-23 #64).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\recipes\reload-extension.ps1 [-DryRun]
#
# What it does, and nothing else:
#   1. Computes the extension's ID from the path of extension/ (Chrome's rule for an unpacked
#      extension: sha256 of the absolute path as UTF-16LE, first 16 bytes, each nibble as a-p).
#   2. Opens ONE new Chrome window of its own (chrome.exe --new-window about:blank; Chrome refuses a
#      chrome:// URL on the command line) and navigates it to chrome://extensions through that
#      window's own address bar (UIA SetValue, then one Enter key only while that window is in the
#      foreground and its address bar has the keyboard focus).
#   3. Finds the card whose name is "Browser Agent Bridge" AND whose ID line is that ID, and in it the
#      one button with AutomationId "dev-reload-button" (the card's reload arrow) whose parent is the
#      page's extension list. Any doubt (no card, two cards, no button, two buttons, wrong page) ->
#      it presses nothing and exits 2.
#   4. Invokes that button once, then verifies: UI Automation sees the card's service worker restart
#      ("Inspect views" changes), and, when a bridge daemon is running, daemon.log gets a new
#      "extension resync" line (the extension's socket came back). Neither seen -> exit 3.
#   5. Closes its own window (WM_CLOSE), and checks that it is gone - unless the new window was not on
#      about:blank before any typing (then it is not surely its own: nothing typed, pressed or closed).
#
# It never presses Update (reloads every unpacked extension), a toggle, Remove, Details, Errors,
# Developer mode, or anything on another card; never touches another window; never types into the
# Options page; prints no title or URL of any other window, and never reads or prints the token.
#
# Exit codes: 0 reloaded and verified; 2 nothing pressed (a precondition or doubt, message says
# which); 3 pressed but the reload could not be verified; 4 reloaded but its own window did not close;
# 5 -DryRun found the card and its button (nothing pressed); 1 a script error (read the output to see
# whether "pressed the reload button" was printed). Call it directly with its parameters: a wrapper
# that forwards an array through `powershell -File` can drop them (verifier, RELOAD-AUTO).
# After exit 0, prove the build with the stale-extension check of the wave in progress (e.g.
# `npx tsx recipes/t5.ts check`, docs/e2e-test-plan.md section 1 item 9).
param(
  [string]$ExtensionDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'extension'),
  [string]$Name = 'Browser Agent Bridge',
  # The name before the rename (Step 15 S1): a card still showing it, until its first reload, also matches.
  [string[]]$OldNames = @('Chrome Agent Bridge'),
  [string]$ExtensionId = 'iifofgbdljchbdimlalhphmedfmocela',  # the fixed ID from the manifest's key (Step 15 S4); '' = the path-based ID
  [int]$TimeoutSec = 15,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
if (-not ('ReloadWin' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ReloadWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string Text(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
}
'@
}

function Say([string]$m) { Write-Output ('{0:yyyy-MM-ddTHH:mm:ss.fffZ} reload-extension: {1}' -f [DateTime]::UtcNow, $m) }
function Quit([int]$code, [string]$m) { Say $m; exit $code }

$UIA = [Windows.Automation.AutomationElement]
function ById($root, [string]$aid) {
  $c = New-Object Windows.Automation.PropertyCondition($UIA::AutomationIdProperty, $aid)
  $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $c)
}

# Visible top-level Chrome browser windows (class Chrome_WidgetWin_1 owned by a chrome.exe process).
function Get-ChromeWindows {
  $chromePids = @(Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
  $found = New-Object System.Collections.ArrayList
  $cb = [ReloadWin+EnumProc]{ param($h, $l)
    if ([ReloadWin]::IsWindowVisible($h) -and [ReloadWin]::Cls($h) -eq 'Chrome_WidgetWin_1') {
      $wpid = [uint32]0; [void][ReloadWin]::GetWindowThreadProcessId($h, [ref]$wpid)
      if ($chromePids -contains $wpid -and [ReloadWin]::Text($h)) { [void]$found.Add([long]$h) }
    }
    $true }
  [void][ReloadWin]::EnumWindows($cb, [IntPtr]::Zero)
  ,@($found)
}

function Get-ChromeExe {
  $p = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)'
  if (-not $p) { $p = (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)' }
  foreach ($c in @($p, "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  $null
}

function Get-UnpackedId([string]$dir) {
  $bytes = [Text.Encoding]::Unicode.GetBytes($dir)
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
  -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
}

# The card of extension $id: the flattened (control-view) accessibility tree of the page lists each card's elements in order,
# starting at its name text (AutomationId "name"); a card ends where the next name begins.
function Find-Card($root, [string]$id) {
  $list = ById $root 'RootWebArea'   # the page itself; the list (itemsList) is in the raw view only
  if (-not $list) { return @{ Error = 'no page document (AutomationId RootWebArea) in my window' } }
  $all = @($list.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition))
  $starts = @(); for ($i = 0; $i -lt $all.Count; $i++) { if ($all[$i].Current.AutomationId -eq 'name') { $starts += $i } }
  $cards = @()
  for ($k = 0; $k -lt $starts.Count; $k++) {
    $s = $starts[$k]; $e = if ($k + 1 -lt $starts.Count) { $starts[$k + 1] } else { $all.Count }
    $span = @($all[$s..($e - 1)])
    if ($all[$s].Current.Name -ne $Name -and $OldNames -notcontains $all[$s].Current.Name) { continue }
    $idText = @($span | Where-Object { $_.Current.Name -match "(^|\s)$id$" })
    $cards += ,@{ Span = $span; HasId = ($idText.Count -eq 1) }
  }
  $named = @($cards).Count
  $mine = @($cards | Where-Object { $_.HasId })
  if ($mine.Count -ne 1) { return @{ Error = "cards named '$Name': $named; with ID $id`: $($mine.Count) (need exactly 1)" } }
  $span = $mine[0].Span
  $btns = @($span | Where-Object {
      $_.Current.AutomationId -eq 'dev-reload-button' -and
      $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button })
  $links = @($span | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::Hyperlink } | ForEach-Object { $_.Current.Name })
  @{ Span = $span; Buttons = $btns; Links = $links; Count = $all.Count }
}

# ------------------------------------------------------------------------------------------- run

$ExtensionDir = [IO.Path]::GetFullPath($ExtensionDir).TrimEnd('\')
if (-not (Test-Path (Join-Path $ExtensionDir 'manifest.json'))) { Quit 2 "no manifest.json in $ExtensionDir - nothing pressed" }
if (-not $ExtensionId) { $ExtensionId = Get-UnpackedId $ExtensionDir }
Say "extension $Name, ID $ExtensionId (from $ExtensionDir)"

$chrome = Get-ChromeExe
if (-not $chrome) { Quit 2 'chrome.exe not found - nothing pressed' }
if (-not (Get-Process chrome -ErrorAction SilentlyContinue)) { Quit 2 'Chrome is not running; this recipe never starts it (it would restore the user''s session) - nothing pressed' }

$log = Join-Path $HOME '.browser-agent-bridge\daemon.log'
$daemon = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'daemon[\\/]dist[\\/]index\.js' })
$logLines = if (Test-Path $log) { @(Get-Content $log -Encoding UTF8).Count } else { 0 }
Say ("daemon running: " + $(if ($daemon.Count) { "yes (pid $($daemon[0].ProcessId))" } else { 'no - only the UIA check will verify the reload' }))

$before = Get-ChromeWindows
Start-Process -FilePath $chrome -ArgumentList '--new-window', 'about:blank'
$t0 = Get-Date; $new = @()
do { Start-Sleep -Milliseconds 300; $now = Get-ChromeWindows; $new = @($now | Where-Object { $before -notcontains $_ }) } until ($new.Count -ge 1 -or ((Get-Date) - $t0).TotalSeconds -gt $TimeoutSec)
if ($new.Count -ne 1) { Quit 2 "expected exactly 1 new Chrome window, found $($new.Count) - not knowing which is mine, none is touched or closed - nothing pressed" }
$H = [long]$new[0]
Say "own window $H opened"

$script:exit = 0
$script:own = $true
function Invoke-Reload {
  $root = $UIA::FromHandle([IntPtr]$H)
  # Navigate through this window's own address bar.
  $c = New-Object Windows.Automation.PropertyCondition($UIA::ClassNameProperty, 'OmniboxViewViews')
  $omni = $null; $t0 = Get-Date
  while (-not $omni -and ((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec) { $omni = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $c); if (-not $omni) { Start-Sleep -Milliseconds 300 } }
  if (-not $omni) { $script:exit = 2; $script:own = $false; Say "no address bar in the new window $H - not surely mine, so nothing typed, pressed or closed"; return }
  # The window must be the blank one this recipe asked for (verifier m3): its address bar reads
  # about:blank (an about:blank page has no document element in the UIA tree, measured).
  $u0 = ''; $t0 = Get-Date
  do {
    $u0 = $omni.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value
    if ($u0 -ne 'about:blank') { Start-Sleep -Milliseconds 200 }
  } until ($u0 -eq 'about:blank' -or ((Get-Date) - $t0).TotalSeconds -gt 5)
  if ($u0 -ne 'about:blank') { $script:exit = 2; $script:own = $false; Say "the new window $H is not on about:blank - not surely mine, so it is neither typed into, pressed in, nor closed"; return }
  if (([long][ReloadWin]::GetForegroundWindow()) -ne $H) {
    # Chrome normally activates a window it opens, so this is rarely needed (verifier m1): an ALT tap lets
    # this process set the foreground, and it reaches whichever window is in front at that moment.
    [ReloadWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [ReloadWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][ReloadWin]::SetForegroundWindow([IntPtr]$H); Start-Sleep -Milliseconds 300
  }
  $omni.SetFocus()
  $omni.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue('chrome://extensions')
  Start-Sleep -Milliseconds 300
  $focused = $UIA::FocusedElement
  $fg = [long][ReloadWin]::GetForegroundWindow()
  if ($fg -ne $H -or -not $focused -or -not [Windows.Automation.Automation]::Compare($focused, $omni)) {
    $script:exit = 2; Say 'my window or its address bar does not have the keyboard focus - no key sent, nothing pressed'; return
  }
  [ReloadWin]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero); [ReloadWin]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero)  # Enter

  # Wait for the extensions page and the card.
  $card = $null; $url = ''; $t0 = Get-Date
  do {
    Start-Sleep -Milliseconds 300
    $doc = ById $root 'RootWebArea'
    if ($doc) {
      $vp = $null; if ($doc.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $url = $vp.Current.Value }
      if ($url -eq 'chrome://extensions/') { $card = Find-Card $root $ExtensionId; if ($card.Error -or $card.Buttons.Count -eq 0) { $last = $card; $card = $null } }
    }
  } until ($card -or ((Get-Date) - $t0).TotalSeconds -gt $TimeoutSec)
  if ($url -ne 'chrome://extensions/') { $script:exit = 2; Say 'my window did not reach chrome://extensions/ - nothing pressed'; return }
  if (-not $card) {
    $why = if ($last.Error) { $last.Error } else { 'the card has no reload button (AutomationId dev-reload-button) - is Developer mode on? (this recipe never switches it)' }
    $script:exit = 2; Say "$why - nothing pressed"; return
  }
  if ($card.Buttons.Count -ne 1) { $script:exit = 2; Say "the card has $($card.Buttons.Count) reload buttons (need exactly 1) - nothing pressed"; return }
  $btn = $card.Buttons[0]
  $parent = [Windows.Automation.TreeWalker]::RawViewWalker.GetParent($btn)
  if ($parent.Current.AutomationId -ne 'itemsList') { $script:exit = 2; Say "the reload button's parent is not the extension list - nothing pressed"; return }
  $pat = $null
  if (-not $btn.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $script:exit = 2; Say 'the reload button has no Invoke pattern - nothing pressed'; return }
  $linksBefore = $card.Links -join ' | '
  Say "card found: ID $ExtensionId, 1 reload button ('$($btn.Current.Name)', AutomationId dev-reload-button); inspect views: $linksBefore"
  if ($DryRun) { $script:exit = 5; Say 'dry run - card and button found, nothing pressed'; return }

  # Press it once, then watch the card.
  $pressed = [DateTime]::UtcNow
  $pressedSec = New-Object DateTime ($pressed.Ticks - ($pressed.Ticks % [TimeSpan]::TicksPerSecond)), ([DateTimeKind]::Utc)
  $pat.Invoke()
  Say 'pressed the reload button of the card'
  $sawRestart = $false; $t0 = Get-Date; $linksAfter = ''
  do {
    Start-Sleep -Milliseconds 40
    $cc = Find-Card $root $ExtensionId
    if (-not $cc.Error) {
      $linksAfter = $cc.Links -join ' | '
      if ($linksAfter -ne $linksBefore) { $sawRestart = $true }
    }
  } until (((Get-Date) - $t0).TotalMilliseconds -gt 3000)
  Start-Sleep -Milliseconds 500
  $cc = Find-Card $root $ExtensionId
  $linksAfter = if ($cc.Error) { "($($cc.Error))" } else { $cc.Links -join ' | ' }
  Say ("UIA: the card's service worker restart seen: " + $(if ($sawRestart) { 'yes' } else { 'no' }) + "; inspect views now: $linksAfter")

  $resync = $null
  if ($daemon.Count) {
    $t0 = Get-Date
    do {
      Start-Sleep -Milliseconds 300
      $lines = @(Get-Content $log -Encoding UTF8 | Select-Object -Skip $logLines)
      # Only a line stamped at or after the press second counts (the log has whole UTC seconds; verifier m4).
      $resync = @($lines | Where-Object {
          $_ -match '^(\S+Z) extension resync: ' -and
          [DateTime]::Parse($Matches[1], [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal) -ge $pressedSec }) | Select-Object -Last 1
    } until ($resync -or ((Get-Date) - $t0).TotalSeconds -gt $TimeoutSec)
    Say ('daemon.log: ' + $(if ($resync) { "new line '$resync'" } else { "no new 'extension resync' line within $TimeoutSec s" }))
  }
  if ($daemon.Count -and -not $resync) { $script:exit = 3; Say 'RELOAD NOT VERIFIED - the extension did not reconnect to the daemon after the press'; return }
  if (-not $daemon.Count -and -not $sawRestart) { $script:exit = 3; Say 'RELOAD NOT VERIFIED - no daemon to reconnect to, and UIA did not see the service worker restart'; return }
  Say ('RELOAD OK - ' + $(if ($resync) { 'the extension reconnected to the daemon' } else { 'the service worker restarted (UIA)' }) + ' after the press at ' + $pressed.ToString('HH:mm:ss.fff') + 'Z; now run the stale-extension check')
}
try { Invoke-Reload }
finally {
  if ($script:own) {
    [void][ReloadWin]::PostMessage([IntPtr]$H, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)  # WM_CLOSE, as the title-bar X
    $t0 = Get-Date
    while ([ReloadWin]::IsWindow([IntPtr]$H) -and ((Get-Date) - $t0).TotalSeconds -lt 5) { Start-Sleep -Milliseconds 200 }
    if ([ReloadWin]::IsWindow([IntPtr]$H)) { Say "own window $H did NOT close - close it by hand"; if ($script:exit -eq 0) { $script:exit = 4 } }
    else { Say "own window $H closed" }
  }
}
exit $script:exit
