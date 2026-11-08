@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo === Misty Isles Stage 28 quality verification ===
if not exist "client\node_modules" (cd client && npm ci && cd ..) else (echo Client dependencies already installed.)
if errorlevel 1 goto fail
if not exist "server\node_modules" (cd server && npm ci && cd ..) else (echo Server dependencies already installed.)
if errorlevel 1 goto fail
node tools\qa-audit.mjs
if errorlevel 1 goto fail
cd client
call npm run verify:project
if errorlevel 1 goto fail
cd ..\server
call npm run build
if errorlevel 1 goto fail
cd ..
echo.
echo Verification passed. Start with "Запустить игру.bat".
exit /b 0
:fail
echo.
echo Verification failed. Read the first npm/TypeScript error above.
exit /b 1
