#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8000}"
echo "Starting L'aor Dubber local web server without Python..."
echo "Open: http://localhost:$PORT"
if command -v npx >/dev/null 2>&1; then
  npx --yes http-server . -p "$PORT" -c-1
elif command -v php >/dev/null 2>&1; then
  php -S "localhost:$PORT"
elif command -v ruby >/dev/null 2>&1; then
  ruby -run -e httpd . -p "$PORT" -b 127.0.0.1
else
  echo "No local server found. Install Node.js, PHP, or Ruby, or upload to GitHub Pages."
  exit 1
fi
