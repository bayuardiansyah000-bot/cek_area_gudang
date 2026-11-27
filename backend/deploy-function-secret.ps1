$ErrorActionPreference = 'Stop'

$adminSecure = Read-Host 'Masukkan ADMIN_PASSWORD (karakter tidak akan tampil)' -AsSecureString
$adminPlain = [System.Net.NetworkCredential]::new('', $adminSecure).Password
if (-not $adminPlain) { throw 'ADMIN_PASSWORD tidak boleh kosong.' }

$secretSecure = Read-Host 'Masukkan SUPABASE_SECRET_KEY / sb_secret_... (karakter tidak akan tampil)' -AsSecureString
$secretPlain = [System.Net.NetworkCredential]::new('', $secretSecure).Password
if (-not $secretPlain) { throw 'SUPABASE_SECRET_KEY tidak boleh kosong.' }

Set-Location -Path $PSScriptRoot
& .\setup-supabase.ps1 -ProjectRef 'avnbnwdlnybshwfznpul' -AdminPassword $adminPlain -SecretKey $secretPlain

if ($LASTEXITCODE -ne 0) { throw 'Deploy gagal. Lihat pesan error di atas.' }
