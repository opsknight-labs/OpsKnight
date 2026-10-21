#!/bin/sh
# Keep TLS and package-signature verification enabled on every attempt.
set -eu
if [ "$#" -eq 0 ]; then
  echo 'At least one Alpine package is required.' >&2
  exit 2
fi
attempt=1
while ! (apk --no-cache --timeout 30 upgrade && apk --no-cache --timeout 30 add "$@"); do
  if [ "$attempt" -ge 3 ]; then
    echo 'Verified Alpine package installation failed after three attempts.' >&2
    exit 1
  fi
  echo "Alpine package fetch failed; retrying attempt $((attempt + 1)) of 3." >&2
  sleep "$((attempt * 2))"
  attempt=$((attempt + 1))
done
