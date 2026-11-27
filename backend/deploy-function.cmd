@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-function.ps1"
echo.
pause
