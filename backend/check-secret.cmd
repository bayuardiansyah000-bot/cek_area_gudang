@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-secret.ps1"
echo.
pause
