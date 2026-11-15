$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $Root '.misty-game-processes.json'

function Test-ServerListener([int]$Port) {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  return [bool]$listener
}

if (-not (Test-Path $stateFile)) {
  Write-Host 'Файл состояния не найден. Сервер не буду завершать принудительно. Если он работает, остановите его из окна сервера сочетанием Ctrl+C.' -ForegroundColor Yellow
  return
}

try {
  $state = Get-Content -Raw $stateFile | ConvertFrom-Json
  $serverPort = if ($state.serverPort) { [int]$state.serverPort } else { 2567 }
  $serverStopped = -not (Test-ServerListener $serverPort)

  if (-not $serverStopped -and $state.shutdownToken) {
    try {
      $null = Invoke-RestMethod -Uri "http://127.0.0.1:$serverPort/internal/shutdown" -Method Post -Headers @{ 'X-Misty-Shutdown-Token' = [string]$state.shutdownToken } -TimeoutSec 5
      Write-Host 'Запрошено штатное завершение сервера. Ожидаю сохранения персонажей...' -ForegroundColor Cyan
      for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        if (-not (Test-ServerListener $serverPort)) { $serverStopped = $true; break }
      }
    } catch {
      Write-Host 'Не удалось подтвердить штатное завершение сервера.' -ForegroundColor Yellow
    }
  }

  if ($state.clientPid) {
    & taskkill.exe /PID ([int]$state.clientPid) /T /F 2>$null | Out-Null
  }

  if ($serverStopped) {
    if ($state.serverPid) {
      # At this point the game server has closed its listener and completed its graceful shutdown.
      # Force-close only the leftover launcher/watch console tree.
      & taskkill.exe /PID ([int]$state.serverPid) /T /F 2>$null | Out-Null
    }
    Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
    Write-Host 'Сервер штатно завершён, клиент остановлен.' -ForegroundColor Green
  } else {
    Write-Host 'Сервер всё ещё слушает порт. Не завершаю его принудительно, чтобы не повредить сохранения.' -ForegroundColor Red
    Write-Host 'Оставил файл состояния. Проверьте окно сервера и повторите остановку позже.' -ForegroundColor Yellow
  }
} catch {
  Write-Host 'Не удалось прочитать состояние запуска. Сервер не будет завершён принудительно.' -ForegroundColor Yellow
}
