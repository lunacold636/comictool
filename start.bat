@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install from https://nodejs.org/
  pause
  exit /b 1
)

echo Starting comic tag library...
echo URL: http://127.0.0.1:38417/
node server.js
pause