@echo off
echo ========================================
echo == Image Tag Editor Smart Installer
echo ========================================
echo.

:: --- IMPORTANT: CONFIGURE YOUR REPOSITORY URL HERE ---
set REPO_URL=https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
:: ---------------------------------------------------

:: Check for Git installation
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Git is not installed or not in your PATH.
    echo Please install Git from https://git-scm.com/downloads and try again.
    pause
    exit /b 1
)

:: Check if this is already a Git repository
if exist .git (
    echo Git repository detected. Checking for updates...
    git pull
    if %errorlevel% neq 0 (
        echo WARNING: 'git pull' failed. Please check your connection or for local changes.
    )
    echo.
) else (
    echo No Git repository found. Cloning from the source...
    git clone %REPO_URL% .
    if %errorlevel% neq 0 (
        echo ERROR: Git clone failed. Please check the REPO_URL in this script.
        pause
        exit /b 1
    )
    echo.
    echo ====================================================================
    echo == Repository cloned successfully!
    echo == Please re-run this install.bat script to complete the setup.
    echo ====================================================================
    echo.
    pause
    exit /b 0
)

:: --- Standard Installation Steps ---

:: Check for Python
echo Checking for Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in your PATH.
    echo Please install Python 3.11 from python.org and ensure it's added to your PATH.
    pause
    exit /b 1
)
echo Python found.
echo.

:: Create the Python virtual environment
echo Creating Python virtual environment in .venv folder...
python -m venv .venv
echo.

:: Activate the virtual environment
echo Activating virtual environment...
call .venv\Scripts\activate.bat
echo.

:: Install Python packages from requirements.txt
echo Installing Python packages (this may take a while)...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo ERROR: Failed to install Python packages.
    pause
    exit /b 1
)
echo Python packages installed successfully.
echo.

:: Check for Node.js
echo Checking for Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in your PATH.
    echo Please install the LTS version from nodejs.org.
    pause
    exit /b 1
)
echo Node.js found.
echo.

:: Install Node.js packages
echo Installing Node.js packages...
npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install Node.js packages.
    pause
    exit /b 1
)
echo Node.js packages installed successfully.
echo.

echo ========================================
echo == Installation Complete!
echo ========================================
echo You can now run the application by dragging your image folder onto the start.bat script.
echo.
pause