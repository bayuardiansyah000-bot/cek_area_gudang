$ErrorActionPreference = 'Stop'

$secure = Read-Host 'Masukkan ADMIN_PASSWORD untuk tab Kelola (karakter tidak akan tampil)' -AsSecureString
$plain = [System.Net.NetworkCredential]::new('', $secure).Password
if (-not $plain) { throw 'ADMIN_PASSWORD tidak boleh kosong.' }

Set-Location -Path $PSScriptRoot
& .\setup-supabase.ps1 -ProjectRef 'avnbnwdlnybshwfznpul' -AdminPassword $plain

if ($LASTEXITCODE -ne 0) { throw 'Deploy gagal. Lihat pesan error di atas.' }
