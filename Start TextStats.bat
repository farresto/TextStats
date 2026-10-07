@echo off
title TextStats
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Please install the LTS version from https://nodejs.org and run this file again.
  start https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo First run: installing Electron. This takes a minute...
  call npm install
  if errorlevel 1 (
    echo Installation failed. See the messages above.
    pause
    exit /b 1
  )
)

call npm start
