@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Misty-Isles - Update and Launch
echo === Misty-Isles: проверка обновлений ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Update-Game.ps1"
if errorlevel 1 (
  echo.
  echo Обновление не выполнено. Игра не запущена.
  pause
  exit /b 1
)
echo.
echo === Запуск локального сервера и клиента ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Start-Game.ps1"
if errorlevel 1 (
  echo.
  echo Ошибка запуска. Подробности: logs\launcher.log
  pause
  exit /b 1
)
