@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo === Misty Isles full project verification ===
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 is required. Install Node.js 22 and try again.
  exit /b 1
)
node tools\verify-all.mjs
exit /b %errorlevel%
