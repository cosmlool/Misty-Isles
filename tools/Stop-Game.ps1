$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $Root '.misty-game-processes.json'
if (Test-Path $stateFile) {
  try {
    $state = Get-Content -Raw $stateFile | ConvertFrom-Json
    foreach ($id in @($state.clientPid, $state.serverPid)) {
      if ($id) {
        # Close the command window tree created by this launcher, not every node process on the computer.
        & taskkill.exe /PID ([int]$id) /T /F 2>$null | Out-Null
      }
    }
    Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
    Write-Host 'Процессы клиента и сервера, запущенные этим файлом, остановлены.' -ForegroundColor Green
  } catch { Write-Host 'Не удалось прочитать состояние запуска. Закройте окна сервера и клиента вручную.' -ForegroundColor Yellow }
} else {
  Write-Host 'Файл состояния не найден. Если игра работает, закройте её окна сервера и клиента вручную.' -ForegroundColor Yellow
}
