#!/usr/bin/env bash
# Regenerates the golden files with the official Tabbycat, without Docker.
#
#   tools/tabbycat-diff/tabbycat/run-native.sh
#
# Needs Python 3.11 (Tabbycat's Pipfile pins it), git, and a local PostgreSQL install (only its
# binaries: initdb, pg_ctl, createdb). Everything downloaded or created goes into a work directory
# outside the repository (default ~/.cache/crabbytab-tabbycat-diff): the Tabbycat checkout, its
# virtualenv, and a throwaway database cluster that listens on 127.0.0.1 only, uses trust auth, and
# is stopped and deleted when the script ends.
#
# Environment:
#   TABBYCAT_DIFF_WORK  work directory
#   PYTHON311           command for Python 3.11 (default: python3.11, or "py -3.11" on Windows)
#   PG_BIN              directory holding initdb/pg_ctl/createdb (default: found on PATH)
#   PG_PORT             port for the throwaway cluster (default 54329)
#   ONLY                run one fixture, e.g. ONLY=bp-uneven
set -euo pipefail

TABBYCAT_TAG=v2.12.1
TABBYCAT_COMMIT=ce9488b5ea0adbb6c61440cf38a2ffbdbee2b89d

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIFF_ROOT="$(cd "$HERE/.." && pwd)"
WORK="${TABBYCAT_DIFF_WORK:-$HOME/.cache/crabbytab-tabbycat-diff}"
PG_PORT="${PG_PORT:-54329}"
SRC="$WORK/tabbycat-$TABBYCAT_TAG"
VENV="$WORK/venv-$TABBYCAT_TAG"
PGDATA="$WORK/pgdata"

if [[ -z "${PYTHON311:-}" ]]; then
  if command -v python3.11 >/dev/null 2>&1; then PYTHON311=python3.11; else PYTHON311="py -3.11"; fi
fi
pg() { if [[ -n "${PG_BIN:-}" ]]; then "$PG_BIN/$1" "${@:2}"; else "$1" "${@:2}"; fi; }

mkdir -p "$WORK"

# 1. Tabbycat at the pinned tag, checked against the pinned commit.
if [[ ! -d "$SRC/.git" ]]; then
  git clone --quiet --depth 1 --branch "$TABBYCAT_TAG" https://github.com/TabbycatDebate/tabbycat.git "$SRC"
fi
actual="$(git -C "$SRC" rev-parse HEAD)"
if [[ "$actual" != "$TABBYCAT_COMMIT" ]]; then
  echo "Tabbycat $TABBYCAT_TAG is at $actual, expected $TABBYCAT_COMMIT; refusing to continue." >&2
  exit 1
fi
cp "$HERE/local_settings.py" "$SRC/tabbycat/settings/local.py"

# 2. Its locked Python dependencies in a dedicated virtualenv.
if [[ ! -d "$VENV" ]]; then
  $PYTHON311 -m venv "$VENV"
fi
if [[ -x "$VENV/bin/python" ]]; then PY="$VENV/bin/python"; else PY="$VENV/Scripts/python"; fi
"$PY" -I "$HERE/lock_to_requirements.py" "$SRC/Pipfile.lock" "$WORK/requirements.txt"
"$PY" -m pip install --quiet --disable-pip-version-check -r "$WORK/requirements.txt"

# 3. A throwaway PostgreSQL cluster.
rm -rf "$PGDATA"
pg initdb -D "$PGDATA" -U tabbycat --auth=trust -E UTF8 --locale=C >/dev/null
pg pg_ctl -D "$PGDATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1" -l "$WORK/postgres.log" -w start >/dev/null
cleanup() {
  pg pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA"
}
trap cleanup EXIT
pg createdb -h 127.0.0.1 -p "$PG_PORT" -U tabbycat tabbycat

export DATABASE_URL="postgres://tabbycat@127.0.0.1:$PG_PORT/tabbycat"
export DISABLE_SENTRY=1
export TABBYCAT_VERSION="$TABBYCAT_TAG"

# 4. Migrate, then run every fixture through Tabbycat.
"$PY" "$SRC/tabbycat/manage.py" migrate --noinput -v 0 >/dev/null
args=(--tabbycat "$SRC" --fixtures "$DIFF_ROOT/fixtures" --out "$DIFF_ROOT/golden")
if [[ -n "${ONLY:-}" ]]; then args+=(--only "$ONLY"); fi
"$PY" -I "$HERE/run_tabbycat.py" "${args[@]}" 2> >(grep -v "SPLIT_SETTINGS\|asyncio" >&2)

echo "Golden files written to $DIFF_ROOT/golden. Next: TABBYCAT_DIFF_WRITE=1 npx vitest run tools/tabbycat-diff"
