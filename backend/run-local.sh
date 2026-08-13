#!/usr/bin/env bash
# Local backend startup for Linux and macOS.
# Mirrors run-local.ps1, which is Windows-only (py launcher, .ps1 activate script).
#
#   ./run-local.sh          start the API on :8000
#   PORT=8080 ./run-local.sh
#
# No Azure resources are needed. Every adapter defaults to local mode.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"

# 3.12 is required, not preferred: app/services/search.py uses nested same-quote
# f-strings, which are a syntax error before 3.12.
PY="${PYTHON:-python3}"
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'; then
    echo "Python 3.12+ required. Found: $("$PY" --version 2>&1)" >&2
    echo "Set PYTHON=/path/to/python3.12 to point at another interpreter." >&2
    exit 1
fi

if [ ! -d .venv ]; then
    echo "Creating .venv"
    "$PY" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

python -m pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet

if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
fi

echo
echo "API      http://localhost:${PORT}"
echo "Swagger  http://localhost:${PORT}/docs"
echo "Health   http://localhost:${PORT}/health"
echo

exec uvicorn app.main:app --reload --port "$PORT"
