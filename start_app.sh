#!/bin/bash
# Start Backend and Frontend in separate terminals

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Function to get local IP
get_local_ip() {
    ipconfig getifaddr en0 || ipconfig getifaddr en1 || echo "localhost"
}

LOCAL_IP=$(get_local_ip)
PORT=8001

echo "🚀 Starting Stock Verify Application..."
echo "📍 Detected Local IP: $LOCAL_IP"
echo "🛑 Stopping any running instances first..."
"$SCRIPT_DIR/scripts/stop_all.sh" 2>/dev/null || true
sleep 2

echo ""

# Start Backend in new Terminal window
osascript <<APPLESCRIPT
tell application "Terminal"
    activate
    set backendWindow to do script "cd '$SCRIPT_DIR' && ./scripts/start_backend.sh"
    set custom title of backendWindow to "Backend Server"
end tell
APPLESCRIPT

echo "⏳ Waiting for Backend to initialize on $LOCAL_IP:$PORT..."

# Loop to check health
MAX_RETRIES=30
COUNT=0
BACKEND_READY=false

while [ $COUNT -lt $MAX_RETRIES ]; do
    # Check IP
    if curl -s "http://$LOCAL_IP:$PORT/api/health" > /dev/null; then
        BACKEND_READY=true
        echo "✅ Connection confirmed: http://$LOCAL_IP:$PORT/api/health"
        break
    fi
    # Check localhost
    if curl -s "http://localhost:$PORT/api/health" > /dev/null; then
        BACKEND_READY=true
        echo "✅ Connection confirmed: http://localhost:$PORT/api/health"
        break
    fi

    echo "   ... waiting for backend ($COUNT/$MAX_RETRIES)"
    sleep 2
    ((COUNT++))
done

if [ "$BACKEND_READY" = true ]; then
    echo "✅ Backend is UP and reachable!"

    echo "🚀 Starting Frontend..."

    # Start Frontend in new Terminal window
    osascript <<APPLESCRIPT
    tell application "Terminal"
        activate
        set frontendWindow to do script "cd '$SCRIPT_DIR' && ./scripts/start_frontend.sh"
        set custom title of frontendWindow to "Frontend Server"
    end tell
APPLESCRIPT

    echo "✅ Both servers started!"
    echo "📱 Frontend will automatically connect to Backend at http://$LOCAL_IP:$PORT"
else
    echo "❌ Backend failed to start or is not reachable after 60 seconds."
    echo "   Please check the 'Backend Server' terminal window for errors."
    exit 1
fi

echo "💡 To stop servers, run: ./stop.sh"
