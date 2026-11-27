#!/usr/bin/env bash
set -euo pipefail
umask 077
receipts="$RUNNER_TEMP/b1-case-receipts"
mkdir "$receipts"
for kind in update pause; do
  case_id="synthetic-organization-$kind"
  case "$kind" in
    update) artifact="$B1_UPDATE_ID"; other="synthetic-organization-pause" ;;
    pause) artifact="$B1_PAUSE_ID"; other="synthetic-organization-update" ;;
  esac
  [[ "$artifact" =~ ^[1-9][0-9]{0,15}$ ]]
  archive="$RUNNER_TEMP/$kind.zip"
  gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact/zip" > "$archive"
  verifier=(python3 scripts/acceptance/verify-organization-artifact.py --sandbox --workflow-sha "$GITHUB_SHA"
            --artifact "$artifact" --sha "$B1_PRODUCT" --archive "$archive" --run "$GITHUB_RUN_ID")
  window="$RUNNER_TEMP/window-$kind"
  "${verifier[@]}" --case "$case_id" --window-directory "$window" > "$receipts/$kind-transport.json"
  if "${verifier[@]}" --case "$other" 2>"$RUNNER_TEMP/wrong-case"; then exit 1; fi
  grep -Fxq ARTIFACT_SCOPE "$RUNNER_TEMP/wrong-case"
  mkdir -m 700 "$window/journal"
  for phase in accept finish; do
    node scripts/acceptance/operator.mjs organization-window-synthetic \
      "$window/scenario.json" "$window/evidence.json" "$window/journal" "$phase" > "$receipts/$kind-$phase.json"
  done
  verified=$(jq -er '.observationSha256' "$receipts/$kind-transport.json")
  jq -e --arg digest "$verified" '.evidenceDigest == $digest and .state == "cleanup"' "$receipts/$kind-accept.json" > /dev/null
  jq -e --arg digest "$verified" '.evidenceDigest == $digest and .state == "closed" and .protocolComplete == true and .acceptanceExecuted == false and .complete == false' \
    "$receipts/$kind-finish.json" > /dev/null
done
