param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,

  [Parameter(Mandatory = $true)]
  [string]$AdminPassword,

  [string]$SecretKey,

  [switch]$SkipLogin
)

$ErrorActionPreference = 'Stop'
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

Set-Location -Path $PSScriptRoot

if (-not $SkipLogin) {
  Write-Host '1/4 Login Supabase (browser akan terbuka)...' -ForegroundColor Cyan
  & npx.cmd supabase@latest login
  if ($LASTEXITCODE -ne 0) { throw 'Login gagal.' }
}

Write-Host '2/4 Menghubungkan project...' -ForegroundColor Cyan
& npx.cmd supabase@latest link --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw 'Link gagal. Cek Project Ref.' }

Write-Host '3/5 Menyimpan ADMIN_PASSWORD sebagai secret...' -ForegroundColor Cyan
& npx.cmd supabase@latest secrets set "ADMIN_PASSWORD=$AdminPassword"
if ($LASTEXITCODE -ne 0) { throw 'Gagal menyetel ADMIN_PASSWORD.' }

if ($SecretKey) {
  # CLI Supabase melarang nama secret yang diawali SUPABASE_.
  Write-Host '4/5 Menyimpan SECRET_KEY...' -ForegroundColor Cyan
  & npx.cmd supabase@latest secrets set "SECRET_KEY=$SecretKey"
  if ($LASTEXITCODE -ne 0) { throw 'Gagal menyetel SECRET_KEY.' }
}

Write-Host '5/5 Deploy Edge Function cek-api...' -ForegroundColor Cyan
& npx.cmd supabase@latest functions deploy cek-api
if ($LASTEXITCODE -ne 0) { throw 'Deploy function gagal.' }

Write-Host 'Selesai. Edge Function aktif.' -ForegroundColor Green
