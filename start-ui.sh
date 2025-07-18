#!/bin/bash

# --- Function to handle shutting down the server ---
cleanup() {
    echo ""
    echo "Shutting down the server..."
    # Kills the background server process when this script exits
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID"
    fi
    exit
}

# --- Trap the script exit signal to run the cleanup function ---
trap cleanup INT TERM EXIT

# --- Get the folder path from the drag-and-drop action ---
FOLDER_PATH="$1"
if [ -z "$FOLDER_PATH" ]; then
    echo "ERROR: Please run this script by dragging your image folder onto it."
    exit 1
fi

echo "Activating Python virtual environment..."
source .venv/bin/activate

echo "Starting the Image Tag Editor server in the background..."
# Start the node server as a background process (&)
node server.js "$FOLDER_PATH" &

# Store the Process ID (PID) of the background server
SERVER_PID=$!

echo "Server is running with PID: $SERVER_PID"
echo "Waiting for server to initialize..."
sleep 2 # Give the server a moment to start

# --- Open the UI in the default browser ---
URL="http://localhost:3000"
echo "Opening UI at $URL..."

# Use the appropriate command for macOS or Linux
if command -v open > /dev/null; then
  open "$URL" # macOS
elif command -v xdg-open > /dev/null; then
  xdg-open "$URL" # Linux
else
  echo "Could not detect 'open' or 'xdg-open' command to automatically open the browser."
  echo "Please manually open your browser to $URL"
fi

echo ""
echo "Server is running. Press Ctrl+C in this terminal to shut it down."

# Wait for the background server process to finish
wait "$SERVER_PID"