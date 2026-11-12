@echo off
rem Starts the Office Draft Assistant. Double-click this file.
cd /d "%~dp0"

where node >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First-time setup: installing. This needs internet and takes a minute...
  call npm install
  if errorlevel 1 (
    echo Installation failed. Check the internet connection and try again.
    pause
    exit /b 1
  )
)

node server.js
pause
