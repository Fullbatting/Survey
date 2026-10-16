@echo off
setlocal
cd /d "%~dp0"

rem ===== Settings (edit with Notepad) =====
rem Do not use the characters % or " in values.
set "ADMIN_USER=admin"
rem Required: change this password. The server does not start with the default one.
set "ADMIN_PASSWORD=change-this-password"
rem HOST=0.0.0.0 : survey links and QR codes also open on other devices of this network.
rem HOST=127.0.0.1 : this PC only. Admin screens always open on this PC only.
set "HOST=0.0.0.0"
set "PORT=3000"
rem Optional: Wi-Fi for respondents, printed as a QR code on the A4 sheet.
set "WIFI_SSID="
set "WIFI_PASSWORD="
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
