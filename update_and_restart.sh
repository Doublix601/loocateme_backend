#!/usr/bin/env bash
# update_and_restart.sh
# Script to update the backend project from origin/main and restart Docker services.
# Place this file at the root of loocateme_backend.
#
# Usage:
#   chmod +x update_and_restart.sh
#   ./update_and_restart.sh
#
# Optional flags:
#   --no-build   Do not rebuild images (only pull and restart)
#   --no-logs    Do not tail logs after restart
#   --branch BR  Use a specific branch instead of main
#
set -euo pipefail

# --- Helpers ---
log() { printf "\033[1;36m[update]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[error ]\033[0m %s\n" "$*" 1>&2; }

# Determine docker compose command (docker compose vs docker-compose)
resolve_dc() {
  if command -v docker >/dev/null 2>&1; then
    if docker compose version >/dev/null 2>&1; then
      echo "docker compose"
      return
    fi
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return
  fi
  err "Neither 'docker compose' nor 'docker-compose' found in PATH."
  exit 1
}

DC=$(resolve_dc)

# Parse args
BUILD=1
TAIL_LOGS=1
BRANCH="main"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build)
      BUILD=0
      shift
      ;;
    --no-logs)
      TAIL_LOGS=0
      shift
      ;;
    --branch)
      BRANCH="${2:-main}"
      shift 2 || true
      ;;
    *)
      err "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# Move to the directory of this script (backend root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f docker-compose.yml ]]; then
  err "docker-compose.yml not found. Please run this script from loocateme_backend root."
  exit 1
fi

# --- Git update ---
if ! command -v git >/dev/null 2>&1; then
  err "git not installed."
  exit 1
fi

# Ensure repository exists
if [[ ! -d .git ]]; then
  err "This directory is not a git repository (.git missing)."
  exit 1
fi

log "Fetching latest changes from origin..."
git fetch --all --prune

# Checkout target branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  log "Switching branch: $CURRENT_BRANCH -> $BRANCH"
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout "$BRANCH"
  else
    git checkout -b "$BRANCH" "origin/$BRANCH"
  fi
fi

log "Resetting working tree to origin/$BRANCH..."
git reset --hard "origin/$BRANCH"

# --- Ensure data directories exist and fix permissions ---
mkdir -p ./data/mongo ./data/redis ./data/uploads || true
if [[ -d ./data ]]; then
  log "Ensuring data directories exist (./data/mongo, ./data/redis, ./data/uploads) and fixing permissions..."
  sudo chown -R "$USER:docker" ./data || true
  sudo chmod -R 770 ./data || true
fi

# Safety notice about volumes
log "Note: data is persisted under ./data/. Do NOT delete this folder if you want to keep your database and uploads."

# --- Docker restart ---
log "Stopping current services..."
$DC down --remove-orphans || true

log "Pulling latest base images..."
$DC pull || true

if [[ "$BUILD" -eq 1 ]]; then
  log "Building images..."
  $DC build
else
  log "Skipping build (per --no-build)"
fi

log "Starting services in the background..."
$DC up -d

log "Pruning dangling images (safe cleanup)..."
docker image prune -f >/dev/null 2>&1 || true

log "Services restarted."

if [[ "$TAIL_LOGS" -eq 1 ]]; then
  log "Tailing logs (press Ctrl+C to detach)..."
  $DC logs -f --tail=200
else
  log "Skipping logs (per --no-logs)."
fi

log "Done."
