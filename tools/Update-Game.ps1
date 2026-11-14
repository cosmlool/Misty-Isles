$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Branch = 'staging/local-isolated-launcher'
$Remote = 'origin'
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'updater.log'
function Say($m) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m"
  Write-Host $line
  Add-Content -LiteralPath $Log -Value $line
}
function Fail($m) {
  Say "ОШИБКА: $m"
  Write-Host ''
  Write-Host 'Обновление остановлено. Локальные файлы и сохранения не удалялись.' -ForegroundColor Yellow
  exit 1
}
function Invoke-Git([string[]]$GitArgs, [string]$Description) {
  Say $Description
  & git @GitArgs 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { Fail "Команда Git завершилась с кодом $LASTEXITCODE." }
}
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { Fail 'Git не найден. Установите Git for Windows и повторите запуск.' }
if (-not (Test-Path (Join-Path $Root '.git'))) { Fail 'Эта папка не является Git-клоном. Не распаковывайте ZIP поверх неё. Создайте отдельный clone репозитория.' }
$isRepo = (& git rev-parse --is-inside-work-tree 2>$null)
if ($LASTEXITCODE -ne 0 -or $isRepo.Trim() -ne 'true') { Fail 'Git не распознал эту папку как рабочий репозиторий.' }
$currentBranch = (& git branch --show-current 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne $Branch) { Fail "Ожидалась ветка '$Branch', а найдена '$currentBranch'. Автоматическое переключение веток запрещено." }
$origin = (& git remote get-url $Remote 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -notmatch 'github\.com[:/]cosmlool/Misty-Isles(?:\.git)?$') { Fail "Remote origin не соответствует cosmlool/Misty-Isles: $origin" }
$status = @(& git status --porcelain --untracked-files=normal)
if ($LASTEXITCODE -ne 0) { Fail 'Не удалось проверить локальные изменения.' }
if ($status.Count -gt 0) {
  Say 'Найдены локальные изменения. Чтобы не перезаписать вашу работу, обновление отменено:'
  $status | ForEach-Object { Write-Host "  $_" }
  Fail 'Сначала сохраните или отдельно разберите локальные изменения. Автоматический stash/reset не выполняется.'
}
Invoke-Git @('fetch', $Remote, $Branch) 'Проверяю обновления на GitHub...'
$remoteRef = "$Remote/$Branch"
$remoteHead = (& git rev-parse $remoteRef 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or -not $remoteHead) { Fail "Не удалось получить ссылку $remoteRef." }
$localHead = (& git rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0) { Fail 'Не удалось определить текущий commit.' }
& git merge-base --is-ancestor HEAD $remoteRef 2>$null
if ($LASTEXITCODE -ne 0) { Fail 'Локальная ветка отличается от GitHub или содержит собственные commits. Автоматическое слияние запрещено.' }
if ($localHead -eq $remoteHead) {
  Say 'Уже установлена последняя версия.'
  $changedFiles = @()
} else {
  $changedFiles = @(& git diff --name-only HEAD $remoteRef)
  if ($LASTEXITCODE -ne 0) { Fail 'Не удалось определить список обновляемых файлов.' }
  Invoke-Git @('pull', '--ff-only', $Remote, $Branch) 'Загружаю обновления (только безопасный fast-forward)...'
  Say "Обновление завершено: $localHead -> $remoteHead"
}
$lockProjects = @()
if ($changedFiles -contains 'client/package-lock.json') { $lockProjects += 'client' }
if ($changedFiles -contains 'server/package-lock.json') { $lockProjects += 'server' }
if ($changedFiles -contains 'e2e/package-lock.json') { $lockProjects += 'e2e' }
if ($lockProjects.Count -gt 0) {
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) { Fail 'Обновились lock-файлы, но npm не найден. Установите Node.js LTS; зависимости пока не изменены.' }
  foreach ($part in $lockProjects) {
    $dir = Join-Path $Root $part
    Say "Обновляю зафиксированные зависимости: $part (npm ci)..."
    $installLog = Join-Path $LogDir "$part-update-install.log"
    $command = 'cd /d "' + $dir + '" && call npm.cmd ci --no-audit --no-fund 1> "' + $installLog + '" 2>&1'
    & $env:ComSpec /d /s /c $command
    $npmExit = $LASTEXITCODE
    if ($npmExit -ne 0) {
      Get-Content -LiteralPath $installLog -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
      Fail "npm ci завершился с кодом $npmExit для $part. Подробности: logs\$part-update-install.log"
    }
    Say "Зависимости $part обновлены."
  }
}
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Say 'Выполняю быструю проверку структуры и данных...'
  & node (Join-Path $Root 'tools/qa-audit.mjs')
  if ($LASTEXITCODE -ne 0) { Fail 'Быстрая проверка проекта не пройдена. Игра не будет запущена.' }
} else {
  Fail 'Node.js не найден после обновления. Установите Node.js LTS и повторите запуск.'
}
Say 'Обновление и быстрая проверка завершены успешно.'
exit 0
