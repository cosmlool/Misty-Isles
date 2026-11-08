@echo off
setlocal
cd /d "%~dp0"
title Tumannye Ostrova - Launcher
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Start-Game.ps1"
if errorlevel 1 (
  echo.
  echo Game launch failed. Read the error above.
  pause
)
