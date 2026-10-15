@echo off
setlocal
cd /d "%~dp0"

rem ===== Settings (edit with Notepad) =====
rem Do not use the characters % or " in values.
set "ADMIN_USER=admin"
set "ADMIN_PASSWORD=change-this-password"
set "HOST=127.0.0.1"
set "PORT=3000"
rem ========================================

where node >/dev/null 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

echo Open http://127.0.0.1:%PORT% in your browser.
echo Press Ctrl+C to stop the server.
echo.
node server.js
pause
