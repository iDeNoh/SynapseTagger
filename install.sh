#!/bin/bash

echo "========================================"
echo "== Image Tag Editor Smart Installer"
echo "========================================"
echo ""

# --- IMPORTANT: CONFIGURE YOUR REPOSITORY URL HERE ---
REPO_URL="https://github.com/iDeNoh/SynapseTagger"
# ---------------------------------------------------

# Check for Git installation
if ! command -v git &> /dev/null; then
    echo "ERROR: Git is not installed or not in your PATH."
    echo "Please install Git and try again."
    exit 1
fi

# Check if this is already a Git repository
if [ -d ".git" ]; then
    echo "Git repository detected. Checking for updates..."
    git pull
    if [ $? -ne 0 ]; then
        echo "WARNING: 'git pull' failed. Please check your connection or for local changes."
    fi
else
    echo "No Git repository found. Cloning from the source..."
    git clone "$REPO_URL" .
    if [ $? -ne 0 ]; then
        echo "ERROR: Git clone failed. Please check the REPO_URL in this script."
        exit 1
    fi
fi
echo ""

# --- Standard Installation Steps ---

# Check for Python
echo "Checking for Python installation..."
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed or not in your PATH."
    echo "Please install Python 3.11 from python.org."
    exit 1
fi
echo "Python found."
echo ""

# Create the Python virtual environment
echo "Creating Python virtual environment in .venv folder..."
python3 -m venv .venv
echo ""

# Activate the virtual environment
echo "Activating virtual environment..."
source .venv/bin/activate
echo ""

# Install Python packages from requirements.txt
echo "Installing Python packages (this may take a while)..."
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install Python packages."
    exit 1
fi
echo "Python packages installed successfully."
echo ""

# Check for Node.js
echo "Checking for Node.js installation..."
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed or not in your PATH."
    echo "Please install the LTS version from nodejs.org."
    exit 1
fi
echo "Node.js found."
echo ""

# Install Node.js packages
echo "Installing Node.js packages..."
npm install
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install Node.js packages."
    exit 1
fi
echo "Node.js packages installed successfully."
echo ""

echo "========================================"
echo "== Installation Complete!"
echo "========================================"
echo "You can now run the application by dragging your image folder onto the start.sh script."
echo ""