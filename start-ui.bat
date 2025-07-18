@echo off
echo Activating Python virtual environment...
call .venv\Scripts\activate.bat

echo Starting the Image Tag Editor server...
node server.js "%~1"
pause