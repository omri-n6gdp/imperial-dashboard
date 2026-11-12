#!/bin/bash
# Double-click to open the Imperial Dashboard in your browser.
# Keep this Terminal window open while you use it; close it (or press Ctrl+C) to stop.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 isn't installed yet."
  echo "macOS will offer to install the Command Line Tools. Accept, wait for it to finish, then double-click this file again."
  xcode-select --install 2>/dev/null
  read -n 1 -s -r -p "Press any key to close this window."
  exit 1
fi
exec python3 "_meta/app/server.py" "$@"
