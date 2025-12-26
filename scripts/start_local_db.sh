#!/bin/bash
# Start Local MongoDB using backend/data/db

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$PROJECT_ROOT/backend/data/db"
LOG_FILE="$PROJECT_ROOT/backend/data/mongod.log"

echo "🍃 Starting Local MongoDB..."
echo "   Data Directory: $DATA_DIR"
echo "   Log File: $LOG_FILE"

# Check if mongod is installed
if ! command -v mongod &> /dev/null; then
    echo "❌ mongod could not be found. Please install MongoDB Community Edition."
    exit 1
fi

# Check if already running
if pgrep -x "mongod" > /dev/null; then
    echo "⚠️  MongoDB is already running."
    exit 0
fi

# Start MongoDB
mongod --dbpath "$DATA_DIR" --port 27017 --bind_ip 127.0.0.1 > "$LOG_FILE" 2>&1 &
MONGO_PID=$!

echo "✅ MongoDB started with PID: $MONGO_PID"
echo "   To stop it, run: kill $MONGO_PID"
