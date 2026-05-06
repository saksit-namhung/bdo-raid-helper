@echo off
title BDO Raid Helper
echo Starting BDO Raid Helper...

if not exist ".env" (
  echo ERROR: .env file not found.
  echo Please copy .env.example to .env and fill in your values.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies for the first time...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed. Make sure Node.js is installed.
    pause
    exit /b 1
  )
)

:loop
node src/main.js
echo Bot stopped. Restarting in 5 seconds... (Press Ctrl+C to quit)
timeout /t 5 /nobreak >nul
goto loop
