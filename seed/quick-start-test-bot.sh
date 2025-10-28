#!/bin/bash
# Quick Start Script for Test Bot Simulator
# This script runs the bot simulator with the correct configuration for "Test Mow Bot #1"

set -e

echo "=================================="
echo "  Test Mow Bot #1 Simulator"
echo "=================================="
echo ""

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if backend is running
BACKEND_URL=${BACKEND_URL:-"http://localhost:8080"}
echo "Checking backend at: $BACKEND_URL"

if ! curl -s "$BACKEND_URL/health" > /dev/null 2>&1; then
    echo "❌ Error: Backend is not running at $BACKEND_URL"
    echo ""
    echo "Please start the backend first:"
    echo "  cd backend"
    echo "  python main.py"
    echo ""
    exit 1
fi

echo "✅ Backend is accessible"
echo ""

# Use the correct bot ID for "Test Mow Bot #1"
export BOT_ID="550e8400-e29b-41d4-a716-446655440000"
export BACKEND_URL="$BACKEND_URL"
export UPDATE_INTERVAL="5"

echo "Configuration:"
echo "  Bot ID: $BOT_ID (Test Mow Bot #1)"
echo "  Backend: $BACKEND_URL"
echo "  Update Interval: ${UPDATE_INTERVAL}s"
echo ""

# Run the simulator
cd "$SCRIPT_DIR"
python bot_simulator.py

