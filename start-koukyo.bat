@echo off
setlocal

set "PORT=5175"
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port=%PORT%; $conn=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; if ($conn) { exit 2 } else { exit 0 }"

if "%ERRORLEVEL%"=="2" (
  echo Server is already running on port %PORT%.
) else (
  echo Starting Koukyo app server on port %PORT%...
  start "koukyo-server" /min cmd /k "node dev-server.mjs %PORT%"
  timeout /t 2 /nobreak >nul
)

for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { ($_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.') -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { $ip } else { '127.0.0.1' }"`) do set "LAN_IP=%%I"

set "LOCAL_URL=http://127.0.0.1:%PORT%/index.html"
set "LAN_URL=http://%LAN_IP%:%PORT%/index.html"

echo.
echo Open on this PC:
echo   %LOCAL_URL%
echo.
echo Open on iPhone connected to the same Wi-Fi:
echo   %LAN_URL%
echo.

start "" "%LOCAL_URL%"

echo The server window is minimized as "koukyo-server".
echo Close that server window when you want to stop the app.
echo.
pause
