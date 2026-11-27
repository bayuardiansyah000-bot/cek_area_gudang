@echo off
cd /d "%~dp0"
echo.
echo Deploy langsung dari folder ini ke Vercel Production.
echo.
npx.cmd vercel --prod --yes ^
  --build-env BACKEND=supabase ^
  --build-env SUPABASE_URL=https://avnbnwdlnybshwfznpul.supabase.co ^
  --build-env SUPABASE_ANON_KEY=sb_publishable_VcMoZbE4N5Ii7QKUwiz-9w_-G-FD9D3 ^
  --build-env SUPABASE_FUNCTION_URL=https://avnbnwdlnybshwfznpul.supabase.co/functions/v1/cek-api
echo.
pause
