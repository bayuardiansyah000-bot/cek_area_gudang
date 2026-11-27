@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-function-secret.ps1"
echo.
pause
