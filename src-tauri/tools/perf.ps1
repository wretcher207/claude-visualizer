# Usage (app running and set up the way you want it measured):
#   powershell -File src-tauri/tools/perf.ps1 -Label "app maximized" [-Seconds 30]
#   powershell -File src-tauri/tools/perf.ps1 -Baseline -Label "nothing running"
# Measures the CPU time and 3D-engine GPU use of the app's own process plus all
# of its WebView2 processes, the way web/tools/perf.ps1 does for a headless
# Chrome tab. It also reports the desktop compositor (dwm.exe) and the whole
# GPU, because a visible window costs compositing that headless Chrome never paid.
# A discrete card's clock changes the percentages a lot, so compare runs only at
# the same clock (nvidia-smi --query-gpu=pstate,clocks.gr --format=csv).
param([string]$Label = 'app', [int]$Seconds = 30, [switch]$Baseline,
      [string]$Exe = 'prompt-is-prologue', [string]$DataDir = 'com.deadpixeldesign.promptisprologue')
$ids = New-Object 'System.Collections.Generic.HashSet[int]'
if (-not $Baseline) {
  $app = Get-Process -Name $Exe -ErrorAction Stop | Select-Object -First 1
  $procs = Get-CimInstance Win32_Process
  [void]$ids.Add($app.Id)
  do {
    $grew = $false
    foreach ($p in $procs) { if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $grew = $true } }
  } while ($grew)
  foreach ($p in $procs) { if ($p.Name -eq 'msedgewebview2.exe' -and $p.CommandLine -like "*$DataDir*") { [void]$ids.Add([int]$p.ProcessId) } }
}
$pids = @($ids)
$dwm = (Get-Process -Name dwm -ErrorAction SilentlyContinue | Select-Object -First 1).Id
function Get-Cpu($list) { if (-not $list) { return 0 }; (Get-Process -Id $list -ErrorAction SilentlyContinue | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum }
$cpu0 = Get-Cpu $pids
$t0 = Get-Date
$samples = Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -SampleInterval 2 -MaxSamples ([math]::Floor($Seconds / 2)) -ErrorAction SilentlyContinue
$t1 = Get-Date
$cpu1 = Get-Cpu $pids
$elapsed = ($t1 - $t0).TotalSeconds
$cpuPct = ($cpu1 - $cpu0) / $elapsed * 100
$app3d = @(); $dwm3d = @(); $all3d = @()
foreach ($s in $samples) {
  $a = 0; $d = 0; $t = 0
  foreach ($c in $s.CounterSamples) {
    $t += $c.CookedValue
    if ($c.InstanceName -match '^pid_(\d+)_') {
      $id = [int]$matches[1]
      if ($ids.Contains($id)) { $a += $c.CookedValue } elseif ($id -eq $dwm) { $d += $c.CookedValue }
    }
  }
  $app3d += $a; $dwm3d += $d; $all3d += $t
}
function Get-Avg($v) { if ($v) { ($v | Measure-Object -Average).Average } else { 0 } }
"{0,-28} CPU {1,6:N1}% of one core   GPU 3D app {2,5:N1}%  dwm {3,5:N1}%  whole GPU {4,5:N1}%   ({5} processes, {6:N0}s)" -f $Label, $cpuPct, (Get-Avg $app3d), (Get-Avg $dwm3d), (Get-Avg $all3d), $pids.Count, $elapsed
