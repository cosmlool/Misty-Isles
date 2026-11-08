param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Continue'
$logDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$report = Join-Path $logDir ('diagnostics-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
$lines = New-Object System.Collections.Generic.List[string]
function Add-Line([string]$Text) { $script:lines.Add($Text) }
function Check-Path([string]$Relative) {
  $full = Join-Path $Root $Relative
  if (Test-Path -LiteralPath $full) { Add-Line ('[OK] Found: ' + $Relative) }
  else { Add-Line ('[INFO] Not found: ' + $Relative) }
}
Add-Line ('Date: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Add-Line ('Project folder: ' + $Root)
Add-Line 'Read-only checks only. No game saves, purchases, battles, or character data are changed.'
Add-Line ''
@('client\package.json','client\src\main.ts','server\package.json','server\src\index.ts','Запустить игру.bat','tools\Start-Game.ps1') | ForEach-Object { Check-Path $_ }
Add-Line ''
try { Add-Line ('Node: ' + ((& node --version 2>&1 | Out-String).Trim())) } catch { Add-Line '[INFO] Node.js was not found in PATH.' }
try { Add-Line ('npm: ' + ((& npm.cmd --version 2>&1 | Out-String).Trim())) } catch { Add-Line '[INFO] npm was not found in PATH.' }
foreach ($port in @(2567,5173)) {
  $listening = $false
  try { $listening = [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop | Select-Object -First 1) } catch {}
  if ($listening) { Add-Line ('[OK] Local port ' + $port + ' is listening.') }
  else { Add-Line ('[INFO] Local port ' + $port + ' is not listening.') }
}
$lines | Set-Content -LiteralPath $report -Encoding UTF8
Write-Host ('Diagnostic report saved: ' + $report)
Write-Host 'Checks are read-only; inspect the report and share it if you want help.'
