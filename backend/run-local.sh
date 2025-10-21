#!/bin/bash
# Run BotKorp Backend locally for development

set -e

echo "🚀 Starting BotKorp Backend locally..."
echo ""
echo "Environment: development"
echo "Port: 8080"
echo "Debug: True"
echo ""
echo "Health check: http://localhost:8080/health"
echo ""

export PORT=8080
export ENVIRONMENT=development
export DEBUG=True

python3 main.py

