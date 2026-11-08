@echo off
setlocal
cd /d "%~dp0"
title Tumannye Ostrova - Stop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Stop-Game.ps1"
echo.
pause
