@echo off
REM Starts the VITAL website + API. Keep this window open while using VITAL.
cd /d "%~dp0server"
if not exist .venv\Scripts\activate.bat (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
start "" http://localhost:5000
python app.py
pause
