# Usage (dev server running): powershell -File web/tools/perf.ps1 -Url "http://127.0.0.1:5178/web/?autostart" -Label "new Sea"
param([string]$Url, [string]$Label, [int]$Seconds = 30, [int]$Warmup = 12)
# Opens a page in headless Chrome on the real GPU, then measures the CPU time
# and 3D-engine GPU use of that Chrome's processes over a window.
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$prof = Join-Path $env:TEMP ("claude-perf-" + [guid]::NewGuid().ToString('N'))
$cargs = @('--headless=new', "--user-data-dir=$prof", '--no-first-run', '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', $Url)
$p = Start-Process -FilePath $chrome -ArgumentList $cargs -PassThru
Start-Sleep -Seconds $Warmup
function Get-Tree { Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$prof*" } }
$pids = (Get-Tree).ProcessId
function Get-Cpu($ids) { (Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum }
$cpu0 = Get-Cpu $pids
$t0 = Get-Date
$samples = Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -SampleInterval 2 -MaxSamples ([math]::Floor($Seconds / 2)) -ErrorAction SilentlyContinue
$t1 = Get-Date
$cpu1 = Get-Cpu $pids
$elapsed = ($t1 - $t0).TotalSeconds
$cpuPct = ($cpu1 - $cpu0) / $elapsed * 100
$gpuVals = foreach ($s in $samples) {
  $sum = 0
  foreach ($c in $s.CounterSamples) { foreach ($id in $pids) { if ($c.InstanceName -like "pid_${id}_*") { $sum += $c.CookedValue } } }
  $sum
}
$gpu = if ($gpuVals) { ($gpuVals | Measure-Object -Average).Average } else { 0 }
Get-Tree | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue
"{0,-28} CPU {1,6:N1}% of one core   GPU 3D {2,5:N1}%   ({3} processes, {4:N0}s)" -f $Label, $cpuPct, $gpu, $pids.Count, $elapsed
