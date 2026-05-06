@echo off
title BDO Raid Helper — Reconfigure
echo Re-running setup wizard...
echo Your old config.json will be overwritten.
echo.

if exist "dist\bdo-raid-helper-win-x64.exe" (
  dist\bdo-raid-helper-win-x64.exe --setup
) else (
  node src\main.js --setup
)
pause
