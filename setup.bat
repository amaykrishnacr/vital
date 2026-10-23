@echo off
REM ============================================================
REM  VITAL - one-time setup (run this once after downloading)
REM ============================================================
cd /d "%~dp0server"
where python >nul 2>nul
if %errorlevel%==0 (set PY=python) else (set PY=py -3)
echo Creating a private Python environment in server\.venv ...
%PY% -m venv .venv || goto :fail
call .venv\Scripts\activate.bat
echo Installing libraries (this takes a minute) ...
python -m pip install --upgrade pip >nul
pip install -r requirements.txt || goto :fail
echo Creating demo history and training the ML models ...
python seed_demo.py || goto :fail
echo.
echo  Setup complete. Now double-click start_server.bat
echo.
pause
exit /b 0
:fail
echo.
echo  Something went wrong. Read the red text above, or see README.md - Troubleshooting.
pause
exit /b 1
