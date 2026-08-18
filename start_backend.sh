#!/bin/bash
set -euo pipefail

ROOT_DIR="/Users/graandzenizer/Desktop/Dev/scheduler-optimizer"
BACKEND_DIR="$ROOT_DIR/backend"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"

if lsof -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
	echo "Backend already running on 127.0.0.1:8000"
	exit 0
fi

cd "$BACKEND_DIR"
exec "$PYTHON_BIN" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
