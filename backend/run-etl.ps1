$ErrorActionPreference = 'Stop'

$secure = Read-Host 'Masukkan SUPABASE_SECRET_KEY (sb_secret_...)' -AsSecureString
$plain = [System.Net.NetworkCredential]::new('', $secure).Password
if (-not $plain) { throw 'Kunci tidak boleh kosong.' }

Set-Location -Path $PSScriptRoot

$gas = 'https://script.google.com/macros/s/AKfycbyZgbDlER4S2LUCioPzGL4Qz1KHQnwDakFCsn5kuqM3AKfgvCD_tDY5x4mjznk8ZiH26w/exec'
$url = 'https://avnbnwdlnybshwfznpul.supabase.co'

& node supabase/etl.js $gas $url $plain
if ($LASTEXITCODE -ne 0) { throw 'ETL gagal. Lihat pesan error di atas.' }
