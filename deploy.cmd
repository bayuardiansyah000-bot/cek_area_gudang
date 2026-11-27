@echo off
cd /d "%~dp0"
echo.
echo Pastikan 4 Environment Variable sudah diisi di dashboard Vercel:
echo   BACKEND, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_FUNCTION_URL
echo.
npx.cmd vercel --prod
echo.
pause
