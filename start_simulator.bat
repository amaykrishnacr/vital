@echo off
REM Starts the fake ESP32, which sends realistic readings to the server.
REM Start the server first (start_server.bat).
cd /d "%~dp0simulator"
if not exist ..\server\.venv\Scripts\python.exe (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
..\server\.venv\Scripts\python.exe fake_esp32.py %*
pause
