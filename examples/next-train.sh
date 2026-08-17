#!/usr/bin/env bash
# The next train from A to B, with its platform and status.
#
#   ./next-train.sh PAD RDG
#   ./next-train.sh "London Paddington" "Cam & Dursley"
#
# Needs curl and jq.
set -euo pipefail

from=${1:?usage: next-train.sh FROM TO}
to=${2:?usage: next-train.sh FROM TO}

enc() { jq -rn --arg s "$1" '$s | @uri'; }

body=$(curl -s -w '\n%{http_code}' \
  "https://api.traini.ac/api/journey/$(enc "$from")/$(enc "$to")?limit=1")
status=${body##*$'\n'}
json=${body%$'\n'*}

if [ "$status" != 200 ]; then
  echo "HTTP $status: $(jq -r '.error' <<<"$json")" >&2
  jq -r '.hint // empty' <<<"$json" >&2
  exit 1
fi

jq -r '
  .resolved as $r
  | if .result_count == 0 then
      "No trains from \($r.from.name) to \($r.to.name) today."
    else
      .results[0]
      | "\($r.from.name) → \($r.to.name)",
        "  departs \(.departs[11:16])" +
          (if .expected_departs and .expected_departs != .departs
           then " (expected \(.expected_departs[11:16]))" else "" end) +
          ", arrives \(.arrives[11:16]) — \(.duration_minutes) min",
        (if .changes == 0 then
           "  \(.headcode) \(.operator), platform \(.platform // "?"), \(.status_text)"
         else
           "  change at \(.interchange.name) (\(.connection_minutes) min, connection \(.connection_status))"
         end)
    end
' <<<"$json"
