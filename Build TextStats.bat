@echo off
title Build TextStats
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Please install the LTS version from https://nodejs.org and run this file again.
  start https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\electron-builder" (
  echo Installing build tools. This takes a minute...
  call npm install
  if errorlevel 1 goto :failed
)

echo.
echo Raising the version number...
call npm version patch --no-git-tag-version
if errorlevel 1 goto :failed

echo.
echo Deleting the previous build...
if exist "dist" rmdir /s /q "dist"
if exist "dist" (
  echo Could not delete the dist folder. Close TextStats and any open file in dist, then try again.
  pause
  exit /b 1
)

echo.
echo Building TextStats...
call npm run dist
if errorlevel 1 goto :failed

echo.
echo Done. The new portable TextStats .exe is in the dist folder.
start "" "%~dp0dist"
pause
exit /b 0

:failed
echo.
echo The build failed. See the messages above.
pause
exit /b 1
