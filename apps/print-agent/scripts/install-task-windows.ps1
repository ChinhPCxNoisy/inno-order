# Cai Print Agent chay nen tren Windows bang Task Scheduler (khong can cong cu ngoai).
# Chay PowerShell "Run as Administrator" tai thu muc print-agent:
#   powershell -ExecutionPolicy Bypass -File scripts\install-task-windows.ps1
# Go bo: powershell -ExecutionPolicy Bypass -File scripts\install-task-windows.ps1 -Uninstall
param([switch]$Uninstall, [string]$TaskName = 'InnoOrder Print Agent')

$ErrorActionPreference = 'Stop'
if ($Uninstall) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Da go tac vu '$TaskName'."
  exit 0
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$node = (Get-Command node -ErrorAction Stop).Source
$entry = Join-Path $root 'dist\cli\agent.js'
if (-not (Test-Path $entry)) { throw "Chua co $entry. Chay 'npm run build' truoc." }
if (-not (Test-Path (Join-Path $root 'agent.config.json'))) { throw "Chua co agent.config.json (xem agent.config.example.json)." }

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$entry`" --config `"$(Join-Path $root 'agent.config.json')`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Da cai va khoi dong tac vu '$TaskName' (tu chay khi bat may). Xem nhat ky: $(Join-Path $root 'logs\agent.log')"
