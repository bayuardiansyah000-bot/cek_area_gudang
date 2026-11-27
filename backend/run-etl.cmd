@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-etl.ps1"
echo.
pause
