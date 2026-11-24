#!/usr/bin/env bash
# Copy published images from GHCR to Docker Hub, byte for byte (same digests), so users can
# still pull when GitHub, or this org, is unavailable.
#
#   mirror-dockerhub.sh all              every user-facing tag that exists on GHCR (one-time backfill)
#   mirror-dockerhub.sh release vX.Y.Z   the tags a release publishes (used by docker-image.yml)
#
# Env: DOCKERHUB_NAMESPACE (required), GHCR_OWNER (default opsknight-labs),
#      GHCR_TOKEN (a GitHub token, needed while the org's packages are hidden), DRY_RUN=1 to print
#      instead of copying. Needs `docker login` for Docker Hub (and for ghcr.io if the packages are private).
set -euo pipefail

NS="${DOCKERHUB_NAMESPACE:?set DOCKERHUB_NAMESPACE}"
OWNER="${GHCR_OWNER:-opsknight-labs}"
IMAGES="opsknight opsknight-agent opsknight-pgbouncer"
# shortcut: pgbouncer is versioned separately from the app; keep in sync with docker-image.yml.
PGBOUNCER_VERSION="${PGBOUNCER_VERSION:-1.26.0}"

copy() {
  local image="$1" tag="$2"
  local src="ghcr.io/${OWNER}/${image}:${tag}" dst="docker.io/${NS}/${image}:${tag}"
  if [[ -n "${DRY_RUN:-}" ]]; then echo "would copy ${src} -> ${dst}"; return; fi
  docker buildx imagetools create --prefer-index=false -t "$dst" "$src" >/dev/null
  local want have
  want="$(docker buildx imagetools inspect "$src" --format '{{.Manifest.Digest}}')"
  have="$(docker buildx imagetools inspect "$dst" --format '{{.Manifest.Digest}}')"
  [[ "$want" == "$have" ]] || { echo "digest mismatch for ${dst}: ${have} != ${want}" >&2; return 1; }
  echo "copied ${image}:${tag} (${want})"
}

case "${1:-}" in
  all)
    for image in $IMAGES; do
      auth=(); [[ -n "${GHCR_TOKEN:-}" ]] && auth=(-u "x-access-token:${GHCR_TOKEN}")
      token="$(curl -fsS "${auth[@]}" "https://ghcr.io/token?scope=repository:${OWNER}/${image}:pull" | jq -r .token)"
      # sha-* and rc-* are build staging tags, not something users pull.
      tags="$(curl -fsS -H "Authorization: Bearer ${token}" "https://ghcr.io/v2/${OWNER}/${image}/tags/list?n=10000" |
        jq -r '.tags[]? | select(startswith("sha-") or startswith("rc-") | not)')"
      for tag in $tags; do copy "$image" "$tag"; done
    done
    ;;
  release)
    version="${2:?usage: mirror-dockerhub.sh release vX.Y.Z}"
    version="${version#v}"
    if [[ "$version" == *-* ]]; then
      # Release candidate: only its own tag; latest, X.Y and X stay where they are.
      tags=("$version")
      pgbouncer_tags=("$PGBOUNCER_VERSION")
    else
      IFS=. read -r major minor _ <<<"$version"
      tags=("$version" "${major}.${minor}" "$major" latest)
      pgbouncer_tags=("$PGBOUNCER_VERSION" latest)
    fi
    for image in opsknight opsknight-agent; do for tag in "${tags[@]}"; do copy "$image" "$tag"; done; done
    for tag in "${pgbouncer_tags[@]}"; do copy opsknight-pgbouncer "$tag"; done
    ;;
  *)
    echo "usage: $0 all | release vX.Y.Z" >&2
    exit 2
    ;;
esac
