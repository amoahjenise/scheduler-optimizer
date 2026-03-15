#!/bin/bash
cd /Users/graandzenizer/Desktop/Dev/scheduler-optimizer/backend
/Users/graandzenizer/Desktop/Dev/scheduler-optimizer/.venv/bin/python -m uvicorn app.main:app --reload --port 8000
