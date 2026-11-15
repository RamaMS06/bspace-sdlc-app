#!/usr/bin/env bash
# Runs the desktop app in dev mode on the Node version this project needs (.nvmrc), even when the
# terminal is on another one. `pnpm` itself refuses to start on Node 20, so this has to run first.
#
#   ./dev.sh            starts the app (pnpm dev:desktop)
#   ./dev.sh --check    only shows which Node and pnpm it would use
set -e
cd "$(dirname "$0")"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use >/dev/null 2>&1 || nvm install >/dev/null
fi

want="$(cut -d. -f1 .nvmrc)"
have="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$have" -lt "$want" ]; then
  echo "This project needs Node $want or newer, but this terminal has Node $(node -v)." >&2
  echo "Install nvm (https://github.com/nvm-sh/nvm), then run: nvm install $want" >&2
  exit 1
fi

if [ "$1" = "--check" ]; then
  echo "Node $(node -v), pnpm $(pnpm -v)"
  exit 0
fi
exec pnpm dev:desktop "$@"
