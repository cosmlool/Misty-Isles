$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
# Keep local test accounts and world state separate from the normal server/data directory.
$env:MISTY_DATA_DIR = [System.IO.Path]::GetFullPath((Join-Path $Root '.local-data'))
# Pin the browser client to the local server even if the page is opened through another hostname.
$env:VITE_SERVER_URL = 'http://127.0.0.1:2567'
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'launcher.log'
function Say($m) { $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m"; Write-Host $line; Add-Content -LiteralPath $Log -Value $line }
function Fail($m) { Say "ОШИБКА: $m"; throw $m }
if (-not (Test-Path (Join-Path $Root 'client\package.json')) -or -not (Test-Path (Join-Path $Root 'server\package.json'))) { Fail 'Не найдены папки client/server. Распакуйте ZIP целиком, не переносите только отдельные файлы.' }
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) { Fail 'Node.js не найден. Установите Node.js LTS с https://nodejs.org/, затем запустите этот файл снова.' }
$nodeVersionText = (& node -p "process.versions.node").Trim()
try { $nodeVersion = [version]$nodeVersionText } catch { Fail "Не удалось определить версию Node.js: $nodeVersionText" }
if ($nodeVersion -lt [version]'18.0') { Fail "Нужен Node.js 18 или новее. Сейчас установлено $nodeVersionText. Рекомендуется актуальная LTS-версия." }
Say "Node.js $nodeVersionText обнаружен. Проверяю зависимости."
foreach ($part in @('server','client')) {
  $dir = Join-Path $Root $part
  if (-not (Test-Path (Join-Path $dir 'package-lock.json'))) { Fail "В папке $part отсутствует package-lock.json; автоматическая установка остановлена, чтобы не менять зависимости наугад." }
  if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
    Say "Первая установка зависимостей: $part. Это может занять несколько минут; последующие запуски будут быстрее."
    Push-Location $dir
    try {
      # Run npm through cmd.exe: Windows PowerShell 5.1 can treat harmless npm stderr
      # warnings (for example "npm warn deprecated") as terminating NativeCommandError.
      $installLog = Join-Path $LogDir "$part-install.log"
      $npmCmd = "call npm.cmd ci --no-audit --no-fund 1> `"$installLog`" 2>&1"
      & $env:ComSpec /d /s /c $npmCmd
      $npmExit = $LASTEXITCODE
      if ($npmExit -ne 0) { Get-Content -LiteralPath $installLog -Tail 30 | ForEach-Object { Write-Host $_ }; Fail "npm ci завершился с кодом $npmExit в папке $part. Проверьте logs\$part-install.log и подключение к интернету." }
      Get-Content -LiteralPath $installLog -Tail 12 | ForEach-Object { Write-Host $_ }
    }
    finally { Pop-Location }
  } else { Say "Зависимости $part найдены; повторная установка не требуется." }
}
# Fail early if the expected development ports are occupied by unrelated processes.
foreach ($port in @(2567,5173)) {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { Fail "Порт $port уже занят процессом PID $($listener.OwningProcess). Закройте предыдущий запуск игры или проверьте, какое приложение использует порт." }
}
$serverCmd = "cd /d `"$Root\server`" && npm run dev"
$clientCmd = "cd /d `"$Root\client`" && npm run dev -- --host 127.0.0.1"
Say 'Запускаю сервер Colyseus...'
$serverProc = Start-Process -FilePath $env:ComSpec -ArgumentList @('/k', $serverCmd) -WorkingDirectory (Join-Path $Root 'server') -PassThru
Start-Sleep -Seconds 2
if ($serverProc.HasExited) { Fail 'Окно сервера завершилось сразу после запуска. Посмотрите сообщение в окне сервера.' }
Say 'Ожидаю сервер на порту 2567 (до 45 секунд)...'
$ready = $false
for ($i=0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 1
  $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 2567 -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($tcp) { $ready = $true; break }
  if ($serverProc.HasExited) { break }
}
if (-not $ready) { try { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue } catch {}; Fail 'Сервер не открыл порт 2567 за 45 секунд. Проверьте окно сервера и logs\launcher.log.' }
Say 'Сервер готов. Запускаю клиент Vite...'
$clientProc = Start-Process -FilePath $env:ComSpec -ArgumentList @('/k', $clientCmd) -WorkingDirectory (Join-Path $Root 'client') -PassThru
$ready = $false
for ($i=0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 1
  $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 5173 -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($tcp) { $ready = $true; break }
  if ($clientProc.HasExited) { break }
}
if (-not $ready) { Fail 'Клиент Vite не открыл порт 5173 за 45 секунд. Проверьте окно клиента.' }
@{ serverPid = $serverProc.Id; clientPid = $clientProc.Id; startedAt = (Get-Date).ToString('o'); root = $Root } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Root '.misty-game-processes.json')
Say 'Готово. Открываю игру в браузере: http://127.0.0.1:5173'
Start-Process 'http://127.0.0.1:5173'
Write-Host ''
Write-Host 'Игра запущена. Не закрывайте окна сервера и клиента, пока игра нужна.' -ForegroundColor Green
Write-Host 'Для штатной остановки используйте «Остановить игру.bat».'
