#!/bin/bash

# Quick Start Script for Bot Data Tracking System
# This script helps you quickly test the entire bot tracking system

echo "================================================================"
echo "  🤖 BotKorp Bot Data Tracking System - Quick Start"
echo "================================================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default values
BOT_ID="${BOT_ID:-550e8400-e29b-41d4-a716-446655440000}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"
UPDATE_INTERVAL="${UPDATE_INTERVAL:-5}"

echo -e "${GREEN}Configuration:${NC}"
echo "  Bot ID: $BOT_ID"
echo "  Backend URL: $BACKEND_URL"
echo "  Update Interval: ${UPDATE_INTERVAL}s"
echo ""

# Check if backend is running
echo -e "${YELLOW}→${NC} Checking backend..."
if curl -s -f "$BACKEND_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Backend is running at $BACKEND_URL"
else
    echo -e "${RED}✗${NC} Backend is not accessible at $BACKEND_URL"
    echo ""
    echo "Please start the backend first:"
    echo "  cd backend"
    echo "  python main.py"
    echo ""
    exit 1
fi

echo ""
echo -e "${YELLOW}→${NC} Checking Python dependencies..."

# Check if requests library is installed
if ! python3 -c "import requests" 2>/dev/null; then
    echo -e "${RED}✗${NC} Python 'requests' library not installed"
    echo ""
    echo "Installing required dependencies..."
    pip3 install requests
    if [ $? -ne 0 ]; then
        echo -e "${RED}✗${NC} Failed to install dependencies"
        exit 1
    fi
fi

echo -e "${GREEN}✓${NC} All dependencies are installed"
echo ""

# Ask user if they want to continue
echo -e "${YELLOW}Ready to start the bot simulator!${NC}"
echo ""
echo "This will send sensor data to the backend every ${UPDATE_INTERVAL} seconds."
echo "Press Ctrl+C to stop the simulator."
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "================================================================"
echo "  🚀 Starting Bot Simulator..."
echo "================================================================"
echo ""

# Export environment variables
export BOT_ID
export BACKEND_URL
export UPDATE_INTERVAL

# Run the simulator
python3 bot_simulator.py




