#!/usr/bin/env sh
set -eu

namespace="${1:-opsknight-docs}"
if [ "$namespace" != "opsknight-docs" ]; then
  echo "Refusing to delete namespace other than opsknight-docs" >&2
  exit 1
fi

kubectl delete namespace "$namespace" --ignore-not-found --wait=true
