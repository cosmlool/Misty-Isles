$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Write-Host '=== Диагностика Туманных островов ===' -ForegroundColor Cyan
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($node) { Write-Host "Node.js: $((& node --version).Trim())" -ForegroundColor Green } else { Write-Host 'Node.js: не найден — установите Node.js LTS с https://nodejs.org/' -ForegroundColor Red }
if ($npm) { Write-Host "npm: $((& npm --version).Trim())" -ForegroundColor Green } else { Write-Host 'npm: не найден' -ForegroundColor Red }
foreach ($part in @('server','client')) {
  $dir = Join-Path $Root $part
  Write-Host "`n[$part]"
  foreach ($file in @('package.json','package-lock.json')) { if (Test-Path (Join-Path $dir $file)) { Write-Host "  ${file}: OK" } else { Write-Host "  ${file}: ОТСУТСТВУЕТ" -ForegroundColor Red } }
  if (Test-Path (Join-Path $dir 'node_modules')) { Write-Host '  node_modules: установлены' -ForegroundColor Green } else { Write-Host '  node_modules: будут установлены при первом запуске' -ForegroundColor Yellow }
}
foreach ($port in @(2567,5173)) {
  $l = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($l) { Write-Host "Порт $port занят (PID $($l.OwningProcess))" -ForegroundColor Yellow } else { Write-Host "Порт $port свободен" -ForegroundColor Green }
}
Write-Host "`nДиагностика завершена. Полная совместимость проверяется запуском игры; эта проверка не заменяет сборку и игровые тесты."
