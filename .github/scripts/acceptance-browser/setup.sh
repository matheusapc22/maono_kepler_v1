#!/usr/bin/env bash
set -euo pipefail

# Hosted Ubuntu already supplies Chromium's shared libraries. Keep the OS fixed
# and prove launchability below instead of upgrading system packages in the
# protected five-minute setup window.
test "${RUNNER_OS:?}" = Linux
. /etc/os-release
test "$ID:$VERSION_ID" = ubuntu:24.04
export PLAYWRIGHT_BROWSERS_PATH="${RUNNER_TEMP:?}/maono-acceptance-browsers"

npm install --prefix scripts/acceptance \
  --no-save --no-package-lock --ignore-scripts --no-audit --no-fund \
  @playwright/test@1.55.0
./scripts/acceptance/node_modules/.bin/playwright install --only-shell chromium
node "$(dirname "$0")/smoke.mjs"

# Only publish the isolated browser location after a successful offline smoke.
printf 'PLAYWRIGHT_BROWSERS_PATH=%s\n' "$PLAYWRIGHT_BROWSERS_PATH" >> "${GITHUB_ENV:?}"
