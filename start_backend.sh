#!/bin/bash
cd /Users/graandzenizer/Desktop/Dev/scheduler-optimizer/backend
/Users/graandzenizer/Desktop/Dev/scheduler-optimizer/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
