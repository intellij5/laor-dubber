@echo off
setlocal
cd /d "%~dp0"
echo Starting L'aor Dubber local web server without Python...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_local_server.ps1"
pause
