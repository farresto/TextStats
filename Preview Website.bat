@echo off
title TextStats website preview
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Please install the LTS version from https://nodejs.org and run this file again.
  start https://nodejs.org
  pause
  exit /b 1
)

echo Building the website into the dist-web folder...
node tools\build-web.js
if errorlevel 1 (
  echo The build failed. See the messages above.
  pause
  exit /b 1
)

echo.
echo Opening http://localhost:8080 in your browser. Close this window to stop the preview.
start "" http://localhost:8080/
node tools\serve-web.js
