#!/bin/bash
echo "Re-running setup wizard..."
echo "Your old config.json will be overwritten."
echo ""

if [ -f "dist/bdo-raid-helper-macos-arm64" ]; then
  ./dist/bdo-raid-helper-macos-arm64 --setup
elif [ -f "dist/bdo-raid-helper-macos-x64" ]; then
  ./dist/bdo-raid-helper-macos-x64 --setup
elif [ -f "dist/bdo-raid-helper-linux-x64" ]; then
  ./dist/bdo-raid-helper-linux-x64 --setup
else
  node src/main.js --setup
fi
